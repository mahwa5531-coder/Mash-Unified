// Spec §14 (Rate-Limit Tests): user/tenant/model dimensions, the 101st
// request, and the multi-instance global limit through one Redis.
package validation

import (
	"fmt"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/streaming"
)

// TestV14_UserRateLimitBoundary: limit 5/min for the low-RPM identity —
// requests 1..5 pass, the 6th is rejected.
func TestV14_UserRateLimitBoundary(t *testing.T) {
	s := newStackDefault(t)
	s.bifrost.setScript(standardScript()...)
	sess := s.sessionFor("rl", "ten_L", "usr_lowrpm")
	tok := s.tokenFor("usr_lowrpm", "ten_L")

	var ok, limited int
	for i := 1; i <= 6; i++ {
		// Non-stream requests complete deterministically.
		resp, err := s.postRun(0, tok, sess, runBody("openai/gpt-4o", fmt.Sprintf("req %d", i), false), nil)
		if err != nil {
			t.Fatalf("post %d: %v", i, err)
		}
		if resp.StatusCode == http.StatusOK {
			resp.Body.Close()
			ok++
		} else {
			eb := decodeErr(t, resp)
			if resp.StatusCode != http.StatusTooManyRequests || eb.Error.Code != "RATE_LIMITED" {
				t.Fatalf("request %d: %d/%s, want 429/RATE_LIMITED", i, resp.StatusCode, eb.Error.Code)
			}
			limited++
		}
	}
	if ok != 5 || limited != 1 {
		t.Fatalf("allowed=%d limited=%d, want 5/1", ok, limited)
	}
	// The rejected request must never reach Bifrost.
	if s.bifrost.count() != 5 {
		t.Fatalf("upstream calls=%d, want 5 (rejected request must not forward)", s.bifrost.count())
	}
	vm(t, "rate_limit_allowed", ok)
	vm(t, "rate_limit_rejected", limited)
}

// TestV14_MultiInstanceGlobalLimit: three API replicas share one Redis —
// 6 requests against a 5/min limit across replicas: exactly 5 pass. Three
// independent local limits would have allowed 15.
func TestV14_MultiInstanceGlobalLimit(t *testing.T) {
	// ten_M identity carries a 5 RPM plan limit with default concurrency;
	// 3 replicas share the Redis-backed limiter state.
	s := newStack(t, func() stackOpts {
		o := defaultOpts()
		o.replicas = 3
		return o
	}())
	s.bifrost.setScript(standardScript()...)
	sess := s.sessionFor("mrl", "ten_M", "usr_rpm5")
	tok := s.tokenFor("usr_rpm5", "ten_M")

	var ok, limited int
	// Sequential round-robin across replicas 0,1,2: order-insensitive proof
	// that the shared Redis state — not per-instance memory — enforces the cap.
	for i := 0; i < 6; i++ {
		resp, err := s.postRun(i%3, tok, sess, runBody("openai/gpt-4o", fmt.Sprintf("mreq %d", i), false), nil)
		if err != nil {
			t.Fatalf("post %d: %v", i, err)
		}
		if resp.StatusCode == http.StatusOK {
			resp.Body.Close()
			ok++
		} else {
			eb := decodeErr(t, resp)
			limited++
			if resp.StatusCode != http.StatusTooManyRequests || eb.Error.Code != "RATE_LIMITED" {
				t.Fatalf("request %d: %d/%s, want 429/RATE_LIMITED", i, resp.StatusCode, eb.Error.Code)
			}
		}
	}

	if ok != 5 || limited != 1 {
		t.Fatalf("GLOBAL limit across 3 replicas: allowed=%d limited=%d, want 5/1 (three independent local limits would allow 15)", ok, limited)
	}
	vm(t, "multi_instance_allowed", ok)
	vm(t, "multi_instance_rejected", limited)
}

// TestV14_ConcurrencyLimit: ConcurrentRunsUser=2 for the low-limit identity;
// a third concurrent stream is rejected with CONCURRENCY_LIMIT.
func TestV14_ConcurrencyLimit(t *testing.T) {
	s := newStackDefault(t)
	// Two long-running streams keep both slots busy.
	stall := []chunk{
		{data: `{"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","content":"hold"}}]}`, delay: 30 * time.Millisecond},
		{data: `{"id":"c1","choices":[{"index":0,"delta":{"content":"ing"}}]}`, delay: 20 * time.Second},
	}
	s.bifrost.setScript(stall...)
	sess := s.sessionFor("conc", "ten_L", "usr_lowrpm")
	tok := s.tokenFor("usr_lowrpm", "ten_L")

	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			resp, err := s.postRun(0, tok, sess, runBody("openai/gpt-4o", "long", true), nil)
			if err != nil {
				t.Errorf("post: %v", err)
				return
			}
			readSSE(t, resp, "", 30*time.Second) // drain until cancelled/complete
		}()
	}
	// Wait until both runs are actually started upstream.
	waitFor(t, 5*time.Second, func() bool { return s.bifrost.count() >= 2 })

	// Third concurrent run: rejected.
	resp, err := s.postRun(0, tok, sess, runBody("openai/gpt-4o", "third", true), nil)
	if err != nil {
		t.Fatalf("post third: %v", err)
	}
	eb := decodeErr(t, resp)
	if resp.StatusCode != http.StatusTooManyRequests || eb.Error.Code != "CONCURRENCY_LIMIT" {
		t.Fatalf("third concurrent: %d/%s, want 429/CONCURRENCY_LIMIT", resp.StatusCode, eb.Error.Code)
	}
	if s.bifrost.count() != 2 {
		t.Fatalf("upstream calls=%d, want 2 (third must not forward)", s.bifrost.count())
	}
	vm(t, "concurrency_limit_enforced", 1)
}

// TestV14_RateLimitNotCrossTenant: tenant B's usage must not consume tenant
// A's budget.
func TestV14_RateLimitNotCrossTenant(t *testing.T) {
	s := newStackDefault(t)
	s.bifrost.setScript(standardScript()...)

	sessL := s.sessionFor("iso", "ten_L", "usr_lowrpm")
	sessA := s.sessionFor("iso", "ten_A", "usr_1")

	// Exhaust tenant L (5 RPM).
	for i := 0; i < 5; i++ {
		resp, err := s.postRun(0, s.tokenFor("usr_lowrpm", "ten_L"), sessL, runBody("openai/gpt-4o", "x", false), nil)
		if err != nil {
			t.Fatalf("post L %d: %v", i, err)
		}
		resp.Body.Close()
	}

	// Tenant A is unaffected.
	resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sessA, runBody("openai/gpt-4o", "x", true), nil)
	if err != nil {
		t.Fatalf("post A: %v", err)
	}
	events := readSSE(t, resp, streaming.EventRunFinished, 10*time.Second)
	if len(events) == 0 {
		t.Fatal("tenant A wrongly limited by tenant L's budget")
	}
}
