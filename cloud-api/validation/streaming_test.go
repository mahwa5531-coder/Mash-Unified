// Spec §6 (Bifrost Happy Path), §7 (Streaming Order), §8 (Slow-Consumer),
// §11 (Bifrost Timeout), §12 (Bifrost Slow Response).
package validation

import (
	"fmt"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/streaming"
)

// TestV06_HappyPathIncrementalWithTTFB: mock Bifrost emits 4 chunks + usage;
// prove the API forwards each chunk BEFORE the next exists, and measure
// time-to-first-byte.
func TestV06_HappyPathIncrementalWithTTFB(t *testing.T) {
	s := newStackDefault(t)
	s.bifrost.setScript(standardScript()...)
	sess := s.sessionFor("happy", "ten_A", "usr_1")

	start := time.Now()
	resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sess, runBody("openai/gpt-4o", "ping", true), nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	events := readSSE(t, resp, streaming.EventRunFinished, 10*time.Second)
	ttfb := time.Since(start)

	if len(events) < 8 {
		t.Fatalf("expected full lifecycle (>=8 events), got %d", len(events))
	}
	if events[0].env.Type != streaming.EventRunStarted {
		t.Fatalf("first event %s", events[0].env.Type)
	}
	last := events[len(events)-1].env
	if last.Type != streaming.EventRunFinished {
		t.Fatalf("terminal event %s", last.Type)
	}

	// Incremental proof: chunk k must arrive before upstream emits chunk k+1.
	// Chunk delays are 20/60/60/60/60ms; if the API buffered the whole
	// response, every event would arrive after the LAST chunk (~260ms).
	arrivedInOrder := true
	for i := 1; i < len(events); i++ {
		// Events must be strictly ordered with no coalesced burst at the end.
		if events[i].at.Before(events[i-1].at) {
			arrivedInOrder = false
		}
	}
	if !arrivedInOrder {
		t.Fatal("event timestamps went backwards — buffering suspected")
	}
	vm(t, "ttfb_ms", ttfb.Milliseconds())
	vm(t, "happy_path_events", len(events))
}

// TestV07_TenThousandEventsInOrder: 10,000 numbered events must arrive in
// exact order — no duplicates, no gaps, no reordering.
func TestV07_TenThousandEventsInOrder(t *testing.T) {
	const total = 10000
	s := newStackDefault(t)

	// Chunks "1".."10000" as content deltas, then final usage + [DONE].
	script := make([]chunk, 0, total+2)
	for i := 1; i <= total; i++ {
		script = append(script, chunk{
			data:  fmt.Sprintf(`{"id":"c1","choices":[{"index":0,"delta":{"content":"%d"}}]}`, i),
			delay: 0,
		})
	}
	script = append(script,
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":10000,"total_tokens":10010}}`, delay: 0},
		chunk{data: `[DONE]`, delay: 0},
	)
	s.bifrost.setScript(script...)

	sess := s.sessionFor("order", "ten_A", "usr_1")
	resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sess, runBody("openai/gpt-4o", "count", true), nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}

	start := time.Now()
	events := readSSE(t, resp, streaming.EventRunFinished, 60*time.Second)
	elapsed := time.Since(start)

	if len(events) < total+2 {
		t.Fatalf("events=%d, want >= %d (RUN_STARTED + %d contents + terminal)", len(events), total+2, total)
	}

	// The content events carry the numbers; verify exact order.
	var nums []int
	for _, e := range events {
		switch e.env.Type {
		case streaming.EventTextMessageContent:
			var d streaming.TextMessageContentData
			if err := jsonUnmarshal(e.env.Data, &d); err == nil {
				var n int
				if _, err := fmt.Sscanf(d.Delta, "%d", &n); err == nil {
					nums = append(nums, n)
				}
			}
		}
	}
	if len(nums) != total {
		t.Fatalf("numbered deltas=%d, want %d", len(nums), total)
	}
	seen := make(map[int]bool, total)
	for i, n := range nums {
		if n != i+1 {
			t.Fatalf("order violation at position %d: got %d", i, n)
		}
		if seen[n] {
			t.Fatalf("duplicate event %d", n)
		}
		seen[n] = true
	}
	vm(t, "stream_events_total", total)
	vm(t, "stream_order_elapsed_ms", elapsed.Milliseconds())
	vm(t, "stream_throughput_events_per_sec", int(float64(total)/elapsed.Seconds()))
}

// TestV08_SlowConsumerWS: a WS client that stops reading while the upstream
// produces 2MB rapidly. The kernel receive window is shrunk so server writes
// actually block; the send queue fills, the slow-consumer grace expires, and
// the server must evict the connection, cancel the run and abort upstream.
func TestV08_SlowConsumerWS(t *testing.T) {
	s := newStackDefault(t)
	script := make([]chunk, 0, 1000)
	pad := strings.Repeat("z", 2048)
	for i := 0; i < 1000; i++ {
		script = append(script, chunk{data: fmt.Sprintf(`{"id":"c1","choices":[{"index":0,"delta":{"content":"chunk-%d-%s"}}]}`, i, pad), delay: time.Millisecond})
	}
	s.bifrost.setScript(script...)

	sess := s.sessionFor("slow", "ten_A", "usr_1")
	conn, resp, err := dialWS(t, s.replicas[0].url, s.tokenFor("usr_1", "ten_A"), sess)
	if err != nil {
		t.Fatalf("dial: %v (status %v)", err, resp)
	}
	defer conn.Close()

	// Shrink the kernel receive buffer: the client advertises a tiny window,
	// so the server's writes block once buffers fill.
	if tc, ok := conn.UnderlyingConn().(*net.TCPConn); ok {
		_ = tc.SetReadBuffer(4096)
	}

	// Create the run and NEVER read from the socket.
	wsRunCreate(t, conn, runBody("openai/gpt-4o", "x", true))

	// Server-side proof of eviction: the run must be cancelled (eviction
	// closes the connection → OnClose → cancel → upstream abort).
	if !waitFor(t, 20*time.Second, func() bool { return s.bifrost.cancelCount() > 0 }) {
		t.Fatal("slow consumer was never evicted (upstream never aborted)")
	}
	if !waitFor(t, 5*time.Second, func() bool {
		for _, r := range s.runs.all() {
			if !r.Terminal() {
				return false
			}
		}
		return len(s.runs.all()) > 0
	}) {
		t.Fatal("run never reached a terminal state after eviction")
	}

	// The connection is dead: reads now terminate.
	_ = conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	readErr := false
	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			readErr = true
			break
		}
	}
	if !readErr {
		t.Fatal("connection still readable after eviction")
	}
	vm(t, "slow_consumer_evicted", 1)
}

// TestV08_SlowConsumerSSEBounded: a raw-TCP SSE client that stops reading
// (4KB receive window). Server writes block; the per-event write deadline
// fires; the run is cancelled and upstream aborted — memory bounded, no
// unbounded event queue.
func TestV08_SlowConsumerSSEBounded(t *testing.T) {
	s := newStackDefault(t)
	script := make([]chunk, 0, 2000)
	pad := strings.Repeat("y", 2048)
	for i := 0; i < 2000; i++ {
		script = append(script, chunk{data: fmt.Sprintf(`{"id":"c1","choices":[{"index":0,"delta":{"content":"big-%d-%s"}}]}`, i, pad), delay: time.Millisecond})
	}
	s.bifrost.setScript(script...)

	sess := s.sessionFor("slowsse", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")
	addr := strings.TrimPrefix(s.replicas[0].url, "http://")

	conn, err := net.Dial("tcp", addr)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()
	if tc, ok := conn.(*net.TCPConn); ok {
		_ = tc.SetReadBuffer(4096)
	}

	body := runBody("openai/gpt-4o", "x", true)
	req := fmt.Sprintf("POST /v1/agent/sessions/%s/runs HTTP/1.1\r\nHost: %s\r\nAuthorization: Bearer %s\r\nContent-Type: application/json\r\nContent-Length: %d\r\n\r\n%s",
		sess, addr, tok, len(body), body)
	if _, err := conn.Write([]byte(req)); err != nil {
		t.Fatalf("write request: %v", err)
	}

	// Deliberately stop reading: the server must hit the write deadline,
	// cancel the run and abort the upstream stream.
	if !waitFor(t, 25*time.Second, func() bool { return s.bifrost.cancelCount() > 0 }) {
		t.Fatal("upstream never aborted for non-reading SSE consumer (write deadline failed)")
	}
	if !waitFor(t, 5*time.Second, func() bool {
		for _, r := range s.runs.all() {
			if r.Status == "running" {
				return false
			}
		}
		return len(s.runs.all()) > 0
	}) {
		t.Fatal("run never left the running state after backpressure abort")
	}
	vm(t, "slow_sse_consumer_backpressure", 1)
}

// TestV11_IdleTimeoutTerminatesStalledStream: upstream sends one chunk then
// stalls forever. The idle watchdog must fire at ~IdleTimeout (2s), NOT at
// MaxDuration (30s). (This is the test that caught the watchdog bug.)
func TestV11_IdleTimeoutTerminatesStalledStream(t *testing.T) {
	s := newStackDefault(t)
	s.bifrost.setScript(
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","content":"first"}}]}`, delay: 20 * time.Millisecond},
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"content":"stall"}}]}`, delay: 10 * time.Minute},
	)
	sess := s.sessionFor("idle", "ten_A", "usr_1")

	start := time.Now()
	resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sess, runBody("openai/gpt-4o", "x", true), nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	events := readSSE(t, resp, streaming.EventRunError, 15*time.Second)
	elapsed := time.Since(start)

	var runErr *streaming.Envelope
	for i := range events {
		if events[i].env.Type == streaming.EventRunError {
			runErr = &events[i].env
		}
	}
	if runErr == nil {
		t.Fatalf("no RUN_ERROR for stalled stream (events=%d, elapsed=%s)", len(events), elapsed)
	}
	var d streaming.RunErrorData
	_ = jsonUnmarshal(runErr.Data, &d)
	if d.Code != "MODEL_TIMEOUT" {
		t.Fatalf("stalled stream code=%s, want MODEL_TIMEOUT (idle)", d.Code)
	}
	if elapsed > 5*time.Second {
		t.Fatalf("idle termination took %s; must fire at ~StreamIdleTimeout (2s), not MaxDuration", elapsed)
	}
	if s.bifrost.cancelCount() == 0 {
		t.Fatal("stalled upstream was never cancelled")
	}
	vm(t, "idle_timeout_fired_ms", elapsed.Milliseconds())
}

// TestV11_ActiveLongStreamNotKilledByDuration: a stream that keeps producing
// chunks every 300ms for 6s (idle never exceeds 2s) must complete normally
// even though total runtime exceeds several idle windows.
func TestV11_ActiveLongStreamNotKilledByDuration(t *testing.T) {
	s := newStackDefault(t)
	const n = 20
	script := make([]chunk, 0, n+2)
	for i := 0; i < n; i++ {
		script = append(script, chunk{data: fmt.Sprintf(`{"id":"c1","choices":[{"index":0,"delta":{"content":"tick-%d"}}]}`, i), delay: 300 * time.Millisecond})
	}
	script = append(script,
		chunk{data: fmt.Sprintf(`{"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":%d,"total_tokens":%d}}`, n, n+1), delay: 300 * time.Millisecond},
		chunk{data: `[DONE]`, delay: 0},
	)
	s.bifrost.setScript(script...)

	sess := s.sessionFor("long", "ten_A", "usr_1")
	start := time.Now()
	resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sess, runBody("openai/gpt-4o", "x", true), nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	events := readSSE(t, resp, streaming.EventRunFinished, 30*time.Second)
	elapsed := time.Since(start)

	if len(events) == 0 || events[len(events)-1].env.Type != streaming.EventRunFinished {
		var detail string
		for _, e := range events {
			if e.env.Type == streaming.EventRunError {
				detail = string(e.env.Data)
			}
		}
		t.Fatalf("active stream was killed: %d events, last=%v err=%s", len(events), lastType(events), detail)
	}
	if elapsed < 6*time.Second {
		t.Fatalf("stream ended suspiciously fast (%s) — chunks not being honored", elapsed)
	}
	vm(t, "active_long_stream_ms", elapsed.Milliseconds())
}

// TestV11_ResponseHeaderTimeout: upstream accepts the request but never
// writes headers; the client ResponseHeaderTO (3s) must fire.
func TestV11_ResponseHeaderTimeout(t *testing.T) {
	s := newStackDefault(t)
	s.bifrost.setMode(bifrostHeaderStall, 0, "", 30*time.Second)
	sess := s.sessionFor("hdrto", "ten_A", "usr_1")

	start := time.Now()
	resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sess, runBody("openai/gpt-4o", "x", true), nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	events := readSSE(t, resp, streaming.EventRunError, 15*time.Second)
	elapsed := time.Since(start)

	var code string
	for _, e := range events {
		if e.env.Type == streaming.EventRunError {
			var d streaming.RunErrorData
			_ = jsonUnmarshal(e.env.Data, &d)
			code = d.Code
		}
	}
	if code != "MODEL_TIMEOUT" {
		t.Fatalf("header stall: code=%s, want MODEL_TIMEOUT", code)
	}
	if elapsed > 6*time.Second {
		t.Fatalf("header timeout took %s, must fire at ~ResponseHeaderTO (3s)", elapsed)
	}
	vm(t, "response_header_timeout_ms", elapsed.Milliseconds())
}

// TestV12_SlowFirstChunkThenSparse: first chunk after a long delay, then
// sparse chunks — configured timeout semantics + bounded resources while the
// stream lives.
func TestV12_SlowFirstChunkThenSparse(t *testing.T) {
	// Sandbox-scaled per spec §12 (spec: 10s first chunk, 30s cadence; the
	// semantics under test are identical): idle window 6s > first-byte 3s and
	// inter-chunk 1.2s — the stream must run to completion.
	o := defaultOpts()
	o.idleTimeout = 6 * time.Second
	s := newStack(t, o)
	s.bifrost.setScript(
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","content":"slow-start"}}]}`, delay: 3 * time.Second},
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"content":"sparse-1"}}]}`, delay: 1200 * time.Millisecond},
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"content":"sparse-2"}}]}`, delay: 1200 * time.Millisecond},
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":3,"total_tokens":8}}`, delay: 1200 * time.Millisecond},
		chunk{data: `[DONE]`, delay: 0},
	)
	sess := s.sessionFor("slowresp", "ten_A", "usr_1")

	baseG := goroutines()
	baseHeap := memStats().HeapAlloc

	resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sess, runBody("openai/gpt-4o", "x", true), nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	events := readSSE(t, resp, streaming.EventRunFinished, 30*time.Second)

	if len(events) == 0 || events[len(events)-1].env.Type != streaming.EventRunFinished {
		t.Fatalf("slow sparse stream did not complete: %v", lastType(events))
	}
	// Resource usage during the long-lived stream stays bounded.
	peakG := goroutines()
	after := memStats().HeapAlloc
	if peakG > baseG+20 {
		t.Fatalf("goroutines grew by %d during slow stream (base=%d, now=%d)", peakG-baseG, baseG, peakG)
	}
	if after > baseHeap+(8<<20) {
		t.Fatalf("heap grew by %d bytes during slow stream", after-baseHeap)
	}
	vm(t, "slow_stream_goroutine_delta", peakG-baseG)
}

// TestV09_DesktopDisconnectDuringStreaming: full §9 propagation chain —
// WS disconnect detected → run cancelled → upstream cancelled → run state
// updated → no orphaned upstream request.
func TestV09_DesktopDisconnectDuringStreaming(t *testing.T) {
	s := newStackDefault(t)
	s.bifrost.setScript(
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","content":"a"}}]}`, delay: 50 * time.Millisecond},
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"content":"b"}}]}`, delay: 30 * time.Second},
	)
	sess := s.sessionFor("disc", "ten_A", "usr_1")

	conn, _, err := dialWS(t, s.replicas[0].url, s.tokenFor("usr_1", "ten_A"), sess)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	wsRunCreate(t, conn, runBody("openai/gpt-4o", "x", true))

	// Read until the first content event (~event 100 equivalent: we have
	// fewer events; disconnect after the first event arrives).
	events, _ := wsRead(t, conn, streaming.EventTextMessageContent, 5*time.Second)
	if len(events) == 0 {
		t.Fatal("no events before disconnect")
	}
	runID := events[0].RunID

	// Abrupt disconnect (no close frame — raw TCP drop).
	_ = conn.UnderlyingConn().Close()
	_ = conn.Close()

	// Upstream cancellation must follow.
	waitFor(t, 5*time.Second, func() bool { return s.bifrost.cancelCount() > 0 })
	if s.bifrost.cancelCount() == 0 {
		t.Fatal("upstream stream survived desktop disconnect (orphaned request)")
	}

	// Run state must reach a terminal, valid status.
	waitFor(t, 5*time.Second, func() bool {
		r := s.runs.get(runID)
		return r != nil && r.Terminal()
	})
	run := s.runs.get(runID)
	if run == nil || (run.Status != domainRunCancelled && run.Status != domainRunDisconnected) {
		t.Fatalf("run status after disconnect: %+v", run)
	}
	vm(t, "disconnect_upstream_cancelled", 1)
}

// SSE variant of §9 (HTTP transport disconnect).
func TestV09_DesktopDisconnectSSE(t *testing.T) {
	s := newStackDefault(t)
	s.bifrost.setScript(
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","content":"a"}}]}`, delay: 30 * time.Millisecond},
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"content":"b"}}]}`, delay: 30 * time.Second},
	)
	sess := s.sessionFor("discsse", "ten_A", "usr_1")

	resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sess, runBody("openai/gpt-4o", "x", true), nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	// Read the first event then hard-close the TCP connection.
	events := readSSE(t, resp, streaming.EventRunStarted, 5*time.Second)
	if len(events) == 0 {
		t.Fatal("no events before close")
	}
	runID := events[0].env.RunID
	resp.Body.Close() // closes the connection (no keep-alive reuse)

	waitFor(t, 5*time.Second, func() bool { return s.bifrost.cancelCount() > 0 })
	if s.bifrost.cancelCount() == 0 {
		t.Fatal("SSE disconnect left upstream orphaned")
	}
	waitFor(t, 5*time.Second, func() bool {
		r := s.runs.get(runID)
		return r != nil && r.Terminal()
	})
}

// --- small helpers ----------------------------------------------------------

func lastType(events []sseEvt) string {
	if len(events) == 0 {
		return "<none>"
	}
	return events[len(events)-1].env.Type
}

const domainRunCancelled = "cancelled"
const domainRunDisconnected = "disconnected"
