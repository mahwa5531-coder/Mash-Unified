// phonepe_e2e_fake_test.go — the wire-compatible fake PhonePe PG server
// for the service-level e2e tests.
package payment_test

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

type fakePGServer struct {
	merchant  string
	saltKey   string
	saltIndex string
	url       string
	mu        sync.Mutex
	txns      map[string]fakePGTxnState
	srv       *httptest.Server
}

type fakePGTxnState struct {
	code   string // PAYMENT_SUCCESS | PAYMENT_ERROR | PAYMENT_PENDING
	amount int64
}

func newPhonePeFakeServer(t *testing.T) *fakePGServer {
	f := &fakePGServer{
		merchant: "MERCHANTUAT", saltKey: "e2e-salt-key", saltIndex: "1",
		txns: map[string]fakePGTxnState{},
	}
	mux := http.NewServeMux()

	mux.HandleFunc("POST /pg/v1/pay", func(w http.ResponseWriter, r *http.Request) {
		body := readAll(r)
		if !verifyPG(r, body, string(body)+"/pg/v1/pay"+f.saltKey) {
			w.WriteHeader(401)
			return
		}
		payloadJSON, _ := base64.StdEncoding.DecodeString(string(body))
		var req struct {
			MerchantID          string `json:"merchantId"`
			MerchantTransaction string `json:"merchantTransactionId"`
			Amount              int64  `json:"amount"`
		}
		_ = json.Unmarshal(payloadJSON, &req)
		f.mu.Lock()
		f.txns[req.MerchantTransaction] = fakePGTxnState{code: "PAYMENT_INITIATED", amount: req.Amount}
		f.mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]any{
			"success": true, "code": "PAYMENT_INITIATED", "message": "ok",
			"data": map[string]any{
				"merchantId": req.MerchantID, "merchantTransactionId": req.MerchantTransaction,
				"instrumentResponse": map[string]any{
					"redirectInfo": map[string]any{"url": "https://mercury-till.phonepe.com/transact?token=e2e", "method": "GET"},
				},
			},
		})
	})

	mux.HandleFunc("GET /pg/v1/status/", func(w http.ResponseWriter, r *http.Request) {
		if !verifyPG(r, nil, r.URL.Path+f.saltKey) {
			w.WriteHeader(401)
			return
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		mTxn := r.URL.Path[len("/pg/v1/status/MERCHANTUAT/"):]
		txn, ok := f.txns[mTxn]
		if !ok {
			w.WriteHeader(404)
			_, _ = w.Write([]byte(`{"success":false,"code":"TRANSACTION_NOT_FOUND","message":"no txn"}`))
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"success": txn.code == "PAYMENT_SUCCESS", "code": txn.code, "message": "ok",
			"data": map[string]any{
				"merchantId": f.merchant, "merchantTransactionId": mTxn,
				"transactionId": "T123", "amount": txn.amount,
				"state": map[bool]string{true: "COMPLETED", false: "PENDING"}[txn.code == "PAYMENT_SUCCESS"],
			},
		})
	})

	f.srv = httptest.NewServer(mux)
	t.Cleanup(f.srv.Close)
	f.url = f.srv.URL
	return f
}

func (f *fakePGServer) capture(mTxn string, amount int64) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.txns[mTxn] = fakePGTxnState{code: "PAYMENT_SUCCESS", amount: amount}
}

func (f *fakePGServer) fail(mTxn string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.txns[mTxn] = fakePGTxnState{code: "PAYMENT_ERROR"}
}

// readAll drains a request body (bounded).
func readAll(r *http.Request) []byte {
	b, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	return b
}

// verifyPG checks the X-VERIFY header against sha256Hex(base)+"###"+index.
func verifyPG(r *http.Request, _ []byte, base string) bool {
	want := sha256HexStr(base) + "###" + "1"
	return r.Header.Get("X-VERIFY") == want
}

// sha256HexStr is a local reimplementation (the production one lives in
// the phonepe package; tests deliberately do not import it).
func sha256HexStr(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}
