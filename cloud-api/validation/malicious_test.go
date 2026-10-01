// Spec §19 (Malicious Payload Tests) and §20 (Oversized Request Tests).
//
// Every malformed input must be rejected safely — bounded memory, bounded
// CPU, no panic — and oversized requests must be rejected BEFORE any
// significant work or forwarding to Bifrost.
package validation

import (
	"fmt"
	"net/http"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/streaming"
)

// TestV19_MaliciousPayloads: the malformed-input matrix.
func TestV19_MaliciousPayloads(t *testing.T) {
	cases := []struct {
		name   string
		body   string
		wantSC int
	}{
		{"empty body", "", http.StatusBadRequest},
		{"empty JSON object", "{}", http.StatusBadRequest},
		{"invalid JSON", `{"model": "openai/gpt-4o",`, http.StatusBadRequest},
		{"trailing JSON content", `{"model":"openai/gpt-4o","messages":[{"role":"user","content":"x"}]} {"more":1}`, http.StatusBadRequest},
		{"messages wrong type (object)", `{"model":"openai/gpt-4o","messages":{"role":"user"}}`, http.StatusBadRequest},
		{"messages wrong type (string)", `{"model":"openai/gpt-4o","messages":"hello"}`, http.StatusBadRequest},
		{"invalid role", `{"model":"openai/gpt-4o","messages":[{"role":"robot","content":"x"}]}`, http.StatusBadRequest},
		{"tool message without tool_call_id", `{"model":"openai/gpt-4o","messages":[{"role":"tool","content":"result"}]}`, http.StatusBadRequest},
		{"assistant tool_calls without ids", `{"model":"openai/gpt-4o","messages":[{"role":"assistant","content":"x","tool_calls":[{"function":{"name":"f"}}]}]}`, http.StatusBadRequest},
		{"content wrong type (number)", `{"model":"openai/gpt-4o","messages":[{"role":"user","content":42}]}`, http.StatusBadRequest},
		{"unsupported content block type", `{"model":"openai/gpt-4o","messages":[{"role":"user","content":[{"type":"video","video":"x"}]}]}`, http.StatusBadRequest},
		{"model missing", `{"messages":[{"role":"user","content":"x"}]}`, http.StatusBadRequest},
		{"model without provider", `{"model":"gpt-4o","messages":[{"role":"user","content":"x"}]}`, http.StatusBadRequest},
		{"model invalid charset", `{"model":"openai/gpt-4o\n","messages":[{"role":"user","content":"x"}]}`, http.StatusBadRequest},
		{"temperature out of range", `{"model":"openai/gpt-4o","messages":[{"role":"user","content":"x"}],"temperature":5}`, http.StatusBadRequest},
		{"negative max_tokens", `{"model":"openai/gpt-4o","messages":[{"role":"user","content":"x"}],"max_tokens":-5}`, http.StatusBadRequest},
		{"NaN temperature", `{"model":"openai/gpt-4o","messages":[{"role":"user","content":"x"}],"temperature":NaN}`, http.StatusBadRequest},
		{"Infinity temperature", `{"model":"openai/gpt-4o","messages":[{"role":"user","content":"x"}],"temperature":Infinity}`, http.StatusBadRequest},
		{"reasoning_effort invalid", `{"model":"openai/gpt-4o","messages":[{"role":"user","content":"x"}],"reasoning_effort":"extreme"}`, http.StatusBadRequest},
		{"stop wrong type", `{"model":"openai/gpt-4o","messages":[{"role":"user","content":"x"}],"stop":7}`, http.StatusBadRequest},
		{"tools non-function type", `{"model":"openai/gpt-4o","messages":[{"role":"user","content":"x"}],"tools":[{"type":"retrieval"}]}`, http.StatusBadRequest},
		{"tool params not an object", `{"model":"openai/gpt-4o","messages":[{"role":"user","content":"x"}],"tools":[{"type":"function","function":{"name":"f","parameters":"not-json-obj"}}]}`, http.StatusBadRequest},
		{"invalid idempotency_key charset", `{"model":"openai/gpt-4o","messages":[{"role":"user","content":"x"}],"idempotency_key":"key with spaces!"}`, http.StatusBadRequest},
		{"metadata too many keys", tooManyMetadata(), http.StatusBadRequest},
	}

	baseHeap := memStats().HeapAlloc
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := newStackDefault(t)
			sess := s.sessionFor("evil", "ten_A", "usr_1")

			resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sess, tc.body, nil)
			if err != nil {
				t.Fatalf("post: %v", err)
			}
			defer resp.Body.Close()
			if resp.StatusCode != tc.wantSC {
				t.Fatalf("status=%d want=%d body=%s", resp.StatusCode, tc.wantSC, readAllBody(t, resp))
			}
			// Malformed input must never reach Bifrost.
			if s.bifrost.count() != 0 {
				t.Fatalf("malformed payload reached Bifrost (%d calls)", s.bifrost.count())
			}
		})
	}

	// Resource boundedness across the whole matrix.
	after := memStats().HeapAlloc
	if after > baseHeap+(32<<20) {
		t.Fatalf("heap grew %d bytes processing malicious payloads", after-baseHeap)
	}
}

// TestV19_DeeplyNestedJSON: nesting depth is bounded (Go's decoder caps at
// 10,000; the body limit caps the byte count first).
func TestV19_DeeplyNestedJSON(t *testing.T) {
	s := newStackDefault(t)
	sess := s.sessionFor("deep", "ten_A", "usr_1")

	// ~12k nesting levels inside a metadata string.
	deep := strings.Repeat(`[`, 12000) + strings.Repeat(`]`, 12000)
	body := fmt.Sprintf(`{"model":"openai/gpt-4o","messages":[{"role":"user","content":"x"}],"metadata":{"blob":"%s"}}`, deep)

	start := time.Now()
	resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sess, body, nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("deep nesting: status=%d", resp.StatusCode)
	}
	if d := time.Since(start); d > 5*time.Second {
		t.Fatalf("deep nesting took %s — CPU not bounded", d)
	}
	if s.bifrost.count() != 0 {
		t.Fatal("deep nesting reached Bifrost")
	}
	vm(t, "deep_nesting_reject_ms", time.Since(start).Milliseconds())
}

// TestV19_HugeStrings: strings inside the (bounded) body still validate.
func TestV19_HugeStrings(t *testing.T) {
	s := newStackDefault(t)
	s.bifrost.setScript(standardScript()...)
	sess := s.sessionFor("huge", "ten_A", "usr_1")

	// A ~1MB user message inside the 2MB body limit: valid but huge.
	huge := strings.Repeat("A", 1<<20)
	body := fmt.Sprintf(`{"model":"openai/gpt-4o","messages":[{"role":"user","content":"%s"}],"stream":false}`, huge)

	resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sess, body, nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("huge (in-limit) string: status=%d", resp.StatusCode)
	}
	if s.bifrost.count() != 1 {
		t.Fatalf("in-limit request must forward: calls=%d", s.bifrost.count())
	}
	// The forwarded upstream body must carry it (bounded by the same cap).
	if len(s.bifrost.lastBody()) < (1 << 20) {
		t.Fatal("upstream body lost the payload")
	}
}

// TestV19_InvalidUnicode: Go's JSON decoder replaces invalid UTF-8 and lone
// surrogates with U+FFFD (documented stdlib semantics) — the API must not
// panic or corrupt state, and the sanitized content flows through safely.
func TestV19_InvalidUnicode(t *testing.T) {
	s := newStackDefault(t)
	s.bifrost.setScript(standardScript()...)
	sess := s.sessionFor("uni", "ten_A", "usr_1")

	// \ud800 is a lone surrogate: stdlib JSON unquotes it to U+FFFD.
	body := `{"model":"openai/gpt-4o","messages":[{"role":"user","content":"bad \ud800 escape"}],"stream":false}`
	resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sess, body, nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("unicode sanitization: status=%d (expected stdlib U+FFFD semantics)", resp.StatusCode)
	}
	// The sanitized replacement must never crash the pipeline; the run row
	// exists and is valid.
	for _, r := range s.runs.all() {
		if r.Status != "completed" {
			t.Fatalf("run after unicode sanitization: %+v", r)
		}
	}
	vm(t, "invalid_unicode_handling", "sanitized_ufffd")
}

// TestV19_UnexpectedFields: unknown top-level keys ride along as bounded
// extras (forward compatibility); known-but-wrong-typed keys are rejected.
func TestV19_UnexpectedFields(t *testing.T) {
	s := newStackDefault(t)
	s.bifrost.setScript(standardScript()...)
	sess := s.sessionFor("extras", "ten_A", "usr_1")

	// Unknown provider param: forwarded as an extra (bounded JSON).
	body := `{"model":"openai/gpt-4o","messages":[{"role":"user","content":"x"}],"stream":false,"future_provider_flag":{"nested":{"value":true}}}`
	resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sess, body, nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("forward-compat extra: status=%d", resp.StatusCode)
	}
	if !strings.Contains(s.bifrost.lastBody(), "future_provider_flag") {
		t.Fatal("extras must ride along to the upstream")
	}
}

// TestV19_DuplicateJSONFields: duplicate keys — JSON semantics (last wins)
// with no error, but the fingerprint follows the decoded value, so
// idempotency remains sound.
func TestV19_DuplicateJSONFields(t *testing.T) {
	s := newStackDefault(t)
	s.bifrost.setScript(standardScript()...)
	sess := s.sessionFor("dup", "ten_A", "usr_1")

	body := `{"model":"openai/gpt-4o","model":"openai/gpt-4o","messages":[{"role":"user","content":"a"},{"role":"user","content":"b"}],"messages":[{"role":"user","content":"final"}],"stream":false}`
	resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sess, body, nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("duplicate keys: status=%d", resp.StatusCode)
	}
	// Last value wins: the forwarded request has exactly one messages array
	// with the final content.
	if !strings.Contains(s.bifrost.lastBody(), "final") {
		t.Fatal("duplicate-key semantics wrong: final value not forwarded")
	}
}

// TestV20_OversizedRequests: boundary behavior at limit-1, limit, limit+1,
// 2x and 10x — rejected before Bifrost, bounded resources.
func TestV20_OversizedRequests(t *testing.T) {
	const limit = 64 << 10 // 64 KiB stack for a tight, fast boundary sweep

	mkBody := func(size int) string {
		prefix := `{"model":"openai/gpt-4o","messages":[{"role":"user","content":"`
		suffix := `"}]}`
		pad := size - len(prefix) - len(suffix)
		if pad < 0 {
			pad = 0
		}
		return prefix + strings.Repeat("B", pad) + suffix
	}

	sizes := []struct {
		n    int
		want int
	}{
		{limit - 1, http.StatusOK},
		{limit, http.StatusOK},
		{limit + 1, http.StatusRequestEntityTooLarge},
		{2 * limit, http.StatusRequestEntityTooLarge},
		{10 * limit, http.StatusRequestEntityTooLarge},
	}

	for _, tc := range sizes {
		t.Run(fmt.Sprintf("body_%d", tc.n), func(t *testing.T) {
			o := defaultOpts()
			o.maxBodyBytes = int64(limit)
			s := newStack(t, o)
			s.bifrost.setScript(standardScript()...)
			sess := s.sessionFor("over", "ten_A", "usr_1")

			baseHeap := memStats().HeapAlloc
			resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sess, mkBody(tc.n), nil)
			if err != nil {
				t.Fatalf("post: %v", err)
			}
			eb := decodeErr(t, resp)
			if resp.StatusCode != tc.want {
				t.Fatalf("size=%d: status=%d want=%d (%s)", tc.n, resp.StatusCode, tc.want, eb.Error.Code)
			}
			if tc.want == http.StatusRequestEntityTooLarge {
				if eb.Error.Code != "PAYLOAD_TOO_LARGE" {
					t.Fatalf("size=%d: code=%s", tc.n, eb.Error.Code)
				}
				// Rejected BEFORE Bifrost — no unnecessary work.
				if s.bifrost.count() != 0 {
					t.Fatalf("oversized request reached Bifrost: %d calls", s.bifrost.count())
				}
			}
			after := memStats().HeapAlloc
			if after > baseHeap+(4<<20) {
				t.Fatalf("oversized body blew memory: +%d bytes", after-baseHeap)
			}
		})
	}
}

// TestV20_HugeToolDefinitions: tool surface bounded by MaxTools.
func TestV20_HugeToolDefinitions(t *testing.T) {
	s := newStackDefault(t)
	sess := s.sessionFor("tools", "ten_A", "usr_1")

	tools := make([]string, 0, 200)
	for i := 0; i < 200; i++ { // MaxTools = 128
		tools = append(tools, fmt.Sprintf(`{"type":"function","function":{"name":"tool_%d","parameters":{"type":"object"}}}`, i))
	}
	body := fmt.Sprintf(`{"model":"openai/gpt-4o","messages":[{"role":"user","content":"x"}],"tools":[%s]}`, strings.Join(tools, ","))

	resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sess, body, nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("tool flood: status=%d", resp.StatusCode)
	}
	if s.bifrost.count() != 0 {
		t.Fatal("tool flood reached Bifrost")
	}
}

// TestV19_ConcurrentMaliciousTraffic: abuse under concurrency — service
// stays healthy, goroutines bounded, no panic.
func TestV19_ConcurrentMaliciousTraffic(t *testing.T) {
	s := newStackDefault(t)
	sess := s.sessionFor("flood", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")

	bodies := []string{
		`{"model":"openai/gpt-4o","messages":[{"role":"robot","content":"x"}]}`,
		`{invalid`,
		`{"model":"openai/gpt-4o","messages":[{"role":"user","content":42}]}`,
		strings.Repeat("C", 3<<20), // oversized
		`{"model":"openai/gpt-4o","messages":[{"role":"user","content":"x"}],"temperature":NaN}`,
	}

	base := serverGoroutines()
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			resp, err := s.postRun(0, tok, sess, bodies[n%len(bodies)], nil)
			if err != nil {
				return
			}
			resp.Body.Close()
		}(i)
	}
	wg.Wait()

	// Client keep-alive connections hold transport goroutines for the idle
	// TTL; close them so the measurement reflects server-side state.
	if tr, ok := http.DefaultTransport.(*http.Transport); ok {
		tr.CloseIdleConnections()
	}

	// Handlers and client keep-alives settle briefly.
	if !waitFor(t, 10*time.Second, func() bool { return serverGoroutines() <= base+40 }) {
		t.Fatalf("goroutines=%d (base=%d) after malicious flood", serverGoroutines(), base)
	}
	// The service still works for legitimate traffic.
	s.bifrost.setScript(standardScript()...)
	resp, err := s.postRun(0, tok, sess, runBody("openai/gpt-4o", "still alive", true), nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	events := readSSE(t, resp, streaming.EventRunFinished, 10*time.Second)
	if len(events) == 0 {
		t.Fatal("service degraded after malicious flood")
	}
}

// serverGoroutines counts goroutines that belong to the API under test,
// excluding the embedded miniredis server's own per-connection plumbing.
//
// Root cause (2026-09-28 flake triage): miniredis keeps one goroutine per
// open client conn, and go-redis v9 has NO background idle sweep (idles
// are only reaped on borrow), so a 50-wide concurrent flood leaves ~45
// idle pool conns — each pinning a miniredis peer goroutine — past this
// test's 10s settle window. Those goroutines are harness plumbing, not
// API state. Real connection leaks remain covered by the fdCount
// assertions (spec §22/§32); a leaked API pubsub/reader would still show
// here because its stack carries nexau frames, not miniredis frames.
func serverGoroutines() int {
	buf := make([]byte, 1<<20)
	n := runtime.Stack(buf, true)
	count := 0
	for _, stack := range strings.Split(string(buf[:n]), "\n\n") {
		if stack != "" && !strings.Contains(stack, "alicebob/miniredis") {
			count++
		}
	}
	return count
}

func tooManyMetadata() string {
	pairs := make([]string, 0, 20)
	for i := 0; i < 20; i++ {
		pairs = append(pairs, fmt.Sprintf(`"k%d":"v"`, i))
	}
	return fmt.Sprintf(`{"model":"openai/gpt-4o","messages":[{"role":"user","content":"x"}],"metadata":{%s}}`, strings.Join(pairs, ","))
}
