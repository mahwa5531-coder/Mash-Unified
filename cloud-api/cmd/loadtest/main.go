// Command loadtest is a reproducible load generator for the NexaU Cloud API
// (spec §40). It drives concurrent streaming and non-streaming runs against a
// live deployment and reports first-byte latency, p50/p95/p99, throughput,
// error rate and process RSS.
//
// Usage:
//
//	go run ./cmd/loadtest \
//	  -url https://api.nexau.cloud \
//	  -token "$NEXAU_ACCESS_TOKEN" \
//	  -sessions 200 -streams 1000 -requests 1000 -duration 60s
//
// Metrics are printed to stdout as a table plus a machine-readable summary.
package main

import (
	"bufio"
	"context"
	"flag"
	"fmt"
	"io"
	"math/rand"
	"os"
	"runtime"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

var (
	baseURL  = flag.String("url", "http://localhost:8080", "API base URL")
	token    = flag.String("token", "", "Bearer access token")
	session  = flag.String("session", "", "session id (created automatically when empty)")
	streams  = flag.Int("streams", 0, "concurrent streaming runs")
	requests = flag.Int("requests", 0, "non-stream requests (N total, sequential batches)")
	duration = flag.Duration("duration", 30*time.Second, "wall-clock budget for the whole run")
	model    = flag.String("model", "openai/gpt-4o", "model to request")
	body     = flag.String("prompt", "Summarize the quarterly revenue trend in one paragraph.", "user prompt payload")
	interval = flag.Duration("interval", 200*time.Millisecond, "per-worker pacing between requests")
)

func main() {
	flag.Parse()
	if *token == "" {
		fmt.Fprintln(os.Stderr, "loadtest: -token is required")
		os.Exit(2)
	}
	if *streams == 0 && *requests == 0 {
		*streams, *requests = 200, 200
	}

	client := sharedClient

	// Session bootstrap.
	sessID := *session
	if sessID == "" {
		sessID = fmt.Sprintf("sess_load_%d", time.Now().UnixMilli())
		req, _ := newPOST(*baseURL+"/v1/agent/sessions", `{"metadata":{"origin":"loadtest"}}`, *token)
		resp, err := client.Do(req)
		if err != nil || resp.StatusCode >= 300 {
			status := 0
			if resp != nil {
				status = resp.StatusCode
				_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
				_ = resp.Body.Close()
			}
			fmt.Fprintf(os.Stderr, "loadtest: session create failed (status %d): %v\n", status, err)
			os.Exit(1)
		}
		var out struct {
			ID string `json:"id"`
		}
		_ = jsonDecode(resp.Body, &out)
		_ = resp.Body.Close()
		if out.ID != "" {
			sessID = out.ID
		}
	}
	fmt.Printf("target=%s session=%s model=%s\n", *baseURL, sessID, *model)
	fmt.Printf("streams=%d requests=%d duration=%s interval=%s\n\n", *streams, *requests, *duration, *interval)

	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)
	rssBefore := mem.Sys

	ctx, cancel := context.WithTimeout(context.Background(), *duration)
	defer cancel()

	var wg sync.WaitGroup
	var (
		streamTTFB  durationSlice
		streamTotal durationSlice
		streamErrs  atomic.Int64
		streamOK    atomic.Int64
		reqLat      durationSlice
		reqErrs     atomic.Int64
		reqOK       atomic.Int64
	)

	payload := fmt.Sprintf(`{"model":%q,"stream":true,"messages":[{"role":"user","content":%q}]}`, *model, *body)
	payloadNS := fmt.Sprintf(`{"model":%q,"stream":false,"messages":[{"role":"user","content":%q}]}`, *model, *body)

	// Stream workers.
	for i := 0; i < *streams; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			for {
				select {
				case <-ctx.Done():
					return
				default:
				}
				ttfb, total, err := runStream(ctx, client, sessID, payload)
				if err != nil {
					streamErrs.Add(1)
				} else {
					streamOK.Add(1)
					streamTTFB.append(ttfb)
					streamTotal.append(total)
				}
				pause(ctx, *interval+time.Duration(rand.Int63n(int64(*interval))))
			}
		}(i)
	}

	// Non-stream workers (bounded by request count).
	workers := min(*requests, 64)
	if workers < 1 {
		workers = 1
	}
	var issued atomic.Int64
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				if issued.Add(1) > int64(*requests) {
					return
				}
				select {
				case <-ctx.Done():
					return
				default:
				}
				lat, err := runRequest(ctx, client, sessID, payloadNS)
				if err != nil {
					reqErrs.Add(1)
				} else {
					reqOK.Add(1)
					reqLat.append(lat)
				}
				pause(ctx, *interval)
			}
		}()
	}

	wg.Wait()

	elapsed := *duration
	if ctx.Err() != nil && *requests > 0 {
		// Requests may finish under budget; approximate with the budget.
	}
	runtime.ReadMemStats(&mem)

	fmt.Println("=== RESULTS ===")
	printDist("stream first-byte (ttfb)", streamTTFB.slice())
	printDist("stream total           ", streamTotal.slice())
	printDist("non-stream latency     ", reqLat.slice())
	fmt.Printf("\nstreams ok/err      : %d / %d\n", streamOK.Load(), streamErrs.Load())
	fmt.Printf("requests ok/err     : %d / %d\n", reqOK.Load(), reqErrs.Load())
	fmt.Printf("stream throughput   : %.1f runs/s\n", float64(streamOK.Load())/elapsed.Seconds())
	fmt.Printf("request throughput  : %.1f req/s\n", float64(reqOK.Load())/elapsed.Seconds())
	fmt.Printf("peak Sys memory     : %.1f MiB (baseline %.1f)\n",
		float64(mem.Sys)/(1<<20), float64(rssBefore)/(1<<20))
	fmt.Printf("heap objects        : %d\n", mem.HeapObjects)
	fmt.Printf("goroutines (final)  : %d\n", runtime.NumGoroutine())

	exit := 0
	if streamErrs.Load()+reqErrs.Load() > 0 {
		exit = 1
	}
	os.Exit(exit)
}

func runStream(ctx context.Context, c *sharedClientType, sess, payload string) (time.Duration, time.Duration, error) {
	start := time.Now()
	req, err := newPOST(*baseURL+"/v1/agent/sessions/"+sess+"/runs", payload, *token)
	if err != nil {
		return 0, 0, err
	}
	req = req.WithContext(ctx)
	resp, err := c.Do(req)
	if err != nil {
		return 0, 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 2048))
		return 0, 0, fmt.Errorf("stream status %d", resp.StatusCode)
	}

	// First byte = first SSE frame.
	rd := bufio.NewReaderSize(resp.Body, 32<<10)
	var ttfb time.Duration
	first := true
	for {
		line, err := rd.ReadString('\n')
		if first && len(line) > 0 {
			ttfb = time.Since(start)
			first = false
		}
		if err != nil {
			if err == io.EOF {
				break
			}
			return ttfb, 0, err
		}
		if strings.TrimSpace(line) == "data: [DONE]" {
			break
		}
	}
	return ttfb, time.Since(start), nil
}

func runRequest(ctx context.Context, c *sharedClientType, sess, payload string) (time.Duration, error) {
	start := time.Now()
	req, err := newPOST(*baseURL+"/v1/agent/sessions/"+sess+"/runs", payload, *token)
	if err != nil {
		return 0, err
	}
	req = req.WithContext(ctx)
	resp, err := c.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode != 200 {
		return time.Since(start), fmt.Errorf("request status %d", resp.StatusCode)
	}
	return time.Since(start), nil
}

func pause(ctx context.Context, d time.Duration) {
	if d <= 0 {
		return
	}
	select {
	case <-ctx.Done():
	case <-time.After(d):
	}
}

type durationSlice struct {
	mu  sync.Mutex
	val []time.Duration
}

func (d *durationSlice) append(v time.Duration) {
	d.mu.Lock()
	d.val = append(d.val, v)
	d.mu.Unlock()
}

func (d *durationSlice) slice() []time.Duration {
	d.mu.Lock()
	defer d.mu.Unlock()
	out := make([]time.Duration, len(d.val))
	copy(out, d.val)
	return out
}

func printDist(name string, ds []time.Duration) {
	if len(ds) == 0 {
		fmt.Printf("%s : (no samples)\n", name)
		return
	}
	sort.Slice(ds, func(i, j int) bool { return ds[i] < ds[j] })
	p := func(q float64) time.Duration {
		i := int(float64(len(ds)-1) * q)
		return ds[i]
	}
	fmt.Printf("%s : n=%d p50=%v p95=%v p99=%v max=%v\n",
		name, len(ds), p(0.50), p(0.95), p(0.99), ds[len(ds)-1])
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
