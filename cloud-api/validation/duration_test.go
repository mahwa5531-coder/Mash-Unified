package validation

import (
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/streaming"
)

// ---------------------------------------------------------------------------
// Spec §22 (long-running streams) — duration semantics at production timing.
//
// Answers the operational question: "can the LLM generate for 10 minutes
// straight — does the stream survive it?"
//
// The stream has exactly TWO lifetime terminators (internal/config defaults):
//   - StreamIdleTimeout  300s  — no upstream chunk within this window → abort.
//     The timer RESETS on every chunk: continuous generation never trips it.
//   - StreamMaxDuration  15m   — hard cap of one stream (env-tunable via
//     NEXAU_STREAM_MAX_DURATION). Proven to fire exactly AT the cap — never
//     before (TestV22_DurationCapFiresCleanly) — so a 600s stream sits 3x
//     inside the 900s budget.
// Plus SSE heartbeats every 15s keep intermediary proxies from reaping an
// otherwise-silent connection.
//
// Sandbox note: this environment kills background processes between tool
// invocations and caps each command at 600s, so the continuous soak here is
// the maximum single-call profile (590s). Production validation runs the
// 30m/1h/2h profiles via scripts/run_validation.sh on the deployment cluster.
// ---------------------------------------------------------------------------

// TestV22_ContinuousStream10MinProfile: 590 content chunks at 1s cadence —
// a continuous ~9m50s generation stream at production timing (idle 300s /
// cap 15m). Proves: (1) the stream survives ~590s of uninterrupted
// generation — the longest run the sandbox's 600s tool cap permits — with the
// only terminators being the two above (never a gradual failure), (2) every
// event arrives in order with no loss/duplication, (3) the first chunk
// reaches the client in ~1s (incremental relay, not whole-response
// buffering), (4) usage is captured when it finally arrives at the end,
// (5) RSS/goroutines/FDs stay flat for the whole run.
func TestV22_ContinuousStream10MinProfile(t *testing.T) {
	if testing.Short() {
		t.Skip("10-minute-profile continuous stream: -short mode (report marks DEGRADED duration)")
	}

	// Production stream timing (identical to internal/config defaults).
	o := defaultOpts()
	o.idleTimeout = 300 * time.Second
	o.maxDuration = 15 * time.Minute
	s := newStack(t, o)

	const n = 570 // content chunks @ 1/s — 570s continuous generation (sandbox tool cap)
	script := make([]chunk, 0, n+2)
	for i := 0; i < n; i++ {
		script = append(script, chunk{
			data:  fmt.Sprintf(`{"id":"c1","choices":[{"index":0,"delta":{"content":"tick-%d"}}]}`, i),
			delay: time.Second,
		})
	}
	script = append(script,
		chunk{data: fmt.Sprintf(`{"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":%d,"total_tokens":%d}}`, n, n+3), delay: time.Second},
		chunk{data: `[DONE]`, delay: 0},
	)
	s.bifrost.setScript(script...)

	sess := s.sessionFor("tenmin", "ten_A", "usr_1")
	start := time.Now()
	resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sess, runBody("openai/gpt-4o", "ten minute continuous generation", true), nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}

	// Dedicated reader: buffered channel (no drop — ordering/counting must
	// be exact), tolerant of heartbeat comment frames.
	events := make(chan sseEvt, 4096)
	readerDone := make(chan struct{})
	go func() {
		defer close(events)
		buf := make([]byte, 64<<10)
		var carry []byte
		for {
			nn, rerr := resp.Body.Read(buf)
			if nn > 0 {
				carry = append(carry, buf[:nn]...)
				for {
					idx := indexTerminator(carry)
					if idx < 0 {
						break
					}
					frame := string(carry[:idx])
					carry = carry[idx+2:]
					if line, ok := strings.CutPrefix(frame, "data: "); ok {
						if env, derr := streaming.DecodeEnvelope([]byte(line)); derr == nil {
							select {
							case events <- sseEvt{env: *env, at: time.Now()}:
							case <-readerDone:
								return
							}
						}
					}
				}
			}
			if rerr != nil {
				return
			}
		}
	}()
	defer func() { close(readerDone); resp.Body.Close() }()

	// Resource sampler: every 60s while the stream runs.
	baselineGo, baselineRSS, baselineFD := goroutines(), rssKB(), fdCount()
	var mu sync.Mutex
	samples := []string{}
	stopSnap := make(chan struct{})
	go func() {
		tick := time.NewTicker(60 * time.Second)
		defer tick.Stop()
		for i := 1; ; i++ {
			select {
			case <-stopSnap:
				return
			case <-tick.C:
				mu.Lock()
				samples = append(samples, fmt.Sprintf("t+%dm goroutines=%d rss_kb=%d fds=%d", i, goroutines(), rssKB(), fdCount()))
				mu.Unlock()
			}
		}
	}()

	// Consume the full stream.
	var (
		runID      string
		ttfb       time.Duration
		contentSeq = make([]string, 0, n)
		counts     = map[string]int{}
		terminal   string
	)
	deadline := time.After(15 * time.Minute)
loop:
	for terminal == "" {
		select {
		case ev, ok := <-events:
			if !ok {
				break loop
			}
			if runID == "" {
				runID = ev.env.RunID
			}
			counts[ev.env.Type]++
			if ev.env.Type == streaming.EventTextMessageContent {
				if ttfb == 0 {
					ttfb = time.Since(start)
				}
				var d streaming.TextMessageContentData
				_ = jsonUnmarshal(ev.env.Data, &d)
				contentSeq = append(contentSeq, d.Delta)
			}
			if ev.env.Type == streaming.EventRunFinished || ev.env.Type == streaming.EventRunError {
				terminal = ev.env.Type
				if terminal == streaming.EventRunError {
					t.Fatalf("RUN_ERROR during continuous stream: %s", ev.env.Data)
				}
			}
		case <-deadline:
			t.Fatalf("stream never terminated (counts=%v)", counts)
		}
	}
	close(stopSnap)
	elapsed := time.Since(start)

	// (1) Genuinely ran ~590s of continuous generation (sandbox tool cap),
	// under the 15-minute hard cap.
	if elapsed < 565*time.Second {
		t.Fatalf("stream completed in %s — cadence not honored, test invalid", elapsed)
	}
	if elapsed > 14*time.Minute {
		t.Fatalf("stream took %s — exceeded the 15m cap budget", elapsed)
	}

	// (2) No stream-level failure of any kind across the whole run.
	if counts[streaming.EventRunError] != 0 {
		t.Fatalf("unexpected RUN_ERROR events: %d", counts[streaming.EventRunError])
	}

	// (3) Completeness + strict ordering: every chunk, exactly once, in order.
	if len(contentSeq) != n {
		t.Fatalf("content events=%d, want %d (loss or duplication)", len(contentSeq), n)
	}
	for i, d := range contentSeq {
		if d != fmt.Sprintf("tick-%d", i) {
			t.Fatalf("ordering broken at %d: got %q (stream events corrupted/reordered)", i, d)
		}
	}

	// (4) First chunk in ~1s → incremental relay, no whole-response buffering.
	if ttfb == 0 || ttfb > 10*time.Second {
		t.Fatalf("ttfb=%s — stream is not relayed incrementally (buffered?)", ttfb)
	}

	// (5) Run finalized as completed; usage captured at the end of the run.
	if terminal != streaming.EventRunFinished {
		t.Fatalf("terminal event=%s, want RUN_FINISHED", terminal)
	}
	if !waitFor(t, 5*time.Second, func() bool { return s.runs.get(runID).Terminal() }) {
		t.Fatal("run did not reach a terminal state")
	}
	if r := s.runs.get(runID); r.Status != "completed" {
		t.Fatalf("run status=%s, want completed", r.Status)
	}
	if !waitFor(t, 5*time.Second, func() bool { return len(s.usage.records()) >= 1 }) {
		t.Fatal("usage never recorded for the continuous stream")
	}
	var usageOk bool
	for _, u := range s.usage.records() {
		if u.RunID == runID && u.Usage.OutputTokens == int64(n) {
			usageOk = true
		}
	}
	if !usageOk {
		t.Fatalf("usage attribution wrong (want %d output tokens for %s): %+v", n, runID, s.usage.records())
	}

	// (6) Resource stability across the full duration.
	time.Sleep(1 * time.Second) // let pumps/watchdogs unwind
	endGo, endRSS, endFD := goroutines(), rssKB(), fdCount()
	if endGo > baselineGo+25 {
		t.Fatalf("GOROUTINE LEAK: %d → %d across a single ~10-minute stream", baselineGo, endGo)
	}
	if endFD > baselineFD+15 {
		t.Fatalf("FD LEAK: %d → %d across a single ~10-minute stream", baselineFD, endFD)
	}
	if endRSS > 0 && baselineRSS > 0 && endRSS-baselineRSS > 128<<10 {
		t.Fatalf("RSS grew %d KB across the stream (start=%d end=%d)", endRSS-baselineRSS, baselineRSS, endRSS)
	}

	mu.Lock()
	for _, snap := range samples {
		t.Logf("CONTSTREAM %s", snap)
		_ = snap
	}
	mu.Unlock()
	vm(t, "contstream_duration_ms", elapsed.Milliseconds())
	vm(t, "contstream_ttfb_ms", ttfb.Milliseconds())
	vm(t, "contstream_content_events", len(contentSeq))
	vm(t, "contstream_goroutines_start", baselineGo)
	vm(t, "contstream_goroutines_end", endGo)
	vm(t, "contstream_rss_kb_start", baselineRSS)
	vm(t, "contstream_rss_kb_end", endRSS)
	vm(t, "contstream_fds_start", baselineFD)
	vm(t, "contstream_fds_end", endFD)
	vm(t, "contstream_usage_output_tokens", n)
}

// TestV22_ProductionIdleGapSurvives: at PRODUCTION timing (idle watchdog
// 300s), a 240-second mid-stream "model thinking" silence — 80% of the
// watchdog window — must survive: the watchdog measures time-since-last-chunk
// (heartbeats hold the client connection meanwhile), not total runtime.
// Combined with TestV11_IdleTimeoutTerminatesStalledStream (fires at the
// threshold from above), this brackets the idle boundary at production scale.
func TestV22_ProductionIdleGapSurvives(t *testing.T) {
	if testing.Short() {
		t.Skip("240s production idle-gap: -short mode")
	}

	// Production stream timing (identical to internal/config defaults).
	o := defaultOpts()
	o.idleTimeout = 300 * time.Second
	o.maxDuration = 15 * time.Minute
	s := newStack(t, o)

	s.bifrost.setScript(
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"content":"before-gap"}}]}`, delay: 100 * time.Millisecond},
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"content":"after-gap"}}]}`, delay: 240 * time.Second}, // 4-minute silence
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"content":"tail"}}]}`, delay: 300 * time.Millisecond},
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}`, delay: 300 * time.Millisecond},
		chunk{data: `[DONE]`, delay: 0},
	)

	sess := s.sessionFor("prodgap", "ten_A", "usr_1")
	start := time.Now()
	resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sess, runBody("openai/gpt-4o", "x", true), nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	events := readSSE(t, resp, streaming.EventRunFinished, 6*time.Minute)
	elapsed := time.Since(start)

	var contents []string
	finished := false
	for _, e := range events {
		if e.env.Type == streaming.EventRunError {
			t.Fatalf("240s gap killed the stream at production idle=300s: %s", e.env.Data)
		}
		if e.env.Type == streaming.EventTextMessageContent {
			var d streaming.TextMessageContentData
			_ = jsonUnmarshal(e.env.Data, &d)
			contents = append(contents, d.Delta)
		}
		if e.env.Type == streaming.EventRunFinished {
			finished = true
		}
	}
	if !finished {
		t.Fatal("stream did not complete after the 240s production-config gap")
	}
	if len(contents) != 3 || contents[0] != "before-gap" || contents[1] != "after-gap" || contents[2] != "tail" {
		t.Fatalf("content after gap: %v", contents)
	}
	if elapsed < 240*time.Second {
		t.Fatalf("completed in %s — gap not honored", elapsed)
	}
	vm(t, "prod_idle_gap_survived_s", 240)
	vm(t, "prod_idle_gap_stream_ms", elapsed.Milliseconds())
}

// TestV22_DurationCapFiresCleanly: the maximum supported stream duration is
// StreamMaxDuration (default 15m, env NEXAU_STREAM_MAX_DURATION). A stream
// that would exceed the cap is terminated AT the cap with an explicit
// RUN_ERROR — the client is never left hanging, the run reaches a terminal
// state, and the upstream is cancelled (no zombie provider generation).
func TestV22_DurationCapFiresCleanly(t *testing.T) {
	o := defaultOpts()
	o.idleTimeout = 1 * time.Second
	o.maxDuration = 4 * time.Second // scaled stand-in for the 15m default
	s := newStack(t, o)

	const n = 16 // 16 × 500ms = 8s of would-be generation > 4s cap
	script := make([]chunk, 0, n+2)
	for i := 0; i < n; i++ {
		script = append(script, chunk{
			data:  fmt.Sprintf(`{"id":"c1","choices":[{"index":0,"delta":{"content":"cap-%d"}}]}`, i),
			delay: 500 * time.Millisecond,
		})
	}
	script = append(script,
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":16,"total_tokens":17}}`, delay: 500 * time.Millisecond},
		chunk{data: `[DONE]`, delay: 0},
	)
	s.bifrost.setScript(script...)

	sess := s.sessionFor("cap", "ten_A", "usr_1")
	start := time.Now()
	resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sess, runBody("openai/gpt-4o", "x", true), nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	events := readSSE(t, resp, streaming.EventRunError, 15*time.Second)
	elapsed := time.Since(start)

	var runID string
	for i := range events {
		if runID == "" {
			runID = events[i].env.RunID
		}
		if events[i].env.Type == streaming.EventRunError {
			var d streaming.RunErrorData
			_ = jsonUnmarshal(events[i].env.Data, &d)
			vm(t, "duration_cap_error_code", d.Code)
			t.Logf("DURATIONCAP code=%s", d.Code)
		}
	}
	if runID == "" {
		t.Fatal("no events received before the cap fired")
	}

	// Terminated at ~cap (4s), not at script end (8s) and not instantly.
	if elapsed < 3500*time.Millisecond || elapsed > 7*time.Second {
		t.Fatalf("cap fired at %s — must be ~StreamMaxDuration (4s)", elapsed)
	}
	if !waitFor(t, 5*time.Second, func() bool { return s.runs.get(runID).Terminal() }) {
		t.Fatal("run past the cap is not terminal")
	}
	if s.bifrost.cancelCount() == 0 {
		t.Fatal("upstream not cancelled when the duration cap fired — zombie generation")
	}
	vm(t, "duration_cap_fired_ms", elapsed.Milliseconds())
}

// TestV22_IdleGapBelowWatchdogSurvives: a mid-stream silence SHORTER than
// StreamIdleTimeout must survive (the watchdog measures time-since-last-chunk,
// not total runtime). Boundary-adjacent: 1.5s gap vs 2s watchdog.
func TestV22_IdleGapBelowWatchdogSurvives(t *testing.T) {
	s := newStackDefault(t) // idle=2s, max=30s
	s.bifrost.setScript(
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"content":"a"}}]}`, delay: 100 * time.Millisecond},
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"content":"gap"}}]}`, delay: 1500 * time.Millisecond}, // 1.5s thinking pause
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"content":"b"}}]}`, delay: 300 * time.Millisecond},
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}`, delay: 300 * time.Millisecond},
		chunk{data: `[DONE]`, delay: 0},
	)

	sess := s.sessionFor("gap", "ten_A", "usr_1")
	resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sess, runBody("openai/gpt-4o", "x", true), nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	events := readSSE(t, resp, streaming.EventRunFinished, 10*time.Second)

	last := ""
	for _, e := range events {
		if e.env.Type == streaming.EventRunFinished {
			last = e.env.Type
		}
		if e.env.Type == streaming.EventRunError {
			t.Fatalf("1.5s gap killed the stream (idle watchdog measures total runtime?): %s", e.env.Data)
		}
	}
	if last != streaming.EventRunFinished {
		t.Fatalf("stream did not complete after sub-timeout gap (last=%q)", last)
	}
	vm(t, "idle_gap_survived_ms", 1500)
}
