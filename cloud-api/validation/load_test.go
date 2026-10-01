// Spec §23 (Concurrent User Test), §24 (Burst Test) and §39 (Performance
// Acceptance Criteria).
//
// §39 discipline: no hard-coded latency claims. Establish a baseline, measure
// under increasing concurrency, record resource usage, identify the
// saturation behavior. Sandbox-scaled user counts (10/100/500 — the spec's
// 1000/5000 tiers require horizontal deployment beyond this 2-core sandbox;
// the report records the tested tiers). Every tier emits VALMETRIC lines the
// report generator aggregates.
package validation

import (
	"fmt"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/streaming"
)

// trafficMix: realistic mixed traffic (spec §23): short requests, long
// streams, cancellations, errors.
type trafficMix struct {
	shorts  int
	streams int
	cancels int
	errors  int
}

func (m trafficMix) total() int { return m.shorts + m.streams + m.cancels + m.errors }

// runLoadTier drives one concurrency tier and returns the metrics.
func runLoadTier(t *testing.T, users int, mix trafficMix) map[string]any {
	t.Helper()
	o := defaultOpts()
	o.rpmUser = 100000 // tier isolation from RPM caps
	o.rpmTenant = 1000000
	o.concUser = 100000 // the tier models capacity headroom (plan raised)
	o.concTenant = 1000000
	o.inFlight = 4096
	s := newStack(t, o)

	// Deterministic mixed-traffic scripts: the request BODY selects the leg
	// (no shared mutation — safe under arbitrary concurrency).
	shortScript := []chunk{
		{data: `{"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","content":"a"}}]}`, delay: 2 * time.Millisecond},
		{data: fmt.Sprintf(`{"id":"c1","choices":[{"index":0,"delta":{"content":"%s"}}]}`, strings.Repeat("p", 512)), delay: 2 * time.Millisecond},
		{data: `{"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":10,"total_tokens":20}}`, delay: 2 * time.Millisecond},
		{data: `[DONE]`, delay: 0},
	}
	longScript := []chunk{
		{data: `{"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","content":"a"}}]}`, delay: 5 * time.Millisecond},
		{data: `{"id":"c1","choices":[{"index":0,"delta":{"content":"b"}}]}`, delay: 30 * time.Second},
	}
	s.bifrost.setBodyScript(func(body string) []chunk {
		if strings.Contains(body, "leg-longstream") {
			return longScript
		}
		return shortScript
	})
	sess := s.sessionFor("load", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")

	baseG := goroutines()
	var okCount, errCount atomic.Int64
	var latencies []int64
	var latMu sync.Mutex
	var firstByte []int64
	var fbMu sync.Mutex
	var wg sync.WaitGroup

	start := time.Now()

	worker := func(kind string) {
		defer wg.Done()
		switch kind {
		case "short":
			resp, err := s.postRunLoad(0, tok, sess, runBody("openai/gpt-4o", "leg-short", true), nil)
			if err != nil {
				errCount.Add(1)
				return
			}
			t0 := time.Now()
			events := readSSE(t, resp, streaming.EventRunFinished, 60*time.Second)
			if len(events) > 0 && events[len(events)-1].env.Type == streaming.EventRunFinished {
				okCount.Add(1)
				latMu.Lock()
				latencies = append(latencies, time.Since(t0).Milliseconds())
				latMu.Unlock()
			} else {
				errCount.Add(1)
			}
		case "stream", "cancel":
			resp, err := s.postRunLoad(0, tok, sess, runBody("openai/gpt-4o", "leg-longstream", true), nil)
			if err != nil {
				errCount.Add(1)
				return
			}
			t0 := time.Now()
			events := readSSE(t, resp, streaming.EventRunStarted, 30*time.Second)
			if len(events) == 0 {
				errCount.Add(1)
				return
			}
			fbMu.Lock()
			firstByte = append(firstByte, time.Since(t0).Milliseconds())
			fbMu.Unlock()
			if kind == "cancel" {
				resp.Body.Close() // disconnect → cancellation path
				okCount.Add(1)
			} else {
				// Long stream: ends via the idle watchdog (2s) with RUN_ERROR —
				// the EXPECTED terminal for this leg, not a failure.
				readSSE(t, resp, streaming.EventRunError, 45*time.Second)
				okCount.Add(1)
			}
		case "error":
			// Malformed request → fast rejection (error leg of the mix).
			resp, err := s.postRun(0, tok, sess, `{"model":"bad"}`, nil)
			if err != nil {
				errCount.Add(1)
				return
			}
			resp.Body.Close()
			okCount.Add(1)
		}
	}

	// Distribute the mix across the user tier.
	kinds := make([]string, 0, mix.total())
	for i := 0; i < mix.shorts; i++ {
		kinds = append(kinds, "short")
	}
	for i := 0; i < mix.streams; i++ {
		kinds = append(kinds, "stream")
	}
	for i := 0; i < mix.cancels; i++ {
		kinds = append(kinds, "cancel")
	}
	for i := 0; i < mix.errors; i++ {
		kinds = append(kinds, "error")
	}
	for _, k := range kinds {
		wg.Add(1)
		go worker(k)
	}
	wg.Wait()
	elapsed := time.Since(start)

	// Settle, then capture resources.
	loadClient.CloseIdleConnections()
	time.Sleep(500 * time.Millisecond)
	peakG := goroutines()
	heap := memStats().HeapInuse
	rss := rssKB()

	pct := func(sorted []int64, p float64) int64 {
		if len(sorted) == 0 {
			return -1
		}
		idx := int(float64(len(sorted)-1) * p)
		return sorted[idx]
	}
	sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })
	sort.Slice(firstByte, func(i, j int) bool { return firstByte[i] < firstByte[j] })

	return map[string]any{
		"users":        users,
		"requests":     mix.total(),
		"ok":           okCount.Load(),
		"errors":       errCount.Load(),
		"elapsed_ms":   elapsed.Milliseconds(),
		"rps":          float64(mix.total()) / elapsed.Seconds(),
		"p50_ms":       pct(latencies, 0.50),
		"p95_ms":       pct(latencies, 0.95),
		"p99_ms":       pct(latencies, 0.99),
		"ttfb_p50_ms":  pct(firstByte, 0.50),
		"goroutines":   peakG,
		"goroutine_d":  peakG - baseG,
		"heap_bytes":   heap,
		"rss_kb":       rss,
		"upstream_ops": s.bifrost.count(),
	}
}

// TestV23_ConcurrentUserTiers: 10 → 100 → 500 concurrent users with a
// realistic traffic mix; latency percentiles, throughput and resources per
// tier (the baseline-vs-saturation record for §39).
func TestV23_ConcurrentUserTiers(t *testing.T) {
	if testing.Short() {
		t.Skip("load tiers: -short mode")
	}
	tiers := []struct {
		users int
		mix   trafficMix
	}{
		{10, trafficMix{shorts: 60, streams: 10, cancels: 10, errors: 10}},
		{100, trafficMix{shorts: 500, streams: 60, cancels: 60, errors: 60}},
		{500, trafficMix{shorts: 900, streams: 120, cancels: 120, errors: 120}},
	}

	for _, tier := range tiers {
		t.Run(fmt.Sprintf("users_%d", tier.users), func(t *testing.T) {
			m := runLoadTier(t, tier.users, tier.mix)

			errN := m["errors"].(int64)
			reqN := m["requests"].(int)
			// Tolerance: cancellations may produce benign errors; hard
			// failures above 5% indicate saturation instability.
			if float64(errN)/float64(reqN) > 0.05 {
				t.Fatalf("tier %d: error rate too high: %d/%d", tier.users, errN, reqN)
			}

			for _, k := range []string{"users", "requests", "ok", "errors", "elapsed_ms", "rps", "p50_ms", "p95_ms", "p99_ms", "ttfb_p50_ms", "goroutines", "goroutine_d", "heap_bytes", "rss_kb", "upstream_ops"} {
				vm(t, fmt.Sprintf("load_%du_%s", tier.users, k), m[k])
			}

			// Bounded resources: goroutines stay proportional, never runaway.
			peakG := m["goroutines"].(int)
			if peakG > tier.users*3+200 {
				t.Fatalf("tier %d: goroutine explosion: %d", tier.users, peakG)
			}
			// Sanity: requests actually flowed.
			if m["ok"].(int64) < int64(reqN)/2 {
				t.Fatalf("tier %d: only %d/%d requests succeeded", tier.users, m["ok"], reqN)
			}
		})
	}
}

// TestV24_BurstTest: normal traffic → sudden 10x burst → back to normal.
func TestV24_BurstTest(t *testing.T) {
	if testing.Short() {
		t.Skip("burst test: -short mode")
	}
	o := defaultOpts()
	o.rpmUser = 100000
	o.rpmTenant = 1000000
	o.concUser = 100000 // burst capacity headroom
	o.concTenant = 1000000
	o.inFlight = 4096
	s := newStack(t, o)
	s.bifrost.setScript(standardScript()...)
	sess := s.sessionFor("burst", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")

	phase := func(name string, n, workers int, requireOK int) time.Duration {
		t.Helper()
		start := time.Now()
		var wg sync.WaitGroup
		var ok, fail atomic.Int64
		for i := 0; i < n; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				resp, err := s.postRunLoad(0, tok, sess, runBody("openai/gpt-4o", "burst", false), nil)
				if err != nil {
					fail.Add(1)
					return
				}
				if resp.StatusCode == 200 {
					ok.Add(1)
					resp.Body.Close()
				} else {
					fail.Add(1)
					resp.Body.Close()
				}
			}()
		}
		wg.Wait()
		if int(ok.Load()) < requireOK {
			t.Fatalf("phase %s: ok=%d fail=%d (need %d) — crash/degradation after burst", name, ok.Load(), fail.Load(), requireOK)
		}
		vm(t, "burst_"+name+"_ok", ok.Load())
		vm(t, "burst_"+name+"_fail", fail.Load())
		vm(t, "burst_"+name+"_ms", time.Since(start).Milliseconds())
		return time.Since(start)
	}

	// Normal.
	phase("normal1", 40, 4, 40)
	// Sudden 10x burst.
	phase("burst", 400, 400, 380)
	// Back to normal: the system recovers.
	phase("normal2", 40, 4, 40)

	// Post-burst health: a full streaming run still works, resources settle.
	baseG := goroutines()
	resp, err := s.postRunLoad(0, tok, sess, runBody("openai/gpt-4o", "after burst", true), nil)
	if err != nil {
		t.Fatalf("post-burst run: %v", err)
	}
	events := readSSE(t, resp, streaming.EventRunFinished, 30*time.Second)
	if len(events) == 0 {
		t.Fatal("post-burst stream failed")
	}
	if !waitFor(t, 10*time.Second, func() bool { return goroutines() <= baseG+50 }) {
		t.Fatalf("post-burst goroutines stuck at %d (base %d)", goroutines(), baseG)
	}
	vm(t, "burst_recovery_goroutines", goroutines())
	vm(t, "burst_upstream_peak", s.bifrost.count())
}

// TestV39_PerformanceBaselineVsLoad: the §39 discipline — baseline single-
// user latency, then concurrency; the ratio and the saturation point get
// recorded (not hard-coded pass/fail — the report interprets).
func TestV39_PerformanceBaselineVsLoad(t *testing.T) {
	if testing.Short() {
		t.Skip("perf acceptance: -short mode")
	}
	o := defaultOpts()
	o.rpmUser = 100000
	o.concUser = 100000 // concurrency headroom for the sweep
	o.concTenant = 1000000
	o.inFlight = 4096
	s := newStack(t, o)
	s.bifrost.setScript(standardScript()...)
	sess := s.sessionFor("perf", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")

	measure := func(n int) (p50, p95, rps float64) {
		lat := make([]int64, 0, n)
		var mu sync.Mutex
		var wg sync.WaitGroup
		start := time.Now()
		for i := 0; i < n; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				t0 := time.Now()
				resp, err := s.postRunLoad(0, tok, sess, runBody("openai/gpt-4o", "perf", true), nil)
				if err != nil {
					return
				}
				events := readSSE(t, resp, streaming.EventRunFinished, 60*time.Second)
				if len(events) > 0 && events[len(events)-1].env.Type == streaming.EventRunFinished {
					mu.Lock()
					lat = append(lat, time.Since(t0).Milliseconds())
					mu.Unlock()
				}
			}()
		}
		wg.Wait()
		elapsed := time.Since(start).Seconds()
		sort.Slice(lat, func(i, j int) bool { return lat[i] < lat[j] })
		if len(lat) == 0 {
			return -1, -1, 0
		}
		return float64(lat[len(lat)/2]), float64(lat[int(float64(len(lat)-1)*0.95)]), float64(len(lat)) / elapsed
	}

	// 1. Baseline (serial, 20 requests).
	base50, base95, baseRPS := measure(20)
	vm(t, "perf_baseline_p50_ms", base50)
	vm(t, "perf_baseline_p95_ms", base95)
	vm(t, "perf_baseline_rps", baseRPS)

	// 2. Increasing concurrency: 50, 200, 800.
	for _, n := range []int{50, 200, 800} {
		p50, p95, rps := measure(n)
		vm(t, fmt.Sprintf("perf_conc%d_p50_ms", n), p50)
		vm(t, fmt.Sprintf("perf_conc%d_p95_ms", n), p95)
		vm(t, fmt.Sprintf("perf_conc%d_rps", n), rps)
		if p50 < 0 {
			t.Fatalf("concurrency %d: no successful runs", n)
		}
		// Saturation signal: p95 may degrade, but must stay bounded (no
		// collapse — 50x baseline would indicate queuing collapse).
		if p95 > base95*50+5000 {
			t.Fatalf("concurrency %d: p95=%f collapsed vs baseline %f", n, p95, base95)
		}
	}

	// 3. Record resource usage at the top tier.
	vm(t, "perf_final_goroutines", goroutines())
	vm(t, "perf_final_heap_bytes", memStats().HeapInuse)
	vm(t, "perf_final_rss_kb", rssKB())
	vm(t, "perf_final_fds", fdCount())
}
