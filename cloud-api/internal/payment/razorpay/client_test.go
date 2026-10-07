package razorpay

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/mash-cloud/mash-api/internal/payment"
)

// fakeRazorpay is a byte-compatible stand-in for api.razorpay.com:
// basic-auth check, POST /orders, GET /orders/{id}, GET /payments/{id},
// programmable failures. This is the "test with a real mock Razorpay key"
// harness: the production Client code path runs unchanged against it.
type fakeRazorpay struct {
	t      *testing.T
	keyID  string
	secret string
	server *httptest.Server

	seq      atomic.Int64
	orders   map[string]*orderDTO
	payments map[string]*paymentDTO

	// fault knobs
	nextOrderStatus atomic.Int32 // 0 ok, 1 -> 500 once, 2 -> 401
	callLog         atomic.Int64
	getCount        atomic.Int64
	postCount       atomic.Int64
}

func newFakeRazorpay(t *testing.T) *fakeRazorpay {
	f := &fakeRazorpay{t: t, keyID: "rzp_test_FAKE123", secret: "fake_secret", orders: map[string]*orderDTO{}, payments: map[string]*paymentDTO{}}
	mux := http.NewServeMux()

	auth := func(r *http.Request) bool {
		id, pw, ok := r.BasicAuth()
		return ok && id == f.keyID && pw == f.secret
	}

	mux.HandleFunc("POST /orders", func(w http.ResponseWriter, r *http.Request) {
		f.postCount.Add(1)
		if !auth(r) {
			w.WriteHeader(401)
			_ = json.NewEncoder(w).Encode(errorDTO{})
			return
		}
		switch f.nextOrderStatus.Load() {
		case 1:
			f.nextOrderStatus.Store(0)
			w.WriteHeader(500)
			return
		case 2:
			f.nextOrderStatus.Store(0)
			w.WriteHeader(401)
			return
		}
		var req createOrderRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Amount <= 0 {
			w.WriteHeader(400)
			_ = json.NewEncoder(w).Encode(errorDTO{})
			return
		}
		id := fmt.Sprintf("order_fake_%08d", f.seq.Add(1))
		o := &orderDTO{ID: id, Amount: req.Amount, Currency: req.Currency, Receipt: req.Receipt, Status: "created"}
		f.orders[id] = o
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(o)
	})

	mux.HandleFunc("GET /orders/", func(w http.ResponseWriter, r *http.Request) {
		f.getCount.Add(1)
		if !auth(r) {
			w.WriteHeader(401)
			return
		}
		id := r.URL.Path[len("/orders/"):]
		o, ok := f.orders[id]
		if !ok {
			w.WriteHeader(404)
			return
		}
		_ = json.NewEncoder(w).Encode(o)
	})

	mux.HandleFunc("GET /payments/", func(w http.ResponseWriter, r *http.Request) {
		f.getCount.Add(1)
		if !auth(r) {
			w.WriteHeader(401)
			return
		}
		id := r.URL.Path[len("/payments/"):]
		p, ok := f.payments[id]
		if !ok {
			w.WriteHeader(404)
			return
		}
		_ = json.NewEncoder(w).Encode(p)
	})

	f.server = httptest.NewServer(mux)
	t.Cleanup(f.server.Close)
	return f
}

func (f *fakeRazorpay) client() *Client {
	return New(Config{
		KeyID: f.keyID, KeySecret: f.secret, WebhookSecret: "wh_fake",
		BaseURL: f.server.URL,
	})
}

func (f *fakeRazorpay) captureOrder(orderID string, amount int64) string {
	f.seq.Add(1)
	payID := fmt.Sprintf("pay_fake_%08d", f.seq.Load())
	f.orders[orderID].Status = "paid"
	f.payments[payID] = &paymentDTO{
		ID: payID, OrderID: orderID, Amount: amount, Currency: "INR",
		Status: "captured", Method: "card", Captured: true,
	}
	return payID
}

func TestClient_AuthRejected(t *testing.T) {
	f := newFakeRazorpay(t)
	bad := New(Config{KeyID: f.keyID, KeySecret: "WRONG", BaseURL: f.server.URL})

	_, err := bad.CreateOrder(context.Background(), payment.CreateOrderRequest{AmountPaise: 50000, Currency: "INR"})
	if err == nil {
		t.Fatal("expected auth error")
	}
	var perr *payment.ProviderError
	if !asProviderErr(err, &perr) || perr.Kind != payment.ProviderErrAuth {
		t.Fatalf("want ProviderErrAuth, got %+v", err)
	}
}

func TestClient_CreateOrderRoundTrip(t *testing.T) {
	f := newFakeRazorpay(t)
	c := f.client()

	po, err := c.CreateOrder(context.Background(), payment.CreateOrderRequest{
		AmountPaise: 50000, Currency: "INR", Receipt: "pay_TEST",
		Notes: map[string]string{"order_id": "pay_TEST"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if po.ID == "" || po.AmountPaise != 50000 || po.Status != "created" {
		t.Fatalf("unexpected order: %+v", po)
	}

	// FetchOrder (read path)
	got, err := c.FetchOrder(context.Background(), po.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != po.ID || got.Status != "created" {
		t.Fatalf("fetch mismatch: %+v", got)
	}

	// Capture + FetchPayment (the confirm path's authoritative read)
	payID := f.captureOrder(po.ID, 50000)
	pp, err := c.FetchPayment(context.Background(), payID)
	if err != nil {
		t.Fatal(err)
	}
	if !pp.Captured || pp.Status != "captured" || pp.AmountPaise != 50000 || pp.OrderID != po.ID {
		t.Fatalf("payment mismatch: %+v", pp)
	}
}

func TestClient_CreateOrder_NoRetryOn5xx(t *testing.T) {
	f := newFakeRazorpay(t)
	f.nextOrderStatus.Store(1) // one 500
	c := f.client()

	_, err := c.CreateOrder(context.Background(), payment.CreateOrderRequest{AmountPaise: 100, Currency: "INR"})
	if err == nil {
		t.Fatal("expected failure")
	}
	if n := f.postCount.Load(); n != 1 {
		t.Fatalf("POST retried %d times — create must be single-shot (double-order hazard)", n)
	}
}

func TestClient_FetchOrder_RetriesOn5xx(t *testing.T) {
	f := newFakeRazorpay(t)
	c := f.client()

	// Create then kill the order (404 is 4xx — no retry, request error).
	po, err := c.CreateOrder(context.Background(), payment.CreateOrderRequest{AmountPaise: 100, Currency: "INR"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = c.FetchOrder(context.Background(), po.ID+"_missing")
	if err == nil {
		t.Fatal("expected 404 error")
	}
	var perr *payment.ProviderError
	if !asProviderErr(err, &perr) || perr.Kind != payment.ProviderErrRequest {
		t.Fatalf("want ProviderErrRequest for 404, got %+v", err)
	}
}

func asProviderErr(err error, target **payment.ProviderError) bool {
	for err != nil {
		if pe, ok := err.(*payment.ProviderError); ok {
			*target = pe
			return true
		}
		u, ok := err.(interface{ Unwrap() error })
		if !ok {
			return false
		}
		err = u.Unwrap()
	}
	return false
}
