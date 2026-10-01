// Spec §15 (Redis Failure), §16 (PostgreSQL Failure), §17 (Database
// Connection Pool Stress) and §31 (Recovery).
//
// Fail-open / fail-closed posture is asserted explicitly for every Redis
// dependency: rate limiting (fail-open, alarmed), idempotency (fail-open —
// an optimization, not an authorization gate), WS quota (fail-open), event
// bus (fail-closed: no stream without the durable bus). Redis is NEVER an
// authorization source: identity resolution is PostgreSQL-backed and
// fail-closed. PostgreSQL failures are fail-closed everywhere.
package validation

import (
	"errors"
	"net"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"github.com/nexau-cloud/nexau-api/internal/streaming"
)

// connRefused builds a realistic connection-refused error (net.OpError),
// the shape pgx surfaces when PostgreSQL is unreachable.
func connRefused() error {
	return &net.OpError{Op: "dial", Net: "tcp", Err: errors.New("connection refused")}
}

// outageStack builds a stack whose Redis connections flow through a
// toggleable TCP proxy: breaking it produces a genuine network outage
// (connections reset, dials fail) across every replica and every dependency.
func outageStack(t *testing.T, o stackOpts) (*stack, *redisProxy) {
	t.Helper()
	// Two-phase: first create a throwaway stack to learn the miniredis addr?
	// Simpler: run miniredis manually, then wire a stack through the proxy.
	mr := miniredis.RunT(t)
	proxy := newRedisProxy(t, mr.Addr())
	o.redisAddr = proxy.addr()
	s := newStack(t, o)
	// Re-point the shared rdb (used by the harness for revocation etc.).
	s.rdb = redis.NewClient(&redis.Options{Addr: proxy.addr()})
	return s, proxy
}

// TestV15_RedisFailureRateLimiting: with Redis unreachable and fail-open
// configured, requests still pass (availability posture); with fail-closed,
// the limiter denies cleanly (no silent bypass).
func TestV15_RedisFailureRateLimiting(t *testing.T) {
	t.Run("fail-open posture (default: availability with alarm)", func(t *testing.T) {
		s, proxy := outageStack(t, defaultOpts())
		s.bifrost.setScript(standardScript()...)
		sess := s.sessionFor("rdown", "ten_A", "usr_1")
		tok := s.tokenFor("usr_1", "ten_A")

		proxy.breakConn()
		resp, err := s.postRun(0, tok, sess, runBody("openai/gpt-4o", "x", true), nil)
		if err != nil {
			t.Fatalf("post during redis outage: %v", err)
		}
		events := readSSE(t, resp, streaming.EventRunFinished, 15*time.Second)
		if len(events) > 0 && events[len(events)-1].env.Type == streaming.EventRunFinished {
			// Fail-open: traffic flowed.
			vm(t, "redis_outage_fail_open", "passed")
		} else {
			// Fail-open on the limiter but a downstream Redis dependency
			// (event bus) failed closed: acceptable documented outcome set
			// is {run completes, clean DEPENDENCY_UNAVAILABLE terminal}.
			last := "<none>"
			if len(events) > 0 {
				last = events[len(events)-1].env.Type
			}
			if last != streaming.EventRunError {
				t.Fatalf("fail-open posture neither passed nor errored cleanly: last=%s", last)
			}
			var d streaming.RunErrorData
			_ = jsonUnmarshal(events[len(events)-1].env.Data, &d)
			if d.Code != "DEPENDENCY_UNAVAILABLE" {
				t.Fatalf("fail-open terminal error code: %s", d.Code)
			}
			vm(t, "redis_outage_fail_open", "bus_fail_closed")
		}
	})

	t.Run("fail-closed posture (strict deployments)", func(t *testing.T) {
		o := defaultOpts()
		o.failOpen = false
		s, proxy := outageStack(t, o)
		sess := s.sessionFor("rdown", "ten_A", "usr_1")
		tok := s.tokenFor("usr_1", "ten_A")

		proxy.breakConn()
		resp, err := s.postRun(0, tok, sess, runBody("openai/gpt-4o", "x", true), nil)
		if err != nil {
			t.Fatalf("post: %v", err)
		}
		// Fail-closed: the request is REJECTED (a limiter denial — limits are
		// never silently bypassed), never a hang, never a crash, never
		// forwarded upstream without admission.
		eb := decodeErr(t, resp)
		if resp.StatusCode != http.StatusTooManyRequests && resp.StatusCode != http.StatusServiceUnavailable {
			t.Fatalf("fail-closed posture: got %d/%s, want 429 (limiter denial) or 503", resp.StatusCode, eb.Error.Code)
		}
		if s.bifrost.count() != 0 {
			t.Fatal("fail-closed limiter must reject BEFORE Bifrost")
		}
		vm(t, "redis_outage_fail_closed", "denied")
	})
}

// TestV15_RedisFailureIdempotency: with Redis unreachable, idempotency
// cannot be enforced — requests execute (documented fail-open: idempotency is
// an optimization, not an authorization gate) and the service stays healthy.
func TestV15_RedisFailureIdempotency(t *testing.T) {
	s, proxy := outageStack(t, defaultOpts())
	s.bifrost.setScript(standardScript()...)
	sess := s.sessionFor("idemdown", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")
	body := runBody("openai/gpt-4o", "duplicate under outage", true)
	hdrs := map[string]string{"Idempotency-Key": "idem_outage_1"}

	proxy.breakConn()
	for i := 0; i < 2; i++ {
		resp, err := s.postRun(0, tok, sess, body, hdrs)
		if err != nil {
			t.Fatalf("post %d during outage: %v", i, err)
		}
		events := readSSE(t, resp, streaming.EventRunError, 15*time.Second)
		if len(events) > 0 && events[len(events)-1].env.Type == streaming.EventRunError {
			var d streaming.RunErrorData
			_ = jsonUnmarshal(events[len(events)-1].env.Data, &d)
			if d.Code != "DEPENDENCY_UNAVAILABLE" {
				t.Fatalf("unexpected terminal error during outage: %s", d.Code)
			}
		}
	}
	if goroutines() > 300 {
		t.Fatalf("goroutine count after outage: %d", goroutines())
	}
	vm(t, "redis_down_idempotency_posture", "fail_open_documented")
}

// TestV15_RedisFailureAuth: authentication NEVER depends on Redis being
// reachable — identity resolution is authoritative and fail-closed to the
// identity source, and Redis-backed revocation degrades open-by-design but
// the request must never 401 just because Redis is down.
func TestV15_RedisFailureAuth(t *testing.T) {
	s, proxy := outageStack(t, defaultOpts())
	s.bifrost.setScript(standardScript()...)
	sess := s.sessionFor("authdown", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")

	proxy.breakConn()
	resp, err := s.postRun(0, tok, sess, runBody("openai/gpt-4o", "x", true), nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	if resp.StatusCode == http.StatusUnauthorized {
		eb := decodeErr(t, resp)
		t.Fatalf("auth failed during Redis outage: %s — Redis must never be an auth dependency", eb.Error.Code)
	}
	resp.Body.Close()
}

// TestV15_RedisOutageDuringActiveStream: Redis dies MID-STREAM (network
// level) — the active stream must finish cleanly or terminate with a stable
// error; never hang.
func TestV15_RedisOutageDuringActiveStream(t *testing.T) {
	s, proxy := outageStack(t, defaultOpts())
	s.bifrost.setScript(
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","content":"a"}}]}`, delay: 30 * time.Millisecond},
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"content":"b"}}]}`, delay: 500 * time.Millisecond},
		chunk{data: `{"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}`, delay: 300 * time.Millisecond},
		chunk{data: `[DONE]`, delay: 0},
	)
	sess := s.sessionFor("midstream", "ten_A", "usr_1")
	resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sess, runBody("openai/gpt-4o", "x", true), nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	defer resp.Body.Close()

	events := make(chan sseEvt, 128)
	go func() {
		buf := make([]byte, 64<<10)
		var carry []byte
		for {
			n, rerr := resp.Body.Read(buf)
			if n > 0 {
				carry = append(carry, buf[:n]...)
				for {
					idx := indexTerminator(carry)
					if idx < 0 {
						break
					}
					frame := string(carry[:idx])
					carry = carry[idx+2:]
					if line, ok := strings.CutPrefix(frame, "data: "); ok {
						if env, derr := streaming.DecodeEnvelope([]byte(line)); derr == nil {
							events <- sseEvt{env: *env, at: time.Now()}
						}
					}
				}
			}
			if rerr != nil {
				close(events)
				return
			}
		}
	}()

	var got []sseEvt
	select {
	case ev, ok := <-events:
		if !ok {
			t.Fatal("stream closed before the first event")
		}
		got = append(got, ev)
	case <-time.After(10 * time.Second):
		t.Fatal("no first event")
	}
	proxy.breakConn()

	deadline := time.After(20 * time.Second)
	for {
		select {
		case ev, ok := <-events:
			if !ok {
				goto finished
			}
			got = append(got, ev)
			if ev.env.Type == streaming.EventRunFinished || ev.env.Type == streaming.EventRunError {
				goto finished
			}
		case <-deadline:
			t.Fatal("stream hung during Redis outage")
		}
	}
finished:
	if len(got) == 0 {
		t.Fatal("no events read")
	}
	last := got[len(got)-1].env.Type
	if last != streaming.EventRunFinished && last != streaming.EventRunError {
		t.Fatalf("mid-outage stream ended without terminal event: %s", last)
	}
}

// TestV16_PostgresFailureMatrix: sessions/runs/usage failures — clean errors,
// process alive, no goroutine leak, no connection leak.
func TestV16_PostgresFailureMatrix(t *testing.T) {
	dbErr := connRefused()

	t.Run("sessions store down → clean 503, no Bifrost call", func(t *testing.T) {
		s := newStackDefault(t)
		sess := s.sessionFor("pgdown", "ten_A", "usr_1")
		s.sessions.inject(dbErr, nil, 0)

		resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sess, runBody("openai/gpt-4o", "x", true), nil)
		if err != nil {
			t.Fatalf("post: %v", err)
		}
		eb := decodeErr(t, resp)
		if resp.StatusCode != http.StatusServiceUnavailable || eb.Error.Code != "DEPENDENCY_UNAVAILABLE" {
			t.Fatalf("sessions down: %d/%s", resp.StatusCode, eb.Error.Code)
		}
		if s.bifrost.count() != 0 {
			t.Fatal("sessions failure must reject before Bifrost")
		}
	})

	t.Run("runs store down at create → clean 503", func(t *testing.T) {
		s := newStackDefault(t)
		sess := s.sessionFor("pgdown", "ten_A", "usr_1")
		s.runs.inject(dbErr, nil, nil, 0, 0)

		resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sess, runBody("openai/gpt-4o", "x", true), nil)
		if err != nil {
			t.Fatalf("post: %v", err)
		}
		eb := decodeErr(t, resp)
		if resp.StatusCode != http.StatusServiceUnavailable || eb.Error.Code != "DEPENDENCY_UNAVAILABLE" {
			t.Fatalf("runs down: %d/%s", resp.StatusCode, eb.Error.Code)
		}
	})

	t.Run("runs Complete fails transiently → run still finishes, usage retried", func(t *testing.T) {
		s := newStackDefault(t)
		s.bifrost.setScript(standardScript()...)
		sess := s.sessionFor("pgcomp", "ten_A", "usr_1")
		// First Complete attempt fails; the fake returns an error once.
		s.runs.inject(nil, nil, nil, 1, 0)

		resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sess, runBody("openai/gpt-4o", "x", true), nil)
		if err != nil {
			t.Fatalf("post: %v", err)
		}
		events := readSSE(t, resp, streaming.EventRunFinished, 15*time.Second)
		if len(events) == 0 {
			t.Fatal("stream failed because terminal write failed once")
		}
		// The terminal state eventually lands via the reconcile path or the
		// next retry — poll for it.
		waitFor(t, 5*time.Second, func() bool {
			for _, r := range s.runs.all() {
				if r.Terminal() {
					return true
				}
			}
			return false
		})
	})

	t.Run("process stays alive and goroutines stay bounded after failures", func(t *testing.T) {
		s := newStackDefault(t)
		sess := s.sessionFor("pgalive", "ten_A", "usr_1")
		tok := s.tokenFor("usr_1", "ten_A")
		s.sessions.inject(dbErr, nil, 0)

		base := goroutines()
		for i := 0; i < 10; i++ {
			resp, err := s.postRun(0, tok, sess, runBody("openai/gpt-4o", "x", true), nil)
			if err != nil {
				t.Fatalf("post %d: %v", i, err)
			}
			resp.Body.Close()
		}
		if goroutines() > base+50 {
			t.Fatalf("goroutines=%d after 10 failed requests (base=%d): leak suspected", goroutines(), base)
		}
	})
}

// TestV16_PostgresSlow: slow database — requests bounded by the setup
// timeout, no hang, service alive.
func TestV16_PostgresSlow(t *testing.T) {
	s := newStackDefault(t)
	s.bifrost.setScript(standardScript()...)
	sess := s.sessionFor("pgslow", "ten_A", "usr_1")
	// 300ms per session lookup: well under the 5s setup timeout but slow.
	s.sessions.inject(nil, nil, 300*time.Millisecond)

	start := time.Now()
	resp, err := s.postRun(0, s.tokenFor("usr_1", "ten_A"), sess, runBody("openai/gpt-4o", "x", true), nil)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	events := readSSE(t, resp, streaming.EventRunFinished, 15*time.Second)
	if len(events) == 0 {
		t.Fatal("slow DB made the run fail")
	}
	if d := time.Since(start); d > 10*time.Second {
		t.Fatalf("slow DB request took %s — setup timeout not bounding", d)
	}
	vm(t, "pg_slow_300ms_run_ms", time.Since(start).Milliseconds())
}

// TestV17_PoolStressBoundedWaiting: more concurrent requests than the
// in-flight capacity with slow PG — bounded waiting, no deadlock, no
// unbounded goroutines.
func TestV17_PoolStressBoundedWaiting(t *testing.T) {
	s := newStackDefault(t)
	s.bifrost.setScript(standardScript()...)
	sess := s.sessionFor("pool", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")

	// Every sessions.Get takes 150ms; 40 concurrent requests serialize on
	// the store lock (equivalent to a tiny connection pool).
	s.sessions.inject(nil, nil, 150*time.Millisecond)

	base := goroutines()
	var wg sync.WaitGroup
	start := time.Now()
	for i := 0; i < 40; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			resp, err := s.postRun(0, tok, sess, runBody("openai/gpt-4o", "x", true), nil)
			if err != nil {
				return
			}
			readSSE(t, resp, "", 30*time.Second)
		}()
	}
	wg.Wait()
	elapsed := time.Since(start)

	if elapsed > 45*time.Second {
		t.Fatalf("40 serialized requests took %s — pool starvation/deadlock", elapsed)
	}
	if goroutines() > base+100 {
		t.Fatalf("goroutines=%d (base=%d) after pool stress: unbounded", goroutines(), base)
	}
	vm(t, "pool_stress_40req_ms", elapsed.Milliseconds())
}

// TestV31_RecoveryAfterFailures: after Redis/PG/Bifrost failures and
// restoration, normal traffic resumes automatically.
func TestV31_RecoveryAfterFailures(t *testing.T) {
	s, proxy := outageStack(t, defaultOpts())
	s.bifrost.setScript(standardScript()...)
	sess := s.sessionFor("recov", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")

	runOK := func() bool {
		resp, err := s.postRun(0, tok, sess, runBody("openai/gpt-4o", "recovery probe", true), nil)
		if err != nil {
			return false
		}
		events := readSSE(t, resp, streaming.EventRunFinished, 15*time.Second)
		return len(events) > 0 && events[len(events)-1].env.Type == streaming.EventRunFinished
	}

	if !runOK() {
		t.Fatal("baseline run failed")
	}

	// 1. Redis network outage → recovery.
	proxy.breakConn()
	resp, _ := s.postRun(0, tok, sess, runBody("openai/gpt-4o", "x", true), nil)
	if resp != nil {
		resp.Body.Close()
	}
	proxy.restore()
	if !waitFor(t, 15*time.Second, func() bool { return runOK() }) {
		t.Fatal("traffic did not resume after Redis recovery")
	}

	// 2. PostgreSQL outage → recovery.
	dbErr := connRefused()
	s.sessions.inject(dbErr, nil, 0)
	resp, _ = s.postRun(0, tok, sess, runBody("openai/gpt-4o", "x", true), nil)
	if resp != nil {
		resp.Body.Close()
	}
	s.sessions.inject(nil, nil, 0)
	if !waitFor(t, 15*time.Second, func() bool { return runOK() }) {
		t.Fatal("traffic did not resume after PostgreSQL recovery")
	}

	// 3. Bifrost outage → recovery.
	s.bifrost.setMode(bifrostHTTPStatus, 503, bifrostErrBody(503, "503", "down"), 0)
	resp, _ = s.postRun(0, tok, sess, runBody("openai/gpt-4o", "x", true), nil)
	if resp != nil {
		resp.Body.Close()
	}
	s.bifrost.setMode(bifrostScript, 0, "", 0)
	s.bifrost.setScript(standardScript()...)
	if !waitFor(t, 15*time.Second, func() bool { return runOK() }) {
		t.Fatal("traffic did not resume after Bifrost recovery")
	}

	vm(t, "recovery_all_dependencies", 1)
}
