package notifier

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/candylario/notifier/internal/engine"
	"github.com/candylario/notifier/internal/store"
	"github.com/candylario/notifier/internal/telegram"
)

// testDatabase creates an empty, migrated database on the server in
// TEST_DATABASE_URL, or skips the test.
func testDatabase(t *testing.T) string {
	t.Helper()
	base := os.Getenv("TEST_DATABASE_URL")
	if base == "" {
		t.Skip("set TEST_DATABASE_URL to run the notifier tests")
	}
	ctx := context.Background()
	admin, err := pgx.Connect(ctx, base)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close(ctx)
	name := "notifier_test_" + strings.ReplaceAll(uuid.NewString()[:8], "-", "")
	if _, err := admin.Exec(ctx, "create database "+name); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if c, err := pgx.Connect(context.Background(), base); err == nil {
			c.Exec(context.Background(), "drop database "+name+" with (force)")
			c.Close(context.Background())
		}
	})
	i := strings.LastIndex(base, "/")
	url := base[:i+1] + name
	if q := strings.Index(base[i:], "?"); q >= 0 {
		url += base[i+q:]
	}
	if err := store.Migrate(ctx, url); err != nil {
		t.Fatal(err)
	}
	if err := store.Migrate(ctx, url); err != nil {
		t.Fatalf("migrations run once: %v", err)
	}
	return url
}

// fakeTelegram is the Bot API for one bot and its chats.
type fakeTelegram struct {
	mu      sync.Mutex
	updates []telegram.Update
	sent    map[int64][]string
	slow    int // sends to answer with "too many requests" first
}

func (f *fakeTelegram) server(t *testing.T) *httptest.Server {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		w.Header().Set("Content-Type", "application/json")
		method := r.URL.Path[strings.LastIndex(r.URL.Path, "/")+1:]
		f.mu.Lock()
		defer f.mu.Unlock()
		switch method {
		case "getMe":
			io.WriteString(w, `{"ok":true,"result":{"id":1,"username":"TestBot"}}`)
		case "getUpdates":
			offset := int64(body["offset"].(float64))
			var out []telegram.Update
			for _, u := range f.updates {
				if u.UpdateID >= offset {
					out = append(out, u)
				}
			}
			if len(out) == 0 {
				f.mu.Unlock()
				time.Sleep(20 * time.Millisecond)
				f.mu.Lock()
			}
			json.NewEncoder(w).Encode(map[string]any{"ok": true, "result": out})
		case "sendMessage":
			if f.slow > 0 {
				f.slow--
				io.WriteString(w, `{"ok":false,"error_code":429,"description":"Too Many Requests: retry after 1","parameters":{"retry_after":1}}`)
				return
			}
			chat := int64(body["chat_id"].(float64))
			f.sent[chat] = append(f.sent[chat], body["text"].(string))
			io.WriteString(w, `{"ok":true,"result":{}}`)
		default:
			io.WriteString(w, `{"ok":true,"result":true}`)
		}
	}))
	t.Cleanup(s.Close)
	return s
}

// message queues a message from a person in their private chat.
func (f *fakeTelegram) message(chat int64, text string, at time.Time) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.updates = append(f.updates, telegram.Update{UpdateID: int64(len(f.updates) + 1), Message: &telegram.Message{
		From: &telegram.User{ID: chat, Username: "trader" + strconv.FormatInt(chat, 10)}, Chat: telegram.Chat{ID: chat, Type: "private"}, Date: at.Unix(), Text: text}})
}

func (f *fakeTelegram) group(chat, from int64, text string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.updates = append(f.updates, telegram.Update{UpdateID: int64(len(f.updates) + 1), Message: &telegram.Message{
		From: &telegram.User{ID: from}, Chat: telegram.Chat{ID: chat, Type: "group"}, Date: time.Now().Unix(), Text: text}})
}

func (f *fakeTelegram) texts(chat int64) []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.sent[chat])
}

// fakeEngine is the engine API: agents, status, commands and event streams.
type fakeEngine struct {
	mu       sync.Mutex
	agents   map[string][]engine.Agent
	events   map[string][]engine.Event
	changed  chan struct{}
	commands []string
	results  map[string]engine.Result
	status   string
}

func (f *fakeEngine) server(t *testing.T) *httptest.Server {
	mux := http.NewServeMux()
	auth := func(h http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Authorization") != "Bearer engine-token" {
				w.WriteHeader(http.StatusUnauthorized)
				io.WriteString(w, `{"error":{"code":"unauthorized","message":"no"}}`)
				return
			}
			h(w, r)
		}
	}
	mux.HandleFunc("GET /v1/tenants/{t}/agents", auth(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		agents, ok := f.agents[r.PathValue("t")]
		f.mu.Unlock()
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			io.WriteString(w, `{"error":{"code":"not_found","message":"no such tenant"}}`)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"agents": agents})
	}))
	mux.HandleFunc("GET /v1/tenants/{t}/agents/{a}/status", auth(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		json.NewEncoder(w).Encode(map[string]string{"message": f.status})
	}))
	mux.HandleFunc("POST /v1/tenants/{t}/agents/{a}/commands", auth(func(w http.ResponseWriter, r *http.Request) {
		var c struct{ Command, Via string }
		json.NewDecoder(r.Body).Decode(&c)
		f.mu.Lock()
		defer f.mu.Unlock()
		f.commands = append(f.commands, r.PathValue("a")+" "+c.Command+" "+c.Via)
		res, ok := f.results[c.Command]
		if !ok {
			res = engine.Result{OK: true, Message: "done: " + c.Command}
		}
		json.NewEncoder(w).Encode(res)
	}))
	mux.HandleFunc("GET /v1/tenants/{t}/agents/{a}/events/stream", auth(func(w http.ResponseWriter, r *http.Request) {
		after, _ := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		flush := w.(http.Flusher)
		for {
			f.mu.Lock()
			events, changed := f.events[r.PathValue("a")], f.changed
			f.mu.Unlock()
			for _, e := range events {
				if e.Seq > after {
					raw, _ := json.Marshal(e)
					fmt.Fprintf(w, "id: %d\nevent: %s\ndata: %s\n\n", e.Seq, e.Type, raw)
					after = e.Seq
				}
			}
			flush.Flush()
			select {
			case <-r.Context().Done():
				return
			case <-changed:
			}
		}
	}))
	s := httptest.NewServer(mux)
	t.Cleanup(s.Close)
	return s
}

func (f *fakeEngine) add(agent, typ string, at time.Time, payload any) {
	raw, _ := json.Marshal(payload)
	f.mu.Lock()
	defer f.mu.Unlock()
	f.events[agent] = append(f.events[agent], engine.Event{Seq: int64(len(f.events[agent]) + 1), Type: typ, At: at.UTC(), Payload: raw})
	close(f.changed)
	f.changed = make(chan struct{})
}

func (f *fakeEngine) notice(agent, text string) {
	f.add(agent, "notice", time.Now(), map[string]string{"text": text})
}

func (f *fakeEngine) sentCommands() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.commands)
}

type rig struct {
	t      *testing.T
	store  *store.Store
	tg     *fakeTelegram
	eng    *fakeEngine
	tgURL  string
	engURL string
	stop   func()
}

func newRig(t *testing.T) *rig {
	st, err := store.Open(context.Background(), testDatabase(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(st.Close)
	r := &rig{t: t, store: st, tg: &fakeTelegram{sent: map[int64][]string{}},
		eng: &fakeEngine{agents: map[string][]engine.Agent{}, events: map[string][]engine.Event{}, changed: make(chan struct{}), results: map[string]engine.Result{}}}
	r.tgURL, r.engURL = r.tg.server(t).URL, r.eng.server(t).URL
	r.start()
	t.Cleanup(func() { r.stop() })
	return r
}

// start runs a notifier, as a restart would.
func (r *rig) start() {
	svc := &Service{Store: r.store, Logf: r.t.Logf, Refresh: 50 * time.Millisecond, Retry: 50 * time.Millisecond, Gap: time.Millisecond, Rate: 1000,
		Bot:    &telegram.Bot{HTTP: http.DefaultClient, BaseURL: r.tgURL, Token: "bot-token"},
		Engine: &engine.Client{BaseURL: r.engURL, Token: "engine-token", HTTP: http.DefaultClient}}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { svc.Run(ctx); close(done) }()
	r.stop = func() { cancel(); <-done; time.Sleep(20 * time.Millisecond) }
}

func (r *rig) waitFor(what string, ok func() bool) {
	r.t.Helper()
	for deadline := time.Now().Add(5 * time.Second); !ok(); time.Sleep(10 * time.Millisecond) {
		if time.Now().After(deadline) {
			r.t.Fatalf("timed out waiting for %s", what)
		}
	}
}

// said reports whether the chat got a message containing substr.
func (r *rig) said(chat int64, substr string) bool {
	return slices.ContainsFunc(r.tg.texts(chat), func(m string) bool { return strings.Contains(m, substr) })
}

func (r *rig) count(chat int64, substr string) int {
	n := 0
	for _, m := range r.tg.texts(chat) {
		if strings.Contains(m, substr) {
			n++
		}
	}
	return n
}

// link connects a chat to the tenant through a one-time code.
func (r *rig) link(chat int64, tenant uuid.UUID) string {
	code, err := r.store.NewCode(context.Background(), tenant, time.Minute)
	if err != nil {
		r.t.Fatal(err)
	}
	r.tg.message(chat, "/start "+code, time.Now())
	r.waitFor("the chat to connect", func() bool { return r.said(chat, "✅ Connected") })
	return code
}

func TestAChatConnectsGetsTheNewsAndControlsItsAgent(t *testing.T) {
	r := newRig(t)
	tenant, agent := uuid.New(), uuid.NewString()
	r.eng.agents[tenant.String()] = []engine.Agent{{ID: agent, Name: "btc-eth", Mode: "testnet", Running: true}}
	r.eng.add(agent, "notice", time.Now().Add(-time.Hour), map[string]string{"text": "🧪 old news"})
	r.eng.add(agent, "equity.hourly", time.Now(), map[string]string{"equity": "100"})

	code := r.link(42, tenant)
	r.eng.notice(agent, "🧪 🧠 Decision #2: scheduled check")
	r.waitFor("the decision", func() bool { return r.said(42, "Decision #2") })
	if r.said(42, "old news") {
		t.Fatal("notices from before the chat connected are not sent")
	}

	r.eng.results["stop_trading"] = engine.Result{OK: true, Message: "🛑 Trading stopped. Holdings are kept; /resume to trade again."}
	r.tg.message(42, "/stop", time.Now())
	r.waitFor("the stop reply", func() bool { return r.said(42, "🧪 🛑 Trading stopped") })
	// The agent announces the stop as a notice too; the chat already has it.
	r.eng.notice(agent, "🧪 🛑 Trading stopped. Holdings are kept; /resume to trade again.")
	r.eng.notice(agent, "🧪 marker")
	r.waitFor("the marker", func() bool { return r.said(42, "marker") })
	if n := r.count(42, "Trading stopped"); n != 1 {
		t.Fatalf("the stop must arrive once, got %d: %q", n, r.tg.texts(42))
	}

	r.eng.results["decide"] = engine.Result{OK: false, Message: "🛑 Trading is stopped (you stopped trading). Send /resume first."}
	r.tg.message(42, "/decide", time.Now())
	r.waitFor("the refusal", func() bool { return r.said(42, "Send /resume first") })

	r.tg.message(42, "/sellall", time.Now())
	r.waitFor("the question", func() bool { return r.said(42, "Send /confirm") })
	if slices.ContainsFunc(r.eng.sentCommands(), func(c string) bool { return strings.Contains(c, "sell_all") }) {
		t.Fatal("nothing is sold before the user confirms")
	}
	r.tg.message(42, "/confirm", time.Now())
	r.waitFor("the sell-off", func() bool { return r.said(42, "done: sell_all") })

	r.eng.status = "📊 Status (testnet: test money, real prices)\nTrading: on"
	r.tg.message(42, "/status", time.Now())
	r.waitFor("the status", func() bool { return r.said(42, "🧪 📊 Status") })

	r.tg.message(42, "/decide", time.Now().Add(-20*time.Minute))
	r.waitFor("a late command to be ignored", func() bool { return r.said(42, "Ignored /decide") })

	want := []string{agent + " stop_trading telegram", agent + " decide telegram", agent + " sell_all telegram"}
	if got := r.eng.sentCommands(); !slices.Equal(got, want) {
		t.Fatalf("commands %q, want %q", got, want)
	}

	r.tg.group(-100, 42, "/sellall")
	r.tg.message(7, "/stop", time.Now())
	r.waitFor("a stranger's answer", func() bool { return r.said(7, "not connected") })
	r.tg.message(8, "/start "+code, time.Now())
	r.waitFor("a used link to be refused", func() bool { return r.said(8, "expired or was already used") })
	if len(r.tg.texts(-100)) != 0 || len(r.eng.sentCommands()) != 3 {
		t.Fatal("groups and strangers cannot command an agent")
	}

	r.tg.message(42, "/disconnect", time.Now())
	r.waitFor("the goodbye", func() bool { return r.said(42, "Disconnected") })
	r.eng.notice(agent, "🧪 after the goodbye")
	time.Sleep(300 * time.Millisecond)
	if r.said(42, "after the goodbye") {
		t.Fatal("a disconnected chat gets nothing more")
	}
}

func TestRestartsNeitherRepeatNorLoseAnything(t *testing.T) {
	r := newRig(t)
	tenant, agent := uuid.New(), uuid.NewString()
	r.eng.agents[tenant.String()] = []engine.Agent{{ID: agent, Name: "btc-eth", Mode: "live", Running: true}}
	r.link(42, tenant)
	r.eng.notice(agent, "first")
	r.waitFor("the first notice", func() bool { return r.said(42, "first") })

	r.stop()
	r.eng.notice(agent, "while down")
	r.start()
	r.waitFor("the missed notice", func() bool { return r.said(42, "while down") })
	time.Sleep(200 * time.Millisecond)
	if r.count(42, "first") != 1 || r.count(42, "✅ Connected") != 1 {
		t.Fatalf("after a restart nothing repeats: %q", r.tg.texts(42))
	}
}

func TestSeveralAgentsAreNamed(t *testing.T) {
	r := newRig(t)
	tenant, btc, eth := uuid.New(), uuid.NewString(), uuid.NewString()
	r.eng.agents[tenant.String()] = []engine.Agent{{ID: btc, Name: "btc", Mode: "live"}, {ID: eth, Name: "eth", Mode: "live"}}
	r.link(42, tenant)
	r.tg.message(42, "/stop", time.Now())
	r.waitFor("the question", func() bool { return r.said(42, "Which agent?") })
	r.tg.message(42, "/stop eth", time.Now())
	r.waitFor("the stop", func() bool { return r.said(42, "[eth] done: stop_trading") })
	if got := r.eng.sentCommands(); len(got) != 1 || got[0] != eth+" stop_trading telegram" {
		t.Fatalf("commands %q", got)
	}
	r.eng.notice(btc, "bought BTC")
	r.waitFor("a labelled notice", func() bool { return r.said(42, "[btc] bought BTC") })
}

func TestTelegramAskingToSlowDownDelaysButKeepsMessages(t *testing.T) {
	r := newRig(t)
	tenant, agent := uuid.New(), uuid.NewString()
	r.eng.agents[tenant.String()] = []engine.Agent{{ID: agent, Name: "btc-eth", Mode: "live"}}
	r.link(42, tenant)
	r.tg.mu.Lock()
	r.tg.slow = 1
	r.tg.mu.Unlock()
	r.eng.notice(agent, "one")
	r.eng.notice(agent, "two")
	r.waitFor("both notices", func() bool { return r.said(42, "two") })
	if got := r.tg.texts(42); got[len(got)-2] != "one" || got[len(got)-1] != "two" {
		t.Fatalf("in order, none lost: %q", got)
	}
}
