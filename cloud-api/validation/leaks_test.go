// Spec §22 (Long-Running Stream Test), §32 (Memory Leak Test), §33
// (Goroutine Leak Test) and §34 (File Descriptor / Connection Leak Test).
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

// TestV33_GoroutineLeakStress: stress cycles in TWO rounds. Round A may
// legitimately raise the count (pool high-water marks, JIT warm-up); a LEAK
// shows as round B growing AGAIN. Leak iff round-over-round growth persists.
func TestV33_GoroutineLeakStress(t *testing.T) {
	if testing.Short() {
		t.Skip("long stress test: -short mode")
	}
	s := newStackDefault(t)
	sess := s.sessionFor("leak", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")

	s.bifrost.setScript(
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","content":"a"}}]}`, delay: 5 * time.Millisecond},
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":2,"total_tokens":4}}`, delay: 5 * time.Millisecond},
		chunk{data: `[DONE]`, delay: 0},
	)

	cycle := func(n int) {
		var wg sync.WaitGroup
		for i := 0; i < n; i++ {
			wg.Add(1)
			go func(k int) {
				defer wg.Done()
				resp, err := s.postRun(0, tok, sess, runBody("openai/gpt-4o", "leak", true), nil)
				if err != nil {
					return
				}
				switch k % 3 {
				case 0:
					readSSE(t, resp, streaming.EventRunFinished, 20*time.Second)
				case 1:
					readSSE(t, resp, streaming.EventRunStarted, 5*time.Second)
					resp.Body.Close()
				default:
					readSSE(t, resp, streaming.EventTextMessageStart, 5*time.Second)
					resp.Body.Close()
				}
			}(i)
		}
		wg.Wait()
		// WS connect/run/disconnect cycles in the same round.
		for i := 0; i < n/10; i++ {
			conn, _, err := dialWS(t, s.replicas[0].url, tok, sess)
			if err != nil {
				break
			}
			wsRunCreate(t, conn, runBody("openai/gpt-4o", "wsleak", true))
			if i%2 == 0 {
				wsRead(t, conn, streaming.EventRunFinished, 20*time.Second)
			} else {
				wsRead(t, conn, streaming.EventRunStarted, 5*time.Second)
			}
			_ = conn.UnderlyingConn().Close()
			_ = conn.Close()
		}
	}

	// Warm-up.
	cycle(60)
	time.Sleep(500 * time.Millisecond)
	g0 := goroutines()

	// Round A.
	cycle(300)
	if !waitFor(t, 20*time.Second, func() bool { return goroutines() <= g0+80 }) {
		dumpGoroutineSummary(t)
		t.Fatalf("round A left goroutines far above baseline: %d (base %d)", goroutines(), g0)
	}
	g1 := goroutines()

	// Round B: the same workload again — a leak grows AGAIN.
	cycle(300)
	if !waitFor(t, 20*time.Second, func() bool { return goroutines() <= g1+20 }) {
		dumpGoroutineSummary(t)
		t.Fatalf("GOROUTINE LEAK: round B grew %d → %d (round A ended at %d; steady state must not keep growing)", g1, goroutines(), g1)
	}
	vm(t, "goroutine_leak_base", g0)
	vm(t, "goroutine_leak_roundA", g1)
	vm(t, "goroutine_leak_roundB", goroutines())
}

// dumpGoroutineSummary prints a categorized goroutine dump (failure triage).
func dumpGoroutineSummary(t *testing.T) {
	t.Helper()
	buf := make([]byte, 1<<20)
	n := runtime.Stack(buf, true)
	lines := strings.Split(string(buf[:n]), "\n")
	counts := map[string]int{}
	for i := 0; i < len(lines); i++ {
		if strings.HasPrefix(lines[i], "goroutine ") {
			cat := "other"
			for j := i + 1; j < len(lines) && j < i+14; j++ {
				if strings.Contains(lines[j], "(") {
					if idx := strings.Index(lines[j], "."); idx > 0 {
						cat = lines[j][:idx]
						break
					}
				}
			}
			counts[cat]++
		}
	}
	for k, v := range counts {
		t.Logf("goroutine-category %-50s %d", k, v)
	}
}

// TestV34_FDAndConnectionLeak: FDs in TWO rounds — round-over-round growth
// is the leak signal (pool warm-up in round A is legitimate).
func TestV34_FDAndConnectionLeak(t *testing.T) {
	if testing.Short() {
		t.Skip("long stress test: -short mode")
	}
	s := newStackDefault(t)
	s.bifrost.setScript(standardScript()...)
	sess := s.sessionFor("fd", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")

	cycle := func(n int) {
		var wg sync.WaitGroup
		for i := 0; i < n; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				resp, err := s.postRun(0, tok, sess, runBody("openai/gpt-4o", "fd", true), nil)
				if err != nil {
					return
				}
				readSSE(t, resp, streaming.EventRunFinished, 20*time.Second)
			}()
		}
		wg.Wait()
		for i := 0; i < n/5; i++ {
			conn, _, err := dialWS(t, s.replicas[0].url, tok, sess)
			if err != nil {
				break
			}
			wsRunCreate(t, conn, runBody("openai/gpt-4o", "wsfd", true))
			wsRead(t, conn, streaming.EventRunFinished, 20*time.Second)
			_ = conn.Close()
		}
		if tr, ok := http.DefaultTransport.(*http.Transport); ok {
			tr.CloseIdleConnections()
		}
	}

	// Warm-up.
	cycle(40)
	time.Sleep(500 * time.Millisecond)
	f0 := fdCount()

	// Round A.
	cycle(200)
	if !waitFor(t, 20*time.Second, func() bool { return fdCount() <= f0+60 }) {
		t.Fatalf("round A FDs=%d (base %d)", fdCount(), f0)
	}
	f1 := fdCount()

	// Round B.
	cycle(200)
	if !waitFor(t, 20*time.Second, func() bool { return fdCount() <= f1+20 }) {
		t.Fatalf("FILE DESCRIPTOR LEAK: round B grew %d → %d (round A ended at %d)", f1, fdCount(), f1)
	}
	vm(t, "fd_leak_base", f0)
	vm(t, "fd_leak_roundA", f1)
	vm(t, "fd_leak_roundB", fdCount())
}

// TestV32_MemoryStabilityUnderSustainedTraffic: sustained traffic; heap and
// RSS snapshots at start / mid / end — no monotonic growth beyond warm-up.
func TestV32_MemoryStabilityUnderSustainedTraffic(t *testing.T) {
	if testing.Short() {
		t.Skip("long soak test: -short mode")
	}
	s := newStackDefault(t)
	s.bifrost.setScript(
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","content":"stable"}}]}`, delay: 5 * time.Millisecond},
		chunk{data: fmt.Sprintf(`{"id":"c1","choices":[{"index":0,"delta":{"content":"%s"}}]}`, strings.Repeat("x", 2048)), delay: 5 * time.Millisecond},
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":9,"completion_tokens":9,"total_tokens":18}}`, delay: 5 * time.Millisecond},
		chunk{data: `[DONE]`, delay: 0},
	)
	sess := s.sessionFor("mem", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")

	burst := func(n int) {
		var wg sync.WaitGroup
		for i := 0; i < n; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				resp, err := s.postRun(0, tok, sess, runBody("openai/gpt-4o", "mem", true), nil)
				if err != nil {
					return
				}
				readSSE(t, resp, streaming.EventRunFinished, 30*time.Second)
			}()
		}
		wg.Wait()
	}

	// Round 0: warm-up (JIT, pools, buffers — growth expected here).
	burst(100)
	time.Sleep(500 * time.Millisecond)
	start := memStats()
	startRSS := rssKB()

	// Rounds 1-3: steady state — growth must flatten.
	burst(200)
	mid := memStats()
	burst(200)
	burst(200)
	time.Sleep(500 * time.Millisecond)
	end := memStats()
	endRSS := rssKB()

	warmupGrowth := int64(mid.HeapInuse) - int64(start.HeapInuse)
	steadyGrowth := int64(end.HeapInuse) - int64(mid.HeapInuse)
	// Warm-up may grow; the steady state must NOT keep growing
	// (tolerance: 8 MiB for allocator fragmentation across 600 runs).
	if steadyGrowth > 8<<20 {
		t.Fatalf("MEMORY LEAK: steady-state heap grew %d bytes (warm-up growth was %d)", steadyGrowth, warmupGrowth)
	}
	if endRSS > 0 && startRSS > 0 && endRSS-startRSS > 64<<20 {
		t.Fatalf("RSS grew %d KB across the soak (start=%d end=%d)", endRSS-startRSS, startRSS, endRSS)
	}
	vm(t, "mem_heap_start_bytes", start.HeapInuse)
	vm(t, "mem_heap_mid_bytes", mid.HeapInuse)
	vm(t, "mem_heap_end_bytes", end.HeapInuse)
	vm(t, "mem_rss_start_kb", startRSS)
	vm(t, "mem_rss_end_kb", endRSS)
	vm(t, "mem_gc_cycles", end.NumGC-start.NumGC)
}

// TestV22_LongRunningStreamSoak: a controlled continuous stream (sandbox-
// scaled: 60s at full cadence; production spec calls for 30m/1h/2h — same
// invariants, proportionally longer). Monitors RSS, goroutines, FDs and GC
// while the stream runs.
func TestV22_LongRunningStreamSoak(t *testing.T) {
	if testing.Short() {
		t.Skip("long stream soak: -short mode (report marks this DEGRADED duration)")
	}
	const soak = 60 * time.Second

	s := newStackDefault(t)
	o := s.opts
	_ = o
	// A stream that keeps producing 512-byte events every 250ms for the
	// whole soak: 240 events, total runtime 60s.
	n := int(soak / (250 * time.Millisecond))
	script := make([]chunk, 0, n+2)
	for i := 0; i < n; i++ {
		script = append(script, chunk{data: fmt.Sprintf(`{"id":"c1","choices":[{"index":0,"delta":{"content":"ev-%d-%s"}}]}`, i, strings.Repeat("s", 512)), delay: 250 * time.Millisecond})
	}
	script = append(script,
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":n,"total_tokens":n+1}}`, delay: 250 * time.Millisecond},
		chunk{data: `[DONE]`, delay: 0},
	)
	s.bifrost.setScript(script...)

	sess := s.sessionFor("soak", "ten_A", "usr_1")
	resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sess, runBody("openai/gpt-4o", "soak", true), nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	tap, stopTap := sseTap(t, resp)
	defer stopTap()

	// Snapshots while the stream runs. The channel is NEVER closed: the
	// sampler stops via snapDone; the reader drains with a timeout. (Closing
	// a channel a ticker goroutine still sends into is a panic.)
	snapshots := make(chan string, 8)
	snapDone := make(chan struct{})
	go func() {
		tick := time.NewTicker(10 * time.Second)
		defer tick.Stop()
		for i := 0; i < 6; i++ {
			select {
			case <-snapDone:
				return
			case <-tick.C:
				snapshots <- fmt.Sprintf("t+%ds goroutines=%d rss_kb=%d fds=%d", (i+1)*10, goroutines(), rssKB(), fdCount())
			}
		}
	}()

	// Consume the stream to completion.
	deadline := time.After(soak + 60*time.Second)
	count := 0
	for {
		select {
		case ev, ok := <-tap:
			if !ok {
				goto done
			}
			count++
			_ = ev
			if ev.env.Type == streaming.EventRunFinished || ev.env.Type == streaming.EventRunError {
				goto done
			}
		case <-deadline:
			t.Fatal("soak stream never terminated")
		}
	}
done:
	close(snapDone)
	// Drain any buffered/late snapshots (bounded).
	drainDeadline := time.After(2 * time.Second)
	for {
		select {
		case snap := <-snapshots:
			t.Logf("SOAK %s", snap)
			vm(t, "soak_"+strings.Fields(snap)[0], strings.Join(strings.Fields(snap)[2:], ";"))
		case <-drainDeadline:
			goto drained
		}
	}
drained:

	if count < n/2 {
		t.Fatalf("soak delivered only %d/%d events", count, n)
	}
	vm(t, "soak_events_delivered", count)
	vm(t, "soak_duration_s", int(soak.Seconds()))
	vm(t, "soak_final_goroutines", goroutines())
	vm(t, "soak_final_rss_kb", rssKB())
	vm(t, "soak_final_fds", fdCount())
}
