package stripe

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/mash-cloud/mash-api/internal/payment"
)

// client_test.go — the wire transport against a fake Stripe API: auth
// rejection, FORM-disciplined create with Idempotency-Key, status
// vocabulary, single-shot create on 5xx, 404→request class, error detail.

type fakeStripe struct {
	mu       sync.Mutex
	apiKey   string
	intents  map[string]map[string]any
	creates  int
	failNext int // respond 500 the first N POSTs
	t        *testing.T

	lastForm    map[string][]string
	lastHeaders http.Header
}

func newFakeStripe(t *testing.T) *fakeStripe {
	return &fakeStripe{apiKey: "sk_test_FAKE", intents: map[string]map[string]any{}, t: t}
}

func (f *fakeStripe) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/payment_intents", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		f.creates++
		failNext := f.failNext
		if f.failNext > 0 {
			f.failNext--
		}
		f.mu.Unlock()
		if failNext > 0 {
			w.WriteHeader(500)
			_, _ = w.Write([]byte(`{"error":{"type":"api_error","message":"boom"}}`))
			return
		}
		if got := r.Header.Get("Authorization"); got != "Bearer "+f.apiKey {
			w.WriteHeader(401)
			_, _ = w.Write([]byte(`{"error":{"type":"invalid_request_error","message":"bad key"}}`))
			return
		}
		// FORM discipline: writes are x-www-form-urlencoded (NOT JSON).
		if ct := r.Header.Get("Content-Type"); ct != "application/x-www-form-urlencoded" {
			f.t.Errorf("content type = %q, want form-urlencoded", ct)
		}
		_ = r.ParseForm()
		f.mu.Lock()
		id := "pi_FAKE_" + strconv.Itoa(1000+f.creates)
		amount := int64(0)
		if vals, ok := r.PostForm["amount"]; ok && len(vals) > 0 {
			amount, _ = strconv.ParseInt(vals[0], 10, 64)
		}
		intent := map[string]any{
			"id": id, "client_secret": id + "_secret_abc",
			"amount": amount, "currency": "inr",
			"status": "requires_payment_method",
		}
		f.intents[id] = intent
		f.lastForm = map[string][]string(r.PostForm)
		f.lastHeaders = r.Header.Clone()
		f.mu.Unlock()
		_ = json.NewEncoder(w).Encode(intent)
	})
	mux.HandleFunc("GET /v1/payment_intents/", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+f.apiKey {
			w.WriteHeader(401)
			_, _ = w.Write([]byte(`{"error":{"type":"invalid_request_error","message":"bad key"}}`))
			return
		}
		id := strings.TrimPrefix(r.URL.Path, "/v1/payment_intents/")
		f.mu.Lock()
		intent, ok := f.intents[id]
		f.mu.Unlock()
		if !ok {
			w.WriteHeader(404)
			_, _ = w.Write([]byte(`{"error":{"type":"invalid_request_error","message":"No such intent"}}`))
			return
		}
		_ = json.NewEncoder(w).Encode(intent)
	})
	return mux
}

func orderReq(amount int64) payment.CreateOrderRequest {
	return payment.CreateOrderRequest{
		AmountPaise: amount, Currency: "INR", Receipt: "pay_1",
		Notes: map[string]string{"order_id": "pay_1"},
	}
}

func asProviderError(t *testing.T, err error) *payment.ProviderError {
	t.Helper()
	pe, ok := err.(*payment.ProviderError)
	if !ok {
		t.Fatalf("not a provider error: %v", err)
	}
	return pe
}

func TestClient_AuthRejected(t *testing.T) {
	fake := newFakeStripe(t)
	srv := httptest.NewServer(fake.handler())
	defer srv.Close()
	c := New(Config{APIKey: "sk_test_WRONG", WebhookSecret: "whsec_x", BaseURL: srv.URL + "/v1"})
	_, err := c.CreateOrder(context.Background(), orderReq(50000))
	if err == nil {
		t.Fatal("bad key accepted")
	}
	if pe := asProviderError(t, err); pe.Kind != payment.ProviderErrAuth {
		t.Fatalf("expected auth-class error, got kind=%d", pe.Kind)
	}
}

func TestClient_CreateOrder_FormDiscipline(t *testing.T) {
	fake := newFakeStripe(t)
	srv := httptest.NewServer(fake.handler())
	defer srv.Close()
	c := New(Config{APIKey: fake.apiKey, WebhookSecret: "whsec_x", BaseURL: srv.URL + "/v1"})

	po, err := c.CreateOrder(context.Background(), orderReq(199900))
	if err != nil {
		t.Fatal(err)
	}
	if po.ID == "" || po.ClientSecret == "" {
		t.Fatalf("intent fields missing: %+v", po)
	}
	if po.AmountPaise != 199900 {
		t.Fatalf("amount = %d", po.AmountPaise)
	}
	// FORM assertions: amount + metadata + idempotency key.
	fake.mu.Lock()
	defer fake.mu.Unlock()
	if got := fake.lastForm["amount"]; len(got) != 1 || got[0] != "199900" {
		t.Fatalf("form amount = %v", fake.lastForm["amount"])
	}
	if got := fake.lastForm["metadata[order_id]"]; len(got) != 1 || got[0] != "pay_1" {
		t.Fatalf("metadata order_id = %v", fake.lastForm["metadata[order_id]"])
	}
	if got := fake.lastHeaders.Get("Stripe-Idempotency-Key"); got != "pay_1" {
		t.Fatalf("idempotency key = %q, want pay_1 (local order id)", got)
	}
}

func TestClient_StatusVocabulary(t *testing.T) {
	fake := newFakeStripe(t)
	srv := httptest.NewServer(fake.handler())
	defer srv.Close()
	c := New(Config{APIKey: fake.apiKey, WebhookSecret: "whsec_x", BaseURL: srv.URL + "/v1"})

	po, err := c.CreateOrder(context.Background(), orderReq(100))
	if err != nil {
		t.Fatal(err)
	}
	// requires_payment_method → attempted (in-flight attempt vocabulary).
	if po.Status != "attempted" {
		t.Fatalf("status = %q, want attempted", po.Status)
	}
	// Flip the intent to succeeded at the fake, then fetch payment:
	fake.mu.Lock()
	fake.intents[po.ID]["status"] = "succeeded"
	fake.mu.Unlock()
	p, err := c.FetchPayment(context.Background(), po.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !p.Captured || p.Status != "captured" {
		t.Fatalf("payment = %+v, want captured", p)
	}
	if p.OrderID != po.ID {
		t.Fatalf("intent plays both roles: order id = %q", p.OrderID)
	}
}

func TestClient_CreateOrder_SingleShotOn5xx(t *testing.T) {
	fake := newFakeStripe(t)
	fake.mu.Lock()
	fake.failNext = 2 // 500 on the first POST
	fake.mu.Unlock()
	srv := httptest.NewServer(fake.handler())
	defer srv.Close()
	c := New(Config{APIKey: fake.apiKey, WebhookSecret: "whsec_x", BaseURL: srv.URL + "/v1"})

	if _, err := c.CreateOrder(context.Background(), orderReq(100)); err == nil {
		t.Fatal("5xx create accepted")
	}
	fake.mu.Lock()
	creates := fake.creates
	fake.mu.Unlock()
	if creates != 1 {
		t.Fatalf("create retried automatically: %d attempts, want exactly 1 (single-shot)", creates)
	}
}

func TestClient_Get404_RequestClass(t *testing.T) {
	fake := newFakeStripe(t)
	srv := httptest.NewServer(fake.handler())
	defer srv.Close()
	c := New(Config{APIKey: fake.apiKey, WebhookSecret: "whsec_x", BaseURL: srv.URL + "/v1"})

	_, err := c.FetchOrder(context.Background(), "pi_missing")
	if err == nil {
		t.Fatal("missing intent accepted")
	}
	if pe := asProviderError(t, err); pe.Kind != payment.ProviderErrRequest {
		t.Fatalf("expected request-class error for 404, got kind=%d", pe.Kind)
	}
}

func TestClient_ErrorDetail(t *testing.T) {
	fake := newFakeStripe(t)
	srv := httptest.NewServer(fake.handler())
	defer srv.Close()
	c := New(Config{APIKey: "sk_test_WRONG", WebhookSecret: "whsec_x", BaseURL: srv.URL + "/v1"})
	_, err := c.FetchOrder(context.Background(), "pi_x")
	pe := asProviderError(t, err)
	if !strings.Contains(pe.Detail, "bad key") {
		t.Fatalf("error detail lost: %+v", pe)
	}
}
