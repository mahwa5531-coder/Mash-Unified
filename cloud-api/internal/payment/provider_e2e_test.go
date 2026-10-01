// provider_e2e_test.go — scenario: the full service wired to the REAL
// razorpay.Client against a wire-compatible fake Razorpay server (proves
// the provider seam: checkout → confirm → signed webhook → duplicate
// delivery, all exactly-once).
package payment_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/payment"
	"github.com/nexau-cloud/nexau-api/internal/payment/razorpay"
)

func TestService_WithRazorpayClientAgainstFakeServer(t *testing.T) {
	fake := newFakeRazorpayServer(t)
	client := razorpay.New(razorpay.Config{
		KeyID: fake.keyID, KeySecret: fake.secret, WebhookSecret: "wh_fake",
		BaseURL: fake.url,
	})
	store := newFakeStore()
	svc := payment.New(payment.Config{
		Store: store, Provider: client, Catalog: mustCatalog(t),
		OrderTTL: time.Minute, SweepInterval: time.Hour, HistoryLimit: 10,
	})

	pack := firstPack(t)
	o, err := svc.Checkout(context.Background(), tenantA, userA, pack.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	if o.Provider != "razorpay" || o.ProviderOrderID == "" {
		t.Fatalf("order not through razorpay client: %+v", o)
	}

	// Complete at the "provider", then confirm through the real client
	// path (signature + FetchPayment).
	payID := fake.captureOrder(o.ProviderOrderID, pack.AmountPaise)
	sig := client.SignCheckoutPair(o.ProviderOrderID, payID)
	confirmed, err := svc.Confirm(context.Background(), tenantA, o.ProviderOrderID, payID, sig)
	if err != nil {
		t.Fatal(err)
	}
	if confirmed.Status != payment.StatusPaid {
		t.Fatalf("status = %s", confirmed.Status)
	}

	// Webhook through the REAL razorpay ParseWebhook + VerifyWebhookSignature
	// path, signed with the client's webhook secret — arriving AFTER the
	// confirm already paid the order (the normal ordering in production).
	body := payment.BuildWebhookBody("evt_rzp_1", payment.EventPaymentCaptured, o.ProviderOrderID, payID, pack.AmountPaise)
	whSig := client.SignWebhookBody(body)
	if err := svc.HandleWebhook(context.Background(), body, whSig, "127.0.0.1"); err != nil {
		t.Fatalf("signed webhook rejected: %v", err)
	}
	// Duplicate delivery (Razorpay retries): acknowledged, still one credit.
	if err := svc.HandleWebhook(context.Background(), body, whSig, "127.0.0.1"); err != nil {
		t.Fatalf("duplicate webhook delivery rejected: %v", err)
	}
	// Forged signature against the real client: fail closed.
	if err := svc.HandleWebhook(context.Background(), body, "forged", "127.0.0.1"); err == nil {
		t.Fatal("forged webhook accepted through razorpay client")
	}
	if n := store.ledgerCountForOrder(o.ID); n != 1 {
		t.Fatalf("ledger entries = %d, want exactly 1 (confirm + webhook + duplicate)", n)
	}
	b, _ := store.Balance(context.Background(), tenantA)
	if b.Balance != pack.Credits {
		t.Fatalf("balance = %d, want exactly %d", b.Balance, pack.Credits)
	}
}

// fakeRZP — a wire-compatible fake Razorpay server for the service-level
// test (the razorpay package's own client_test.go has its own transport-level
// fake; test fakes are deliberately not shared across packages).
type fakeRZP struct {
	keyID, secret, url string
	orders             map[string]fakeOrder
	payments           map[string]payment.ProviderPayment
	mu                 sync.Mutex
	seq                int
}

type fakeOrder struct {
	id     string
	amount int64
	status string
}

func newFakeRazorpayServer(t *testing.T) *fakeRZP {
	f := &fakeRZP{keyID: "rzp_test_SVC", secret: "svc_secret", orders: map[string]fakeOrder{}, payments: map[string]payment.ProviderPayment{}}
	mux := http.NewServeMux()
	auth := func(w http.ResponseWriter, r *http.Request) bool {
		id, pw, _ := r.BasicAuth()
		if id != f.keyID || pw != f.secret {
			w.WriteHeader(401)
			return false
		}
		return true
	}
	mux.HandleFunc("POST /orders", func(w http.ResponseWriter, r *http.Request) {
		if !auth(w, r) {
			return
		}
		var req struct {
			Amount   int64  `json:"amount"`
			Currency string `json:"currency"`
			Receipt  string `json:"receipt"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		f.mu.Lock()
		f.seq++
		oid := fmt.Sprintf("order_SVC_%08d", f.seq)
		f.orders[oid] = fakeOrder{id: oid, amount: req.Amount, status: "created"}
		f.mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]any{"id": oid, "amount": req.Amount, "currency": req.Currency, "status": "created"})
	})
	mux.HandleFunc("GET /orders/", func(w http.ResponseWriter, r *http.Request) {
		if !auth(w, r) {
			return
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		o, ok := f.orders[r.URL.Path[len("/orders/"):]]
		if !ok {
			w.WriteHeader(404)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": o.id, "amount": o.amount, "currency": "INR", "status": o.status})
	})
	mux.HandleFunc("GET /payments/", func(w http.ResponseWriter, r *http.Request) {
		if !auth(w, r) {
			return
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		p, ok := f.payments[r.URL.Path[len("/payments/"):]]
		if !ok {
			w.WriteHeader(404)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": p.ID, "order_id": p.OrderID, "amount": p.AmountPaise,
			"currency": "INR", "status": p.Status, "method": p.Method, "captured": p.Captured,
		})
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	f.url = srv.URL
	return f
}

func (f *fakeRZP) captureOrder(orderID string, amount int64) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.seq++
	payID := fmt.Sprintf("pay_SVC_%08d", f.seq)
	o := f.orders[orderID]
	o.status = "paid"
	f.orders[orderID] = o
	f.payments[payID] = payment.ProviderPayment{
		ID: payID, OrderID: orderID, Status: "captured",
		AmountPaise: amount, Currency: "INR", Captured: true, Method: "card",
	}
	return payID
}
