// Spec §5 (Duplicate Request / Idempotency Tests) and §18 (Tenant Isolation
// Attack Tests).
package validation

import (
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/domain"
	"github.com/nexau-cloud/nexau-api/internal/streaming"
)

// TestV05_IdempotentRetryAfterTimeout: the network-times-out-then-retries
// scenario. One logical operation must execute exactly once and bill once.
func TestV05_IdempotentRetryAfterTimeout(t *testing.T) {
	s := newStackDefault(t)
	s.bifrost.setScript(standardScript()...)
	sess := s.sessionFor("idem", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")
	body := runBody("openai/gpt-4o", "analyze Q3 revenue", true)
	hdrs := map[string]string{"Idempotency-Key": "idem_retry_1"}

	// Attempt 1: full success (the "network succeeded" case).
	resp, err := s.postRun(0, tok, sess, body, hdrs)
	if err != nil {
		t.Fatalf("post 1: %v", err)
	}
	events := readSSE(t, resp, streaming.EventRunFinished, 10*time.Second)
	if len(events) == 0 {
		t.Fatal("first attempt produced no events")
	}
	runID := events[0].env.RunID
	// The network-timeout-then-retry scenario implies the client's timeout
	// exceeded the request duration: by retry time the first attempt is
	// fully finalized (terminal row + idempotency completion).
	if !waitFor(t, 5*time.Second, func() bool {
		r := s.runs.get(runID)
		return r != nil && r.Terminal()
	}) {
		t.Fatal("first attempt never finalized")
	}

	// Attempt 2: same Idempotency-Key, same payload (the "retry after timeout").
	resp, err = s.postRun(0, tok, sess, body, hdrs)
	if err != nil {
		t.Fatalf("post 2: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("retry: status=%d (expected replay of prior outcome)", resp.StatusCode)
	}
	var replay struct {
		Run *domain.Run `json:"run"`
	}
	raw := readAllBody(t, resp)
	if err := json.Unmarshal([]byte(raw), &replay); err != nil {
		t.Fatalf("replay body not JSON: %s", raw)
	}
	if replay.Run == nil || replay.Run.ID != runID {
		t.Fatalf("replay returned different run: %+v want %s", replay.Run, runID)
	}

	// Exactly one upstream execution, exactly one usage record.
	if s.bifrost.count() != 1 {
		t.Fatalf("upstream executions=%d, want exactly 1", s.bifrost.count())
	}
	waitFor(t, 3*time.Second, func() bool { return len(s.usage.records()) == 1 })
	if n := len(s.usage.records()); n != 1 {
		t.Fatalf("usage records=%d, want exactly 1 (no double billing)", n)
	}
	vm(t, "idempotency_retry_upstream_calls", s.bifrost.count())
	vm(t, "idempotency_retry_usage_records", len(s.usage.records()))
}

// TestV05_SameKeyDifferentPayload: idempotency key reuse with a different
// body is rejected (422).
func TestV05_SameKeyDifferentPayload(t *testing.T) {
	s := newStackDefault(t)
	s.bifrost.setScript(standardScript()...)
	sess := s.sessionFor("idem", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")
	hdrs := map[string]string{"Idempotency-Key": "idem_mismatch_1"}

	resp, err := s.postRun(0, tok, sess, runBody("openai/gpt-4o", "first payload", true), hdrs)
	if err != nil {
		t.Fatalf("post 1: %v", err)
	}
	readSSE(t, resp, streaming.EventRunFinished, 10*time.Second)

	resp, err = s.postRun(0, tok, sess, runBody("openai/gpt-4o", "DIFFERENT payload", true), hdrs)
	if err != nil {
		t.Fatalf("post 2: %v", err)
	}
	eb := decodeErr(t, resp)
	if resp.StatusCode != http.StatusUnprocessableEntity || eb.Error.Code != "IDEMPOTENCY_KEY_REUSE" {
		t.Fatalf("key reuse: got %d/%s, want 422/IDEMPOTENCY_KEY_REUSE", resp.StatusCode, eb.Error.Code)
	}
	if s.bifrost.count() != 1 {
		t.Fatalf("second payload must not execute upstream: calls=%d", s.bifrost.count())
	}
}

// TestV05_DifferentKeySamePayload: a different key with the same payload is a
// NEW logical operation — executes twice.
func TestV05_DifferentKeySamePayload(t *testing.T) {
	s := newStackDefault(t)
	s.bifrost.setScript(standardScript()...)
	sess := s.sessionFor("idem", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")
	body := runBody("openai/gpt-4o", "same logical content", true)

	for _, key := range []string{"idem_k1", "idem_k2"} {
		resp, err := s.postRun(0, tok, sess, body, map[string]string{"Idempotency-Key": key})
		if err != nil {
			t.Fatalf("post %s: %v", key, err)
		}
		events := readSSE(t, resp, streaming.EventRunFinished, 10*time.Second)
		if len(events) == 0 {
			t.Fatalf("run with key %s produced no events", key)
		}
	}
	if s.bifrost.count() != 2 {
		t.Fatalf("upstream calls=%d, want 2 (distinct keys are distinct operations)", s.bifrost.count())
	}
}

// TestV05_ConcurrentDuplicateInFlight: two identical requests racing while
// the first is executing — the loser must get a clean 409 (or a replay after
// the winner finishes), never a second execution.
func TestV05_ConcurrentDuplicateInFlight(t *testing.T) {
	s := newStackDefault(t)
	// Long script so the first run is still executing when the duplicate lands.
	s.bifrost.setScript(
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","content":"a"}}]}`, delay: 50 * time.Millisecond},
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"content":"b"}}]}`, delay: 900 * time.Millisecond},
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}`, delay: 100 * time.Millisecond},
		chunk{data: `[DONE]`, delay: 0},
	)
	sess := s.sessionFor("idem", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")
	body := runBody("openai/gpt-4o", "racing duplicate", true)
	hdrs := map[string]string{"Idempotency-Key": "idem_race_1"}

	type outcome struct {
		status int
		code   string
	}
	out := make(chan outcome, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			resp, err := s.postRun(0, tok, sess, body, hdrs)
			if err != nil {
				out <- outcome{status: -1, code: err.Error()}
				return
			}
			if resp.StatusCode == http.StatusOK && strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") {
				events := readSSE(t, resp, streaming.EventRunFinished, 15*time.Second)
				if len(events) == 0 {
					out <- outcome{status: 200, code: "NO_EVENTS"}
					return
				}
				out <- outcome{status: 200, code: "STREAMED"}
				return
			}
			eb := decodeErr(t, resp)
			out <- outcome{status: resp.StatusCode, code: eb.Error.Code}
		}()
	}
	wg.Wait()
	close(out)

	var streamed, rejected int
	for o := range out {
		switch {
		case o.status == 200 && o.code == "STREAMED":
			streamed++
		case o.status == http.StatusConflict && o.code == "DUPLICATE_IN_PROGRESS":
			rejected++
		case o.status == 200:
			// JSON replay of the completed run — also acceptable.
			rejected++
		default:
			t.Fatalf("unexpected duplicate outcome: %d/%s", o.status, o.code)
		}
	}
	if streamed != 1 {
		t.Fatalf("exactly one stream must execute; got %d (rejected=%d)", streamed, rejected)
	}
	if s.bifrost.count() != 1 {
		t.Fatalf("upstream executions=%d, want 1", s.bifrost.count())
	}
}

// TestV18_TenantIsolationAttacks: A1/ten_A against every B-owned resource,
// plus forged identifiers.
func TestV18_TenantIsolationAttacks(t *testing.T) {
	s := newStackDefault(t)
	s.bifrost.setScript(standardScript()...)

	sessB := s.sessionFor("iso", "ten_B", "usr_b1")
	runB := s.startRun(t, "iso", "ten_B", "usr_b1", sessB)

	tokA := s.tokenFor("usr_1", "ten_A")
	sessA := s.sessionFor("iso", "ten_A", "usr_1")

	attack := func(name, method, path, body string) {
		t.Run(name, func(t *testing.T) {
			var resp *http.Response
			var err error
			switch method {
			case http.MethodGet:
				resp, err = s.get(0, tokA, path)
			case http.MethodPost:
				resp, err = s.post(0, tokA, path, body)
			}
			if err != nil {
				t.Fatalf("request: %v", err)
			}
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusNotFound && resp.StatusCode != http.StatusForbidden {
				b := readAllBody(t, resp)
				t.Fatalf("cross-tenant access returned %d: %s", resp.StatusCode, b)
			}
		})
	}

	attack("A1 → B session run creation", http.MethodPost, "/v1/agent/sessions/"+sessB+"/runs", runBody("openai/gpt-4o", "x", true))
	attack("A1 → B session read", http.MethodGet, "/v1/agent/sessions/"+sessB, "")
	attack("A1 → B run read", http.MethodGet, "/v1/agent/runs/"+runB, "")
	attack("A1 → B run cancel", http.MethodPost, "/v1/agent/runs/"+runB+"/cancel", "")
	attack("A1 → B usage (foreign run usage is never visible)", http.MethodGet, "/v1/agent/runs/"+runB+"/usage", "")

	// Forged identifiers: the attacker fabricates tenant/user/session/run ids
	// in the body — none of them may grant access.
	forged := map[string]string{
		"forged tenant_id":  `{"model":"openai/gpt-4o","messages":[{"role":"user","content":"x"}],"stream":true,"tenant_id":"ten_B"}`,
		"forged user_id":    `{"model":"openai/gpt-4o","messages":[{"role":"user","content":"x"}],"stream":true,"user_id":"usr_b1"}`,
		"forged session_id": `{"model":"openai/gpt-4o","messages":[{"role":"user","content":"x"}],"stream":true,"session_id":"` + sessB + `"}`,
	}
	for name, body := range forged {
		t.Run(name, func(t *testing.T) {
			// Against A's OWN session path: the run must execute within A's
			// identity — the forged fields must not redirect anything.
			resp, err := s.postRun(0, tokA, sessA, body, nil)
			if err != nil {
				t.Fatalf("post: %v", err)
			}
			events := readSSE(t, resp, streaming.EventRunFinished, 10*time.Second)
			if len(events) == 0 {
				t.Fatal("forged fields must not break a legitimate run")
			}
			for _, e := range events {
				if e.env.SessionID != sessA || (e.env.RunID != "" && e.env.RunID == runB) {
					t.Fatalf("forged ids redirected delivery: session=%s run=%s", e.env.SessionID, e.env.RunID)
				}
			}
			// Against B's session path: rejected as before.
			resp, err = s.postRun(0, tokA, sessB, body, nil)
			if err != nil {
				t.Fatalf("post B: %v", err)
			}
			resp.Body.Close()
			if resp.StatusCode != http.StatusNotFound {
				t.Fatalf("forged ids on B session: status=%d", resp.StatusCode)
			}
		})
	}

	// Usage attribution check: everything billed belongs to the right tenant.
	waitFor(t, 3*time.Second, func() bool { return len(s.usage.records()) >= 1 })
	for _, r := range s.usage.records() {
		if r.TenantID != "ten_A" && r.TenantID != "ten_B" {
			t.Fatalf("usage attributed to unknown tenant: %+v", r)
		}
		if r.TenantID == "ten_A" && r.UserID != "usr_1" {
			t.Fatalf("usage attributed to wrong user: %+v", r)
		}
	}
}

// startRun helper: create + fully execute a run as the given identity.
func (s *stack) startRun(t *testing.T, tag, tenant, user, sessionID string) string {
	t.Helper()
	tok := s.tokenFor(user, tenant)
	resp, err := s.postRun(0, tok, sessionID, runBody("openai/gpt-4o", "seed run "+tag, true), nil)
	if err != nil {
		t.Fatalf("seed post: %v", err)
	}
	events := readSSE(t, resp, streaming.EventRunFinished, 10*time.Second)
	if len(events) == 0 {
		t.Fatalf("seed run %s produced no events", tag)
	}
	return events[0].env.RunID
}
