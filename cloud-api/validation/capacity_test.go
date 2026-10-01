// Capacity probe: how many concurrent SSE run requests, each live for a full
// 3 minutes, fit inside a 1 GiB RAM budget.
//
// Methodology:
//   - The ENTIRE in-process validation stack (API server + Redis + mock
//     Bifrost upstream + the load-generator clients) runs under
//     debug.SetMemoryLimit(1 GiB) — a soft GC budget — plus an RSS watchdog
//     that records the true resident peak. A wave "fits" only if peak RSS
//     stays at or below the budget. Measuring the whole stack inside the
//     budget makes the result CONSERVATIVE for the server alone (in
//     production, Redis and the clients are separate processes).
//   - Each request is a streaming agent run whose upstream emits one content
//     chunk per second for 180 seconds (usage + [DONE] at t=180s), so every
//     request is genuinely LIVE for 3 minutes, not merely open.
//   - Waves run as subtests with a fresh stack each; resources settle between
//     waves. The marginal per-stream cost is derived from peak-RSS deltas
//     across waves, which separates server cost from client cost.
//   - Gated by NEXAU_CAP_WAVES ("500,1000" CSV of wave sizes) so the normal
//     validation suite is unaffected. NEXAU_CAP_STRICT=1 turns breaches into
//     hard test failures (confirming run).
package validation

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"runtime"
	"runtime/debug"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

const (
	capBudgetKB      = 1 << 20           // 1 GiB, in KB (VmRSS units)
	capStreamLive    = 180 * time.Second // every request must be live 3 minutes
	capEventInterval = time.Second       // upstream chunk cadence
	capTextChunks    = 180               // content deltas per stream (1/s x 3min)
	capClientBudget  = 215 * time.Second // client hard deadline (live + slack)
	capMinSpan       = 178 * time.Second // observed live span floor per stream
	capMinOverlap    = 170 * time.Second // all-N simultaneously-live window floor
)

// Event-type probes for the lean SSE reader (substring match on the envelope).
var (
	capRunStartedB  = []byte(`"RUN_STARTED"`)
	capTextContentB = []byte(`"TEXT_MESSAGE_CONTENT"`)
	capRunFinishedB = []byte(`"RUN_FINISHED"`)
	capRunErrorB    = []byte(`"RUN_ERROR"`)
)

type capResult struct {
	status   int
	ok       bool
	timeout  bool
	textN    int
	evtN     int
	started  bool
	finished bool
	runErr   string
	firstAt  time.Time
	lastAt   time.Time
	err      string
}

// TestVCap1GB_Concurrent3MinLive drives waves of N concurrent 3-minute-live
// streaming runs under a 1 GiB whole-process budget.
func TestVCap1GB_Concurrent3MinLive(t *testing.T) {
	wavesCSV := os.Getenv("NEXAU_CAP_WAVES")
	if wavesCSV == "" {
		t.Skip(`capacity probe: set NEXAU_CAP_WAVES="500,1000" (CSV wave sizes) to run`)
	}
	strict := os.Getenv("NEXAU_CAP_STRICT") == "1"

	prev := debug.SetMemoryLimit(int64(capBudgetKB << 10))
	t.Cleanup(func() { debug.SetMemoryLimit(prev) })
	t.Logf("CAPSETUP GOMEMLIMIT=%d KiB (%.2f GiB) — budget covers API server + Redis + mock upstream + load-gen clients",
		capBudgetKB, float64(capBudgetKB)/(1<<20))

	for _, w := range strings.Split(wavesCSV, ",") {
		n, err := strconv.Atoi(strings.TrimSpace(w))
		if err != nil || n <= 0 {
			t.Fatalf("bad NEXAU_CAP_WAVES entry %q", w)
		}
		// Let the previous wave's stack free and the collector catch up so
		// per-wave RSS attribution stays meaningful.
		runtime.GC()
		time.Sleep(2 * time.Second)

		t.Run(fmt.Sprintf("wave_%d", n), func(t *testing.T) {
			m := runCapacityWave(t, n)
			verdict, reasons := m["verdict"].(string), m["reasons"].(string)
			t.Logf("CAPRESULT n=%d verdict=%s ok=%v/%v err=%v timeout=%v peak_rss_kb=%v base_rss_kb=%v delta_kb=%v overlap_s=%.1f span_p95_s=%.1f peak_goroutines=%v peak_fds=%v reasons=[%s]",
				n, verdict, m["ok"], n, m["err"], m["timeout"], m["peak_rss_kb"], m["base_rss_kb"], m["delta_rss_kb"],
				m["overlap_s"], m["span_p95_s"], m["peak_goroutines"], m["peak_fds"], reasons)
			for k, v := range m {
				if k != "verdict" && k != "reasons" {
					vm(t, fmt.Sprintf("cap1gb_%d_%s", n, k), v)
				}
			}
			if strict && verdict != "FITS" {
				t.Fatalf("strict capacity wave N=%d did not fit: %s", n, reasons)
			}
		})
	}
}

// runCapacityWave boots a fresh stack, launches n concurrent 3-minute-live
// streaming runs, and returns the wave metrics.
func runCapacityWave(t *testing.T, n int) map[string]any {
	t.Helper()

	o := defaultOpts()
	o.rpmUser = 1_000_000
	o.rpmTenant = 10_000_000
	o.concUser = 100_000
	o.concTenant = 1_000_000
	o.inFlight = 131072
	o.idleTimeout = 5 * time.Second
	o.maxDuration = 6 * time.Minute
	o.meterFlush = 5 * time.Millisecond
	o.meterQueue = 131072
	o.meterBatch = 64
	o.wsHB = 10 * time.Second
	o.sessIdleTTL = time.Hour
	s := newStack(t, o)

	// Upstream script: first content chunk immediately, then one chunk per
	// second for the rest of the 3 minutes; usage + finish at t=180s.
	first := `{"id":"cmpl_1","object":"chat.completion.chunk","model":"openai/gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","content":"a"}}]}`
	mid := `{"id":"cmpl_1","choices":[{"index":0,"delta":{"content":"x"}}]}`
	final := `{"id":"cmpl_1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":181,"total_tokens":191}}`
	s.bifrost.setBodyScript(func(body string) []chunk {
		if strings.Contains(body, "cap3m") {
			sc := make([]chunk, 0, capTextChunks+2)
			sc = append(sc, chunk{data: first}) // t=0: RUN_STARTED + first text
			for i := 1; i < capTextChunks; i++ {
				sc = append(sc, chunk{data: mid, delay: capEventInterval}) // t=1..179
			}
			sc = append(sc, chunk{data: final, delay: capEventInterval}) // t=180
			sc = append(sc, chunk{data: `[DONE]`, delay: 0})
			return sc
		}
		return standardScript()
	})

	sess := s.sessionFor("cap", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")
	body := runBody("openai/gpt-4o", "cap3m live stream", true)

	// Dedicated load client: no shared 384-conn cap, lean default buffers.
	client := &http.Client{
		Transport: &http.Transport{
			MaxConnsPerHost:     n + 128,
			MaxIdleConns:        n + 128,
			MaxIdleConnsPerHost: n + 128,
			IdleConnTimeout:     60 * time.Second,
			DisableCompression:  true,
		},
	}

	// Resource monitor: peak RSS / goroutines / FDs while the wave is live.
	var peakRSS, peakG, peakFD atomic.Int64
	baseRSS, baseG, baseFD := rssKB(), int64(goroutines()), int64(fdCount())
	stopMon := make(chan struct{})
	var monWG sync.WaitGroup
	monWG.Add(1)
	go func() {
		defer monWG.Done()
		fast := time.NewTicker(250 * time.Millisecond)
		slow := time.NewTicker(time.Second)
		defer fast.Stop()
		defer slow.Stop()
		for {
			select {
			case <-stopMon:
				return
			case <-fast.C:
				if r := rssKB(); r > peakRSS.Load() {
					peakRSS.Store(r)
				}
				if g := int64(goroutines()); g > peakG.Load() {
					peakG.Store(g)
				}
			case <-slow.C:
				if f := int64(fdCount()); f > peakFD.Load() {
					peakFD.Store(f)
				}
			}
		}
	}()

	var ms0 runtime.MemStats
	runtime.ReadMemStats(&ms0)

	results := make([]capResult, n)
	var wg sync.WaitGroup
	start := time.Now()

	for i := 0; i < n; i++ {
		if i > 0 && i%250 == 0 {
			time.Sleep(6 * time.Millisecond) // gentle ramp: 250 streams / 6ms
		}
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			r := &results[i]
			ctx, cancel := context.WithTimeout(context.Background(), capClientBudget)
			defer cancel()
			req, err := http.NewRequestWithContext(ctx, http.MethodPost,
				s.replica(0).url+"/v1/agent/sessions/"+sess+"/runs", strings.NewReader(body))
			if err != nil {
				r.err = err.Error()
				return
			}
			req.Header.Set("Authorization", "Bearer "+tok)
			req.Header.Set("Content-Type", "application/json")
			resp, err := client.Do(req)
			if err != nil {
				r.err = err.Error()
				return
			}
			r.status = resp.StatusCode
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusOK {
				r.err = fmt.Sprintf("http %d", resp.StatusCode)
				return
			}
			capReadStream(r, resp.Body)
		}(i)
	}
	wg.Wait()
	wall := time.Since(start)

	// Settle: close idle client conns, let metering drain and goroutines exit.
	client.CloseIdleConnections()
	time.Sleep(2500 * time.Millisecond)
	close(stopMon)
	monWG.Wait()

	var ms1 runtime.MemStats
	runtime.ReadMemStats(&ms1)

	// Aggregate.
	var okN, errN, timeoutN, runErrN int
	var maxFirst, minLast time.Time
	spans := make([]float64, 0, n)
	errClasses := map[string]int{}
	for i := range results {
		r := &results[i]
		switch {
		case r.err != "":
			errN++
			cls := r.err
			if len(cls) > 48 {
				cls = cls[:48]
			}
			errClasses[cls]++
		case r.timeout:
			timeoutN++
		case r.runErr != "":
			runErrN++
		}
		if r.ok {
			okN++
			spans = append(spans, r.lastAt.Sub(r.firstAt).Seconds())
			if maxFirst.IsZero() || r.firstAt.After(maxFirst) {
				maxFirst = r.firstAt
			}
			if minLast.IsZero() || r.lastAt.Before(minLast) {
				minLast = r.lastAt
			}
		}
	}
	sort.Float64s(spans)
	pct := func(p float64) float64 {
		if len(spans) == 0 {
			return -1
		}
		return spans[int(float64(len(spans)-1)*p)]
	}
	overlap := -1.0
	if !maxFirst.IsZero() && !minLast.IsZero() {
		overlap = minLast.Sub(maxFirst).Seconds()
	}

	// Ramp: time from wave start to the LAST successful stream's first event.
	rampMs := int64(0)
	if !maxFirst.IsZero() {
		rampMs = maxFirst.Sub(start).Milliseconds()
	}

	peakR, peakGo, peakFDv := peakRSS.Load(), peakG.Load(), peakFD.Load()
	settledG, settledFD := int64(goroutines()), int64(fdCount())
	deltaKB := peakR - baseRSS
	if deltaKB < 0 {
		deltaKB = 0
	}

	reasons := []string{}
	if okN != n {
		reasons = append(reasons, fmt.Sprintf("streams_failed=%d (err=%d timeout=%d run_err=%d)", n-okN, errN, timeoutN, runErrN))
	}
	if peakR > capBudgetKB {
		reasons = append(reasons, fmt.Sprintf("rss_over_budget=%dkb>%dkb", peakR, capBudgetKB))
	}
	if overlap < capMinOverlap.Seconds() {
		reasons = append(reasons, fmt.Sprintf("overlap=%.1fs<%.0fs", overlap, capMinOverlap.Seconds()))
	}
	verdict := "FITS"
	if len(reasons) > 0 {
		verdict = "BREACH"
	}
	errSummary := ""
	for cls, c := range errClasses {
		if errSummary != "" {
			errSummary += "; "
		}
		errSummary += fmt.Sprintf("%s x%d", cls, c)
	}

	return map[string]any{
		"verdict":            verdict,
		"reasons":            strings.Join(reasons, ", "),
		"ok":                 okN,
		"err":                errN,
		"timeout":            timeoutN,
		"run_err":            runErrN,
		"err_classes":        errSummary,
		"wall_ms":            wall.Milliseconds(),
		"ramp_ms":            rampMs,
		"overlap_s":          overlap,
		"span_p50_s":         pct(0.50),
		"span_p95_s":         pct(0.95),
		"peak_rss_kb":        peakR,
		"base_rss_kb":        baseRSS,
		"delta_rss_kb":       deltaKB,
		"kb_per_stream":      float64(deltaKB) / float64(n),
		"peak_goroutines":    peakGo,
		"settled_goroutines": settledG,
		"goroutine_delta":    peakGo - baseG,
		"peak_fds":           peakFDv,
		"settled_fds":        settledFD,
		"fd_delta":           peakFDv - baseFD,
		"gc_cycles":          int64(ms1.NumGC - ms0.NumGC),
		"gc_pause_ms":        float64(ms1.PauseTotalNs-ms0.PauseTotalNs) / 1e6,
		"heap_inuse_kb":      int64(ms1.HeapInuse >> 10),
		"upstream_ops":       s.bifrost.count(),
	}
}

// capReadStream is a lean synchronous SSE reader: 8KB buffer, substring event
// classification, no per-event allocation. Records first/last event times so
// the live span and the wave overlap window can be derived.
func capReadStream(r *capResult, body io.Reader) {
	buf := make([]byte, 8192)
	var carry []byte
	term := []byte("\n\n")
	for {
		nr, rerr := body.Read(buf)
		if nr > 0 {
			carry = append(carry, buf[:nr]...)
			for {
				idx := bytes.Index(carry, term)
				if idx < 0 {
					break
				}
				frame := carry[:idx]
				if line, ok := bytes.CutPrefix(frame, []byte("data: ")); ok {
					now := time.Now()
					if r.firstAt.IsZero() {
						r.firstAt = now
					}
					r.lastAt = now
					r.evtN++
					switch {
					case bytes.Contains(line, capRunStartedB):
						r.started = true
					case bytes.Contains(line, capTextContentB):
						r.textN++
					case bytes.Contains(line, capRunFinishedB):
						r.finished = true
					case bytes.Contains(line, capRunErrorB):
						r.runErr = "RUN_ERROR"
					}
				}
				rest := carry[idx+2:]
				copy(carry, rest)
				carry = carry[:len(rest)]
			}
		}
		if rerr != nil {
			if rerr != io.EOF {
				if strings.Contains(rerr.Error(), "context deadline exceeded") {
					r.timeout = true
				} else if !r.finished {
					r.err = rerr.Error()
				}
			}
			break
		}
	}
	r.ok = r.status == http.StatusOK && r.started && r.finished &&
		r.textN >= capTextChunks-1 && r.runErr == "" && r.err == "" && !r.timeout &&
		!r.firstAt.IsZero() && r.lastAt.Sub(r.firstAt) >= capMinSpan
}
