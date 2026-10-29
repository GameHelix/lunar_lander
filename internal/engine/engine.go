// Package engine calls the Candylario engine API: a tenant's agents, their
// status, commands, and each agent's events as a stream. Its contract is
// the engine's openapi.yaml.
package engine

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type Client struct {
	BaseURL string
	Token   string
	HTTP    *http.Client
}

type Agent struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Mode    string `json:"mode"`
	Running bool   `json:"running"`
}

type Event struct {
	Seq     int64           `json:"seq"`
	Type    string          `json:"type"`
	At      time.Time       `json:"at"`
	Payload json.RawMessage `json:"payload"`
}

// Result is an agent's answer to a command. OK is false when it did not
// act.
type Result struct {
	OK      bool   `json:"ok"`
	Message string `json:"message"`
}

// Error is a request the engine refused, such as not_running.
type Error struct {
	Status  int
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *Error) Error() string { return fmt.Sprintf("engine %d %s: %s", e.Status, e.Code, e.Message) }

// IsCode reports whether err is an engine error with that code.
func IsCode(err error, code string) bool {
	var e *Error
	return errors.As(err, &e) && e.Code == code
}

func (c *Client) request(ctx context.Context, method, path string, body any) (*http.Response, error) {
	var r io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		r = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(c.BaseURL, "/")+path, r)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 300 {
		defer resp.Body.Close()
		var wrap struct {
			Error *Error `json:"error"`
		}
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
		if json.Unmarshal(raw, &wrap) != nil || wrap.Error == nil {
			return nil, &Error{Status: resp.StatusCode, Code: "internal", Message: http.StatusText(resp.StatusCode)}
		}
		wrap.Error.Status = resp.StatusCode
		return nil, wrap.Error
	}
	return resp, nil
}

func (c *Client) do(ctx context.Context, method, path string, body, out any) error {
	resp, err := c.request(ctx, method, path, body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return json.NewDecoder(resp.Body).Decode(out)
}

func agentPath(tenant, agent string, rest string) string {
	return "/v1/tenants/" + url.PathEscape(tenant) + "/agents/" + url.PathEscape(agent) + rest
}

func (c *Client) Agents(ctx context.Context, tenant string) ([]Agent, error) {
	var out struct {
		Agents []Agent `json:"agents"`
	}
	return out.Agents, c.do(ctx, http.MethodGet, "/v1/tenants/"+url.PathEscape(tenant)+"/agents", nil, &out)
}

// Status returns the agent's account as chat text.
func (c *Client) Status(ctx context.Context, tenant, agent string) (string, error) {
	var out struct {
		Message string `json:"message"`
	}
	return out.Message, c.do(ctx, http.MethodGet, agentPath(tenant, agent, "/status"), nil, &out)
}

// Command sends decide, stop_trading, resume_trading or sell_all on the
// user's behalf from Telegram.
func (c *Client) Command(ctx context.Context, tenant, agent, command string) (Result, error) {
	var out Result
	body := map[string]string{"command": command, "via": "telegram"}
	return out, c.do(ctx, http.MethodPost, agentPath(tenant, agent, "/commands"), body, &out)
}

// Stream calls fn with each of the agent's events after seq, as the engine
// stores them, until ctx ends, fn fails or the connection drops.
func (c *Client) Stream(ctx context.Context, tenant, agent string, after int64, fn func(Event) error) error {
	return c.stream(ctx, agentPath(tenant, agent, "/events/stream?after="+strconv.FormatInt(after, 10)), func(data []byte) error {
		var e Event
		if err := json.Unmarshal(data, &e); err != nil {
			return fmt.Errorf("event stream: %w", err)
		}
		return fn(e)
	})
}

// RadarAlert is one unusual move the engine's radar raised. Text is the
// alert as a chat shows it.
type RadarAlert struct {
	Seq       int64     `json:"seq"`
	At        time.Time `json:"at"`
	Coin      string    `json:"coin"`
	Change15m float64   `json:"change_15m"`
	Change1h  float64   `json:"change_1h"`
	Text      string    `json:"text"`
}

// RadarStream passes the radar's alerts numbered above after, as they are
// raised, until the stream drops.
func (c *Client) RadarStream(ctx context.Context, after int64, fn func(RadarAlert) error) error {
	return c.stream(ctx, "/v1/radar/stream?after="+strconv.FormatInt(after, 10), func(data []byte) error {
		var a RadarAlert
		if err := json.Unmarshal(data, &a); err != nil {
			return fmt.Errorf("radar stream: %w", err)
		}
		return fn(a)
	})
}

// RadarSeq is the number of the radar's latest alert, 0 when it has none.
func (c *Client) RadarSeq(ctx context.Context) (int64, error) {
	var out struct {
		Alerts []RadarAlert `json:"alerts"`
	}
	if err := c.do(ctx, http.MethodGet, "/v1/radar/alerts?limit=1", nil, &out); err != nil {
		return 0, err
	}
	if len(out.Alerts) == 0 {
		return 0, nil
	}
	return out.Alerts[0].Seq, nil
}

// stream reads server-sent events from path and gives fn each data field.
func (c *Client) stream(ctx context.Context, path string, fn func(data []byte) error) error {
	resp, err := c.request(ctx, http.MethodGet, path, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 64<<10), 4<<20)
	var data []byte
	for sc.Scan() {
		line := sc.Bytes()
		switch {
		case len(line) == 0 && len(data) > 0:
			if err := fn(data); err != nil {
				return err
			}
			data = data[:0]
		case bytes.HasPrefix(line, []byte("data:")):
			data = append(data, bytes.TrimSpace(line[5:])...)
		}
	}
	if err := sc.Err(); err != nil {
		return err
	}
	return errors.New("event stream closed")
}
