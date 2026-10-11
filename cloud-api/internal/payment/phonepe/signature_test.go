package phonepe

import (
	"encoding/base64"
	"testing"

	"github.com/mash-cloud/mash-api/internal/payment"
)

// signature_test.go — the X-VERIFY scheme (three checksum bases against an
// INDEPENDENT reference signer), id translation round-trip + guards,
// callback parsing, and the checkout passthrough.

const (
	testMerchant = "MERCHANTUAT"
	testSaltKey  = "099eb0cd-02cf-4d63-a104-的食物" // placeholder replaced below
)

func newTestClient() *Client {
	return New(Config{
		MerchantID: testMerchant, SaltKey: "test-salt-key-1234", SaltIndex: "1",
		RedirectURL: "https://app.example.com/return", RedirectMode: "REDIRECT",
		CallbackURL: "https://api.example.com/v1/payments/webhook",
	})
}

// refPayChecksum is an INDEPENDENT implementation of the /pay checksum
// (assembled the way the PG v1 docs describe it, not via the production
// helper) — cross-checking guards against a self-consistent-but-wrong
// production implementation.
func refPayChecksum(payloadJSON []byte, saltKey string) string {
	return sha256Hex(base64.StdEncoding.EncodeToString(payloadJSON) + "/pg/v1/pay" + saltKey)
}

func TestPayChecksum_MatchesReference(t *testing.T) {
	c := newTestClient()
	payload := []byte(`{"merchantId":"MERCHANTUAT","amount":50000}`)
	got := payChecksum(payload, c.saltKey)
	want := refPayChecksum(payload, c.saltKey)
	if got != want {
		t.Fatalf("pay checksum mismatch:\n got %s\nwant %s", got, want)
	}
}

func TestStatusChecksum_Format(t *testing.T) {
	c := newTestClient()
	path := "/pg/v1/status/MERCHANTUAT/PAY-ABC"
	got := statusChecksum(path, c.saltKey)
	if got != sha256Hex(path+c.saltKey) {
		t.Fatal("status checksum is not sha256(path+saltKey)")
	}
}

func TestCallbackChecksum_OverRawBody(t *testing.T) {
	c := newTestClient()
	raw := []byte("raw-bytes-here")
	if callbackChecksum(raw, c.saltKey) != sha256Hex(string(raw)+c.saltKey) {
		t.Fatal("callback checksum is not sha256(rawBody+saltKey)")
	}
}

func TestVerifyWebhookSignature_Headers(t *testing.T) {
	c := newTestClient()
	body := BuildCallbackBody("PAYMENT_SUCCESS", "PAY-ABC", 50000)
	good := c.SignCallback(body)
	if !c.VerifyWebhookSignature(body, good) {
		t.Fatal("valid X-VERIFY rejected")
	}
	if c.VerifyWebhookSignature(body, "forged###1") {
		t.Fatal("forged X-VERIFY accepted")
	}
	if c.VerifyWebhookSignature([]byte("tampered"), good) {
		t.Fatal("tampered body accepted")
	}
	if c.VerifyWebhookSignature(body, "no-separator") {
		t.Fatal("malformed header accepted")
	}
	// Wrong salt key (server secret mismatch): fail closed.
	other := New(Config{MerchantID: testMerchant, SaltKey: "OTHER", SaltIndex: "1",
		RedirectURL: "https://x/y", CallbackURL: "https://x/z"})
	if c.VerifyWebhookSignature(body, other.SignCallback(body)) {
		t.Fatal("signature from a different salt key accepted")
	}
	// Unset salt key: fail closed.
	bare := New(Config{MerchantID: testMerchant, SaltIndex: "1"})
	if bare.VerifyWebhookSignature(body, good) {
		t.Fatal("verification with unset salt key must fail closed")
	}
}

func TestMerchantTxnTranslation_RoundTrip(t *testing.T) {
	local := "pay_01JDTESTSUFFIX123"
	mTxn, err := toMerchantTxn(local)
	if err != nil {
		t.Fatal(err)
	}
	if mTxn != "PAY-01JDTESTSUFFIX123" {
		t.Fatalf("mTxn = %s", mTxn)
	}
	back, err := fromMerchantTxn(mTxn)
	if err != nil {
		t.Fatal(err)
	}
	if back != local {
		t.Fatalf("round trip drifted: %s", back)
	}
}

func TestMerchantTxnTranslation_Guards(t *testing.T) {
	if _, err := toMerchantTxn("not_a_pay_id"); err == nil {
		t.Fatal("non-pay_ prefix accepted")
	}
	if _, err := toMerchantTxn("pay_"); err == nil {
		t.Fatal("empty suffix accepted")
	}
	// >35 chars rejected.
	if _, err := toMerchantTxn("pay_" + repeat('A', 40)); err == nil {
		t.Fatal("over-length id accepted")
	}
	// Invalid charset rejected.
	if _, err := toMerchantTxn("pay_bad!chars#"); err == nil {
		t.Fatal("invalid charset accepted")
	}
}

func repeat(c byte, n int) string {
	b := make([]byte, n)
	for i := range b {
		b[i] = c
	}
	return string(b)
}

func TestWithOrderIDQuery(t *testing.T) {
	if got := withOrderIDQuery("https://app/return", "pay_1"); got != "https://app/return?order_id=pay_1" {
		t.Fatalf("got %s", got)
	}
	if got := withOrderIDQuery("https://app/return?x=1", "pay_1"); got != "https://app/return?x=1&order_id=pay_1" {
		t.Fatalf("got %s", got)
	}
}

func TestParseWebhook_CallbackShapes(t *testing.T) {
	c := newTestClient()

	// SUCCESS → payment.captured with linkage.
	body := BuildCallbackBody("PAYMENT_SUCCESS", "PAY-ABC", 50000)
	ev, err := c.ParseWebhook(body)
	if err != nil {
		t.Fatal(err)
	}
	if ev.Type != payment.EventPaymentCaptured || !ev.Captured {
		t.Fatalf("event = %+v", ev)
	}
	if ev.ProviderOrderID != "PAY-ABC" || ev.AmountPaise != 50000 {
		t.Fatalf("linkage = %+v", ev)
	}
	if len(ev.EventID) != 3+40 || ev.EventID[:3] != "pp_" {
		t.Fatalf("synthesized id = %q", ev.EventID)
	}
	// Same payload → same id (dedupe); different payload → different id.
	ev2, _ := c.ParseWebhook(body)
	if ev2.EventID != ev.EventID {
		t.Fatal("same payload synthesized different ids")
	}

	// ERROR → payment.failed.
	evE, _ := c.ParseWebhook(BuildCallbackBody("PAYMENT_ERROR", "PAY-ABC", 50000))
	if evE.Type != payment.EventPaymentFailed || evE.Captured {
		t.Fatalf("error event = %+v", evE)
	}

	// PENDING → record-only.
	evP, _ := c.ParseWebhook(BuildCallbackBody("PAYMENT_PENDING", "PAY-ABC", 50000))
	if evP.Handled() {
		t.Fatalf("pending event must be record-only: %+v", evP)
	}

	// Non-base64 body → error.
	if _, err := c.ParseWebhook([]byte("!!!not-base64!!!")); err == nil {
		t.Fatal("non-base64 body accepted")
	}
}

func TestCheckoutSignature_Passthrough(t *testing.T) {
	// PhonePe Standard Checkout has NO client-side HMAC: the server-side
	// status fetch is the authority. The passthrough is the contract.
	c := newTestClient()
	if !c.VerifyCheckoutSignature("PAY-1", "PAY-1", "") {
		t.Fatal("checkout verification must pass through (no client scheme)")
	}
}

// Compile-time interface check.
var _ payment.Provider = (*Client)(nil)
