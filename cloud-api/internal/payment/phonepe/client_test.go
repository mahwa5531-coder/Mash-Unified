package phonepe

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/mash-cloud/mash-api/internal/payment"
)

// client_test.go — the wire transport against a fake PhonePe PG v1 server:
// X-VERIFY enforced SERVER-side, payload contract, bad salt → auth class,
// status vocabulary for all codes, TRANSACTION_NOT_FOUND → request class,
// single-shot create on 5xx, GET retry through 5xx.

type fakePG struct {
	mu        sync.Mutex
	merchant  string
	saltKey   string
	saltIndex string
	payCount  int
	failPay   int // 500 the first N /pay POSTs
	failStat  int // 500 the first N status GETs
	txns      map[string]fakePGTxn
	t         *testing.T
}

type fakePGTxn struct {
	code   string // PAYMENT_SUCCESS | PAYMENT_ERROR | PAYMENT_PENDING | PAYMENT_INITIATED
	amount int64
}

func newFakePG(t *testing.T) *fakePG {
	return &fakePG{
		merchant: "MERCHANTUAT", saltKey: "fake-salt-key", saltIndex: "1",
		txns: map[string]fakePGTxn{}, t: t,
	}
}

// capture flips a transaction to PAYMENT_SUCCESS (test lifecycle control).
func (f *fakePG) capture(mTxn string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if txn, ok := f.txns[mTxn]; ok {
		txn.code = "PAYMENT_SUCCESS"
		f.txns[mTxn] = txn
	}
}

func (f *fakePG) handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("POST /pg/v1/pay", func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		// Server-side X-VERIFY: base = base64(payload)+path+saltKey.
		want := sha256Hex(string(body)+"/pg/v1/pay"+f.saltKey) + "###" + f.saltIndex
		if r.Header.Get("X-VERIFY") != want {
			w.WriteHeader(401)
			_, _ = w.Write([]byte(`{"success":false,"code":"AUTHORIZATION_FAILED","message":"bad X-VERIFY"}`))
			return
		}
		f.mu.Lock()
		f.payCount++
		failPay := f.failPay
		if f.failPay > 0 {
			f.failPay--
		}
		f.mu.Unlock()
		if failPay > 0 {
			w.WriteHeader(500)
			_, _ = w.Write([]byte(`{"success":false,"code":"INTERNAL_ERR","message":"boom"}`))
			return
		}
		payloadJSON, err := base64.StdEncoding.DecodeString(string(body))
		if err != nil {
			w.WriteHeader(400)
			return
		}
		var req payRequest
		if err := json.Unmarshal(payloadJSON, &req); err != nil {
			w.WriteHeader(400)
			return
		}
		f.mu.Lock()
		f.txns[req.MerchantTransaction] = fakePGTxn{code: "PAYMENT_INITIATED", amount: req.Amount}
		f.mu.Unlock()
		_ = json.NewEncoder(w).Encode(pgResponse{
			Success: true, Code: "PAYMENT_INITIATED", Message: "Successful",
			Data: mustJSON(map[string]any{
				"merchantId": req.MerchantID, "merchantTransactionId": req.MerchantTransaction,
				"instrumentResponse": map[string]any{
					"redirectInfo": map[string]any{"url": "https://mercury-till.phonepe.com/transact?token=tok", "method": "GET"},
				},
			}),
		})
	})

	mux.HandleFunc("GET /pg/v1/status/", func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "")
		_ = path
		full := r.URL.Path
		// Server-side X-VERIFY: base = request path + saltKey.
		want := sha256Hex(full+f.saltKey) + "###" + f.saltIndex
		if r.Header.Get("X-VERIFY") != want {
			w.WriteHeader(401)
			_, _ = w.Write([]byte(`{"success":false,"code":"AUTHORIZATION_FAILED","message":"bad X-VERIFY"}`))
			return
		}
		f.mu.Lock()
		failStat := f.failStat
		if f.failStat > 0 {
			f.failStat--
		}
		f.mu.Unlock()
		if failStat > 0 {
			w.WriteHeader(500)
			_, _ = w.Write([]byte(`{"success":false,"code":"INTERNAL_ERR","message":"boom"}`))
			return
		}
		parts := strings.Split(strings.TrimPrefix(full, "/pg/v1/status/"), "/")
		if len(parts) != 2 || parts[0] != f.merchant {
			w.WriteHeader(404)
			_, _ = w.Write([]byte(`{"success":false,"code":"TRANSACTION_NOT_FOUND","message":"no such transaction"}`))
			return
		}
		f.mu.Lock()
		txn, ok := f.txns[parts[1]]
		f.mu.Unlock()
		if !ok {
			w.WriteHeader(404)
			_, _ = w.Write([]byte(`{"success":false,"code":"TRANSACTION_NOT_FOUND","message":"no such transaction"}`))
			return
		}
		_ = json.NewEncoder(w).Encode(pgResponse{
			Success: txn.code == "PAYMENT_SUCCESS", Code: txn.code, Message: "ok",
			Data: mustJSON(map[string]any{
				"merchantId": f.merchant, "merchantTransactionId": parts[1],
				"transactionId": "T" + strconv.Itoa(len(parts[1])), "amount": txn.amount,
				"state": map[bool]string{true: "COMPLETED", false: "PENDING"}[txn.code == "PAYMENT_SUCCESS"],
			}),
		})
	})
	return mux
}

func mustJSON(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}

func newPGClient(t *testing.T, fake *fakePG) *Client {
	t.Helper()
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	return New(Config{
		MerchantID: fake.merchant, SaltKey: fake.saltKey, SaltIndex: fake.saltIndex,
		RedirectURL: "https://app.example.com/return", RedirectMode: "REDIRECT",
		CallbackURL: "https://api.example.com/v1/payments/webhook",
		BaseURL:     srv.URL,
	})
}

func TestClient_CreateOrder_PayloadAndHandles(t *testing.T) {
	fake := newFakePG(t)
	c := newPGClient(t, fake)

	po, err := c.CreateOrder(context.Background(), payment.CreateOrderRequest{
		AmountPaise: 199900, Currency: "INR", Receipt: "pay_01JDXYZ",
		Notes: map[string]string{"tenant_id": "ten_1"},
	})
	if err != nil {
		t.Fatal(err)
	}
	// merchantTransactionId = deterministic translation of the receipt.
	if po.ID != "PAY-01JDXYZ" {
		t.Fatalf("mTxn = %s, want PAY-01JDXYZ", po.ID)
	}
	// Hosted PAY_PAGE url relayed.
	if !strings.Contains(po.CheckoutURL, "mercury-till.phonepe.com") {
		t.Fatalf("checkout url missing: %+v", po)
	}
	if po.ClientSecret != "" {
		t.Fatal("phonepe orders carry no client secret")
	}
	// The fake REGISTERED the transaction (payload contract round-trip).
	fake.mu.Lock()
	txn, ok := fake.txns["PAY-01JDXYZ"]
	fake.mu.Unlock()
	if !ok || txn.amount != 199900 {
		t.Fatalf("transaction not registered server-side: %+v", txn)
	}
}

func TestClient_BadSalt_AuthClass(t *testing.T) {
	fake := newFakePG(t)
	c := newPGClient(t, fake)
	c.saltKey = "WRONG-SALT" // simulate credential mismatch
	_, err := c.CreateOrder(context.Background(), payment.CreateOrderRequest{
		AmountPaise: 100, Currency: "INR", Receipt: "pay_01ABC",
	})
	if err == nil {
		t.Fatal("bad salt accepted")
	}
	pe, ok := err.(*payment.ProviderError)
	if !ok || pe.Kind != payment.ProviderErrAuth {
		t.Fatalf("expected auth class, got %+v", err)
	}
}

func TestClient_StatusVocabulary(t *testing.T) {
	fake := newFakePG(t)
	c := newPGClient(t, fake)

	// Create three transactions in distinct states.
	for _, tc := range []struct {
		receipt string
		code    string
	}{
		{"pay_01S", "PAYMENT_SUCCESS"},
		{"pay_01E", "PAYMENT_ERROR"},
		{"pay_01P", "PAYMENT_PENDING"},
	} {
		po, err := c.CreateOrder(context.Background(), payment.CreateOrderRequest{
			AmountPaise: 100, Currency: "INR", Receipt: tc.receipt,
		})
		if err != nil {
			t.Fatal(err)
		}
		fake.mu.Lock()
		txn := fake.txns[po.ID]
		txn.code = tc.code
		fake.txns[po.ID] = txn
		fake.mu.Unlock()
	}

	// SUCCESS → paid order + captured payment.
	if po, err := c.FetchOrder(context.Background(), "PAY-01S"); err != nil || po.Status != "paid" {
		t.Fatalf("success order = %+v err=%v", po, err)
	}
	if p, err := c.FetchPayment(context.Background(), "PAY-01S"); err != nil || !p.Captured || p.Status != "captured" {
		t.Fatalf("success payment = %+v err=%v", p, err)
	}
	// ERROR → failed.
	if po, err := c.FetchOrder(context.Background(), "PAY-01E"); err != nil || po.Status != "failed" {
		t.Fatalf("error order = %+v err=%v", po, err)
	}
	// PENDING → attempted order / pending payment.
	if po, err := c.FetchOrder(context.Background(), "PAY-01P"); err != nil || po.Status != "attempted" {
		t.Fatalf("pending order = %+v err=%v", po, err)
	}
	if p, err := c.FetchPayment(context.Background(), "PAY-01P"); err != nil || p.Captured {
		t.Fatalf("pending payment = %+v err=%v", p, err)
	}
}

func TestClient_TransactionNotFound_RequestClass(t *testing.T) {
	fake := newFakePG(t)
	c := newPGClient(t, fake)
	_, err := c.FetchOrder(context.Background(), "PAY-GHOST")
	if err == nil {
		t.Fatal("unknown transaction accepted")
	}
	pe, ok := err.(*payment.ProviderError)
	if !ok || pe.Kind != payment.ProviderErrRequest {
		t.Fatalf("expected request class for 404, got %+v", err)
	}
}

func TestClient_CreateOrder_SingleShotOn5xx(t *testing.T) {
	fake := newFakePG(t)
	fake.mu.Lock()
	fake.failPay = 2 // 500 on the first POST
	fake.mu.Unlock()
	c := newPGClient(t, fake)

	if _, err := c.CreateOrder(context.Background(), payment.CreateOrderRequest{
		AmountPaise: 100, Currency: "INR", Receipt: "pay_01F",
	}); err == nil {
		t.Fatal("5xx create accepted")
	}
	fake.mu.Lock()
	creates := fake.payCount
	fake.mu.Unlock()
	if creates != 1 {
		t.Fatalf("create retried automatically: %d attempts, want exactly 1 (single-shot — no idempotency key upstream)", creates)
	}
}

func TestClient_StatusGet_RetriesThrough5xx(t *testing.T) {
	fake := newFakePG(t)
	c := newPGClient(t, fake)

	po, err := c.CreateOrder(context.Background(), payment.CreateOrderRequest{
		AmountPaise: 100, Currency: "INR", Receipt: "pay_01R",
	})
	if err != nil {
		t.Fatal(err)
	}
	fake.capture(po.ID)

	// The first status GET 500s; the retry budget must carry it through.
	fake.mu.Lock()
	fake.failStat = 1
	fake.mu.Unlock()
	got, err := c.FetchOrder(context.Background(), po.ID)
	if err != nil {
		t.Fatalf("status GET did not retry through 5xx: %v", err)
	}
	if got.Status != "paid" {
		t.Fatalf("status = %s", got.Status)
	}
}
