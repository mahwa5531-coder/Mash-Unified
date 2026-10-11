// stripe_e2e_fake.go — the wire-compatible fake Stripe API server for the
// service-level e2e tests (internal to the payment test suite; the stripe
// package's own client_test has its own transport-level fake — deliberately
// not shared across packages).
package payment_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

type fakeStripeServer struct {
	apiKey  string
	url     string
	mu      sync.Mutex
	intents map[string]fakeIntent
	srv     *httptest.Server
}

type fakeIntent struct {
	id           string
	amount       int64
	status       string // requires_payment_method | succeeded
	clientSecret string
}

func newStripeFakeServer(t *testing.T) *fakeStripeServer {
	f := &fakeStripeServer{apiKey: "sk_test_E2E", intents: map[string]fakeIntent{}}
	mux := http.NewServeMux()

	mux.HandleFunc("POST /v1/payment_intents", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+f.apiKey {
			w.WriteHeader(401)
			return
		}
		_ = r.ParseForm()
		var amount int64
		if vals, ok := r.PostForm["amount"]; ok && len(vals) > 0 {
			_, _ = fmt.Sscan(vals[0], &amount)
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		id := fmt.Sprintf("pi_E2E_%d", len(f.intents)+1)
		intent := fakeIntent{id: id, amount: amount, status: "requires_payment_method", clientSecret: id + "_secret_e2e"}
		f.intents[id] = intent
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": id, "client_secret": intent.clientSecret,
			"amount": amount, "currency": "inr", "status": intent.status,
		})
	})
	mux.HandleFunc("GET /v1/payment_intents/", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+f.apiKey {
			w.WriteHeader(401)
			return
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		id := r.URL.Path[len("/v1/payment_intents/"):]
		intent, ok := f.intents[id]
		if !ok {
			w.WriteHeader(404)
			_, _ = w.Write([]byte(`{"error":{"type":"invalid_request_error","message":"No such intent"}}`))
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": intent.id, "client_secret": intent.clientSecret,
			"amount": intent.amount, "currency": "inr", "status": intent.status,
		})
	})

	f.srv = httptest.NewServer(mux)
	t.Cleanup(f.srv.Close)
	f.url = f.srv.URL + "/v1"
	return f
}

// succeedIntent flips the intent to succeeded and returns its id (the
// PaymentIntent plays both the order and payment roles).
func (f *fakeStripeServer) succeedIntent(id string) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	if intent, ok := f.intents[id]; ok {
		intent.status = "succeeded"
		f.intents[id] = intent
	}
	return id
}

// buildEvent renders a Stripe-shaped webhook body for a payment_intent event.
func (f *fakeStripeServer) buildEvent(eventID, eventType, intentID string, amount int64) []byte {
	body, _ := json.Marshal(map[string]any{
		"id": eventID, "type": eventType, "livemode": false,
		"data": map[string]any{"object": map[string]any{
			"id": intentID, "amount": amount, "currency": "inr", "status": "succeeded",
		}},
	})
	return body
}
