// Package notifier tells Telegram chats what their tenant's agents do, and
// passes the commands people send there to the engine. The engine words
// every message and records it as a notice event; the notifier delivers
// notices to each linked chat, in order, with retries, and never twice.
package notifier

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/candylario/notifier/internal/engine"
	"github.com/candylario/notifier/internal/store"
	"github.com/candylario/notifier/internal/telegram"
)

type Service struct {
	Bot    *telegram.Bot
	Engine *engine.Client
	Store  *store.Store
	Logf   func(format string, args ...any)

	// Refresh is how often the streams are matched to the links, Retry how
	// long a dropped stream waits, Gap the time between two messages to one
	// chat, and Rate the messages per second overall, under Telegram's 30.
	Refresh time.Duration
	Retry   time.Duration
	Gap     time.Duration
	Rate    int
	// RadarChannel, when set, is a chat that gets every radar alert.
	RadarChannel int64

	name    string
	out     chan outgoing
	wake    chan struct{}
	mu      sync.Mutex
	replied map[replyKey]time.Time
	confirm map[int64]pending
}

type outgoing struct {
	chat int64
	text string
	done chan struct{}
}

type replyKey struct {
	chat        int64
	agent, text string
}

type pending struct {
	agent engine.Agent
	until time.Time
}

const helpText = `Commands:
/status – account, holdings and the last decision
/decide – make a decision now (costs a model call)
/stop – stop trading, keep what is held
/resume – trade again
/sellall – sell everything and stop (asks to confirm)
/disconnect – stop updates in this chat
With several agents, add the name: /stop btc-eth`

var menu = []telegram.Command{
	{Command: "status", Description: "Account, holdings and the last decision"},
	{Command: "decide", Description: "Make a decision now"},
	{Command: "stop", Description: "Stop trading, keep what is held"},
	{Command: "resume", Description: "Trade again"},
	{Command: "sellall", Description: "Sell everything and stop"},
	{Command: "help", Description: "What I can do"},
	{Command: "disconnect", Description: "Stop updates in this chat"},
}

const (
	description      = "Candylario agents trade crypto around the clock within the limits you set. Connect this chat from the Candylario app to get their decisions, trades and alerts here, and to control them."
	shortDescription = "Updates and controls for your Candylario trading agents."
)

func (s *Service) defaults() {
	if s.Refresh == 0 {
		s.Refresh = 30 * time.Second
	}
	if s.Retry == 0 {
		s.Retry = 5 * time.Second
	}
	if s.Gap == 0 {
		s.Gap = time.Second
	}
	if s.Rate == 0 {
		s.Rate = 25
	}
	s.out, s.wake = make(chan outgoing, 1000), make(chan struct{}, 1)
	s.replied, s.confirm = map[replyKey]time.Time{}, map[int64]pending{}
}

// Run serves until ctx ends.
func (s *Service) Run(ctx context.Context) error {
	s.defaults()
	me, err := s.Bot.Me(ctx)
	if err != nil {
		return fmt.Errorf("telegram bot: %w", err)
	}
	s.name = me.Username
	if err := s.Bot.SetProfile(ctx, menu, description, shortDescription); err != nil {
		s.Logf("bot profile: %v", err)
	}
	go s.deliver(ctx)
	go s.relay(ctx)
	if s.RadarChannel != 0 {
		go s.radar(ctx)
	}
	s.Logf("notifier running as @%s", s.name)
	return s.listen(ctx)
}

func sleep(ctx context.Context, d time.Duration) bool {
	select {
	case <-ctx.Done():
		return false
	case <-time.After(d):
		return true
	}
}

// listen reads the bot's messages and handles each once, across restarts.
func (s *Service) listen(ctx context.Context) error {
	offset, err := s.Store.Offset(ctx, s.name)
	if err != nil {
		return err
	}
	for ctx.Err() == nil {
		ups, err := s.Bot.Updates(ctx, offset, 50*time.Second)
		if err != nil {
			if ctx.Err() == nil {
				s.Logf("telegram: %v", err)
				sleep(ctx, 5*time.Second)
			}
			continue
		}
		for _, u := range ups {
			if u.Message != nil {
				s.handle(ctx, *u.Message)
			}
			offset = u.UpdateID + 1
			if err := s.Store.SetOffset(ctx, s.name, offset); err != nil {
				s.Logf("database: %v", err)
			}
		}
	}
	return nil
}

// say queues a message without waiting for it to go out.
func (s *Service) say(ctx context.Context, chat int64, text string) {
	select {
	case s.out <- outgoing{chat: chat, text: text}:
	case <-ctx.Done():
	}
}

// send queues a message and waits until it is delivered or dropped.
func (s *Service) send(ctx context.Context, chat int64, text string) error {
	done := make(chan struct{})
	select {
	case s.out <- outgoing{chat: chat, text: text, done: done}:
	case <-ctx.Done():
		return ctx.Err()
	}
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// deliver sends the queue in order, within Telegram's limits overall and
// per chat.
func (s *Service) deliver(ctx context.Context) {
	last := map[int64]time.Time{}
	pace := time.NewTicker(time.Second / time.Duration(s.Rate))
	defer pace.Stop()
	for {
		var m outgoing
		select {
		case <-ctx.Done():
			return
		case m = <-s.out:
		}
		select {
		case <-ctx.Done():
			return
		case <-pace.C:
		}
		if wait := s.Gap - time.Since(last[m.chat]); wait > 0 && !sleep(ctx, wait) {
			return
		}
		s.post(ctx, m)
		last[m.chat] = time.Now()
		if m.done != nil {
			close(m.done)
		}
	}
}

// post sends one message. It waits as long as Telegram asks and retries
// failures that may pass; a message Telegram refuses, such as to a chat
// that blocked the bot, is dropped.
func (s *Service) post(ctx context.Context, m outgoing) {
	backoff := time.Second
	for ctx.Err() == nil {
		err := s.Bot.Send(ctx, m.chat, m.text)
		var te *telegram.Error
		switch {
		case err == nil:
			return
		case errors.As(err, &te) && te.RetryAfter > 0:
			sleep(ctx, te.RetryAfter)
		case errors.As(err, &te) && te.Code >= 400 && te.Code < 500:
			s.Logf("telegram: chat %d: %v; message dropped", m.chat, err)
			return
		default:
			s.Logf("telegram: %v; retrying", err)
			sleep(ctx, backoff)
			backoff = min(2*backoff, time.Minute)
		}
	}
}

// remember notes a reply that the same notice will repeat, so the notice
// is not sent to that chat again.
func (s *Service) remember(chat int64, agent, text string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for k, until := range s.replied {
		if now.After(until) {
			delete(s.replied, k)
		}
	}
	s.replied[replyKey{chat, agent, text}] = now.Add(2 * time.Minute)
}

func (s *Service) repliedWith(chat int64, agent, text string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	k := replyKey{chat, agent, text}
	until, ok := s.replied[k]
	delete(s.replied, k)
	return ok && time.Now().Before(until)
}

// Wake matches the streams to the links now, after a chat connected or
// disconnected.
func (s *Service) Wake() {
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

type streamKey struct {
	chat  int64
	agent string
}

type target struct {
	link  store.Link
	agent engine.Agent
	label string
}

// relay keeps one event stream open for each linked chat and each agent of
// its tenant.
func (s *Service) relay(ctx context.Context) {
	type running struct {
		cancel context.CancelFunc
		target target
	}
	streams := map[streamKey]running{}
	defer func() {
		for _, r := range streams {
			r.cancel()
		}
	}()
	for {
		if want, ok := s.wanted(ctx); ok {
			for k, r := range streams {
				if t, keep := want[k]; !keep || t.label != r.target.label || !t.link.LinkedAt.Equal(r.target.link.LinkedAt) {
					r.cancel()
					delete(streams, k)
				}
			}
			for k, t := range want {
				if _, ok := streams[k]; ok {
					continue
				}
				sctx, cancel := context.WithCancel(ctx)
				streams[k] = running{cancel, t}
				go s.follow(sctx, t)
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-s.wake:
		case <-time.After(s.Refresh):
		}
	}
}

// wanted lists the streams the links call for. With several agents, each
// message is labelled with its agent's name.
func (s *Service) wanted(ctx context.Context) (map[streamKey]target, bool) {
	links, err := s.Store.Links(ctx)
	if err != nil {
		s.Logf("database: %v", err)
		return nil, false
	}
	want := map[streamKey]target{}
	agentsOf := map[uuid.UUID][]engine.Agent{}
	for _, l := range links {
		agents, seen := agentsOf[l.Tenant]
		if !seen {
			agents, err = s.Engine.Agents(ctx, l.Tenant.String())
			if engine.IsCode(err, "not_found") {
				agents, err = nil, nil
			}
			if err != nil {
				s.Logf("engine: %v", err)
				return nil, false
			}
			agentsOf[l.Tenant] = agents
		}
		for _, a := range agents {
			t := target{link: l, agent: a}
			if len(agents) > 1 {
				t.label = a.Name
			}
			want[streamKey{l.Chat, a.ID}] = t
		}
	}
	return want, true
}

func labelled(label, text string) string {
	if label == "" {
		return text
	}
	return "[" + label + "] " + text
}

// follow passes an agent's notices to one chat, from where it last got to.
// Notices from before the chat was linked are skipped.
func (s *Service) follow(ctx context.Context, t target) {
	agent, err := uuid.Parse(t.agent.ID)
	if err != nil {
		return
	}
	chat := t.link.Chat
	seq, err := s.Store.Cursor(ctx, chat, agent)
	for err != nil && sleep(ctx, s.Retry) {
		seq, err = s.Store.Cursor(ctx, chat, agent)
	}
	saved := seq
	for ctx.Err() == nil {
		err := s.Engine.Stream(ctx, t.link.Tenant.String(), t.agent.ID, seq, func(e engine.Event) error {
			if e.Type == "notice" && !e.At.Before(t.link.LinkedAt) {
				var n struct {
					Text string `json:"text"`
				}
				if json.Unmarshal(e.Payload, &n) == nil && n.Text != "" && !s.repliedWith(chat, t.agent.ID, n.Text) {
					if err := s.send(ctx, chat, labelled(t.label, n.Text)); err != nil {
						return err
					}
				}
			}
			seq = e.Seq
			if e.Type == "notice" || seq-saved >= 100 {
				if err := s.Store.SetCursor(ctx, chat, agent, seq); err == nil {
					saved = seq
				}
			}
			return nil
		})
		if ctx.Err() != nil {
			break
		}
		s.Logf("events of %s: %v", t.agent.Name, err)
		sleep(ctx, s.Retry)
	}
	if seq > saved {
		sctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		s.Store.SetCursor(sctx, chat, agent, seq)
	}
}

// handle answers one message from a private chat with its owner; group
// messages are ignored.
func (s *Service) handle(ctx context.Context, m telegram.Message) {
	if m.Chat.Type != "private" || m.From == nil || m.From.ID != m.Chat.ID {
		return
	}
	chat := m.Chat.ID
	text := strings.TrimSpace(m.Text)
	if !strings.HasPrefix(text, "/") {
		s.say(ctx, chat, helpText)
		return
	}
	name, arg, _ := strings.Cut(text[1:], " ")
	name, _, _ = strings.Cut(name, "@")
	name, arg = strings.ToLower(name), strings.TrimSpace(arg)
	if name == "start" {
		s.start(ctx, m, arg)
		return
	}
	link, err := s.Store.Link(ctx, chat)
	if errors.Is(err, store.ErrNotLinked) {
		s.say(ctx, chat, "This chat is not connected. Open the link from the Candylario app.")
		return
	}
	if err != nil {
		s.Logf("database: %v", err)
		s.say(ctx, chat, "⚠️ Something went wrong; try again in a minute.")
		return
	}
	sent := time.Unix(m.Date, 0).UTC()
	switch name {
	case "status", "decide", "stop", "resume", "sellall", "confirm":
	case "disconnect":
		if err := s.Store.Unlink(ctx, chat); err != nil {
			s.Logf("database: %v", err)
			s.say(ctx, chat, "⚠️ Something went wrong; try again in a minute.")
			return
		}
		s.Wake()
		s.say(ctx, chat, "Disconnected. Nothing more will arrive here. Open a new link from the Candylario app to connect again.")
		return
	default:
		s.say(ctx, chat, helpText)
		return
	}
	// Like the agent, act on a late command only if it is a stop: one sent
	// while the notifier was down may no longer be wanted.
	if name != "status" && name != "stop" && time.Since(sent) > 10*time.Minute {
		s.say(ctx, chat, fmt.Sprintf("⚠️ Ignored /%s: it was sent at %s, while I was offline.", name, sent.Format("Jan 2 15:04 UTC")))
		return
	}
	tenant := link.Tenant.String()
	cctx, cancel := context.WithTimeout(ctx, 40*time.Second)
	defer cancel()
	agents, err := s.Engine.Agents(cctx, tenant)
	if err != nil {
		s.Logf("engine: %v", err)
		s.say(ctx, chat, "⚠️ The engine did not answer; try again in a minute.")
		return
	}
	if name == "confirm" {
		s.mu.Lock()
		p, ok := s.confirm[chat]
		delete(s.confirm, chat)
		s.mu.Unlock()
		if !ok || time.Now().After(p.until) {
			s.say(ctx, chat, "Nothing to confirm. Send /sellall first.")
			return
		}
		s.command(cctx, chat, tenant, agents, p.agent, "sell_all")
		return
	}
	a, problem := pick(agents, arg, name)
	if problem != "" {
		s.say(ctx, chat, problem)
		return
	}
	switch name {
	case "status":
		msg, err := s.Engine.Status(cctx, tenant, a.ID)
		switch {
		case engine.IsCode(err, "no_account"):
			s.say(ctx, chat, a.Name+" has no account yet; start it in the app.")
		case err != nil:
			s.Logf("engine: %v", err)
			s.say(ctx, chat, "⚠️ The engine did not answer; try again in a minute.")
		default:
			s.say(ctx, chat, labelled(label(agents, a), testnet(a, msg)))
		}
	case "sellall":
		s.mu.Lock()
		s.confirm[chat] = pending{agent: a, until: time.Now().Add(time.Minute)}
		s.mu.Unlock()
		s.say(ctx, chat, fmt.Sprintf("Sell everything %s holds and stop trading? Send /confirm within a minute to go ahead.", a.Name))
	default:
		s.command(cctx, chat, tenant, agents, a, map[string]string{"decide": "decide", "stop": "stop_trading", "resume": "resume_trading"}[name])
	}
}

func (s *Service) command(ctx context.Context, chat int64, tenant string, agents []engine.Agent, a engine.Agent, command string) {
	res, err := s.Engine.Command(ctx, tenant, a.ID, command)
	switch {
	case engine.IsCode(err, "not_running"):
		s.say(ctx, chat, a.Name+" is not running; start it in the app.")
	case err != nil:
		s.Logf("engine: %v", err)
		s.say(ctx, chat, "⚠️ The engine did not answer; try again in a minute.")
	default:
		text := testnet(a, res.Message)
		if res.OK {
			// The agent announces what it did as a notice, in the same words.
			s.remember(chat, a.ID, text)
		}
		s.say(ctx, chat, labelled(label(agents, a), text))
	}
}

// testnet marks a testnet agent's words as the agent's own notices are, so
// they are never mistaken for real trades.
func testnet(a engine.Agent, text string) string {
	if a.Mode == "live" {
		return text
	}
	return "🧪 " + text
}

func label(agents []engine.Agent, a engine.Agent) string {
	if len(agents) > 1 {
		return a.Name
	}
	return ""
}

// pick finds the agent a command is for: the only one, or the one named.
func pick(agents []engine.Agent, name, command string) (engine.Agent, string) {
	var names []string
	for _, a := range agents {
		if strings.EqualFold(a.Name, name) {
			return a, ""
		}
		names = append(names, a.Name)
	}
	switch {
	case len(agents) == 0:
		return engine.Agent{}, "You have no agents yet."
	case name != "":
		return engine.Agent{}, fmt.Sprintf("No agent is called %q. Yours: %s.", name, strings.Join(names, ", "))
	case len(agents) == 1:
		return agents[0], ""
	}
	return engine.Agent{}, fmt.Sprintf("Which agent? For example /%s %s. Yours: %s.", command, names[0], strings.Join(names, ", "))
}

func (s *Service) start(ctx context.Context, m telegram.Message, code string) {
	chat := m.Chat.ID
	if code == "" {
		if _, err := s.Store.Link(ctx, chat); err == nil {
			s.say(ctx, chat, "This chat is connected.\n\n"+helpText)
		} else {
			s.say(ctx, chat, "Open the link from the Candylario app to connect this chat.")
		}
		return
	}
	name := m.From.FirstName
	if m.From.Username != "" {
		name = "@" + m.From.Username
	}
	l, err := s.Store.Redeem(ctx, code, chat, name)
	if errors.Is(err, store.ErrBadCode) {
		s.say(ctx, chat, "This link has expired or was already used. Get a new one from the Candylario app.")
		return
	}
	if err != nil {
		s.Logf("database: %v", err)
		s.say(ctx, chat, "⚠️ Something went wrong; try again in a minute.")
		return
	}
	s.Logf("chat %d connected to tenant %s", chat, l.Tenant)
	s.Wake()
	s.say(ctx, chat, "✅ Connected. Your agents' decisions, trades and alerts will arrive here.\n\n"+helpText)
}
