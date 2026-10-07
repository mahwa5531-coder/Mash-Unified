package middleware

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/mash-cloud/mash-api/internal/reqctx"
)

func TestRequestIDGenerated(t *testing.T) {
	var ctxValue string
	h := RequestID()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctxValue = reqctx.RequestID(r.Context())
		w.WriteHeader(200)
	}))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	h.ServeHTTP(rec, req)
	rid := rec.Header().Get("X-Request-Id")
	if !strings.HasPrefix(rid, "req_") {
		t.Fatalf("generated request id: %q", rid)
	}
	if ctxValue != rid {
		t.Fatalf("context value must match header: %q vs %q", ctxValue, rid)
	}
}

func TestRequestIDHonorsWellFormedInbound(t *testing.T) {
	h := RequestID()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-Request-Id", "lb-trace-42")
	h.ServeHTTP(rec, req)
	if got := rec.Header().Get("X-Request-Id"); got != "lb-trace-42" {
		t.Fatalf("inbound id must be honored: %q", got)
	}
}

func TestRequestIDRejectsGarbage(t *testing.T) {
	for _, bad := range []string{"with spaces", "logo<p>", "", strings.Repeat("x", 200)} {
		h := RequestID()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		if bad != "" {
			req.Header.Set("X-Request-Id", bad)
		}
		h.ServeHTTP(rec, req)
		if got := rec.Header().Get("X-Request-Id"); strings.HasPrefix(got, "req_") == false {
			t.Fatalf("garbage inbound id must be replaced: %q", got)
		}
	}
}

func TestRecoveryCatchesPanic(t *testing.T) {
	h := Recovery(nil)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic("boom")
	}))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("panic must map to 500: %d", rec.Code)
	}
	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || body.Error.Code != "INTERNAL" {
		t.Fatalf("panic body must be safe JSON: %q err=%v", rec.Body.String(), err)
	}
	if strings.Contains(rec.Body.String(), "boom") {
		t.Fatal("panic detail must not leak")
	}
}

func TestRecoveryPassesThrough(t *testing.T) {
	h := Recovery(nil)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusTeapot {
		t.Fatalf("status: %d", rec.Code)
	}
}

func TestBodyLimitRejectsContentLength(t *testing.T) {
	h := BodyLimit(1024)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader("x"))
	req.ContentLength = 4096
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized Content-Length must 413: %d", rec.Code)
	}
}

func TestBodyLimitCapsStreamingBody(t *testing.T) {
	h := BodyLimit(64)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		buf := make([]byte, 4096)
		n, err := r.Body.Read(buf)
		if err == nil || n > 64 {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		w.WriteHeader(200)
	}))
	// Unknown length (chunked): the reader cap must enforce in-stream.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	req.Body = io.NopCloser(strings.NewReader(strings.Repeat("x", 4096)))
	req.ContentLength = 0 // chunked semantics: the cap must catch it at read time
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("bounded read: %d", rec.Code)
	}
}

func TestInFlightSaturation(t *testing.T) {
	block := make(chan struct{})
	h := InFlight(1, nil)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-block
	}))

	var wg sync.WaitGroup
	results := make([]int, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
			results[i] = rec.Code
		}(i)
	}
	time.Sleep(100 * time.Millisecond) // let the first request occupy the slot
	close(block)
	wg.Wait()

	ok, rejected := 0, 0
	for _, c := range results {
		switch c {
		case 200:
			ok++
		case 503:
			rejected++
		}
	}
	if ok != 1 || rejected != 1 {
		t.Fatalf("saturation results: %v (want one 200, one 503)", results)
	}
}

func TestCORSAllowed(t *testing.T) {
	h := CORS([]string{"https://desktop.mash.cloud"})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
	}))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodOptions, "/", nil)
	req.Header.Set("Origin", "https://desktop.mash.cloud")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("preflight: %d", rec.Code)
	}
	if rec.Header().Get("Access-Control-Allow-Origin") != "https://desktop.mash.cloud" {
		t.Fatal("origin must be echoed")
	}
}

func TestCORSDisallowed(t *testing.T) {
	h := CORS([]string{"https://desktop.mash.cloud"})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
	}))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Origin", "https://evil.example")
	h.ServeHTTP(rec, req)
	if rec.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("unknown origin must not be allowed")
	}
	if rec.Code != 200 {
		t.Fatalf("non-preflight still serves: %d", rec.Code)
	}
}

// --- Timeout × Recovery composition (2026-09-18 post-mortem audit) -------------

// Timeout spawns the handler on its own goroutine; a recover on the request
// goroutine cannot catch a panic from it. Before the audit fix, a configured
// blanket RequestTimeout silently disabled panic containment process-wide.
// Chain now installs Recovery innermost (running on the handler's goroutine,
// whichever it is) plus outermost (transport shell). These tests pin that.

func TestChainContainsHandlerPanicUnderTimeout(t *testing.T) {
	var h http.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic("handler poison under timeout")
	})
	h = Chain(Options{
		MaxBodyBytes:   1 << 20,
		MaxInFlight:    64,
		AllowedOrigins: nil,
		RequestTimeout: 5 * time.Second,
	}, nil)(h)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	h.ServeHTTP(rec, req) // pre-fix: this call terminates the process

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("panic under timeout must map to 500, got %d", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "poison") {
		t.Fatal("panic detail must not leak to the client")
	}
}

func TestChainTimeoutStillEnforcesBudget(t *testing.T) {
	var h http.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(10 * time.Second):
		}
	})
	h = Chain(Options{
		MaxBodyBytes:   1 << 20,
		MaxInFlight:    64,
		RequestTimeout: 100 * time.Millisecond,
	}, nil)(h)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	start := time.Now()
	h.ServeHTTP(rec, req)
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Fatalf("timeout not enforced: %s", elapsed)
	}
	if rec.Code != http.StatusGatewayTimeout {
		t.Fatalf("slow handler under blanket timeout must 504, got %d", rec.Code)
	}
}
