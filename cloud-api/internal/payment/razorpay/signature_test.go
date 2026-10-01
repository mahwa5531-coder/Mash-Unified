package razorpay

import (
	"testing"
)

// Signature verification tests — known-answer vectors (the HMAC-SHA256
// construction matches Razorpay's documented scheme), tamper detection,
// and fail-closed behavior on unset secrets.

func TestVerifyCheckoutSignature_KnownVector(t *testing.T) {
	c := New(Config{KeyID: "rzp_test_X", KeySecret: "secret123"})
	// Independent known-answer vector (python: hmac.new(b"secret123",
	// b"order_NNN|pay_MMM", hashlib.sha256).hexdigest()).
	const want = "e1a470ec6727d822dedce420dc4f0c7116f8989d410878bc2cbbec07a9da7b31"

	sig := c.SignCheckoutPair("order_NNN", "pay_MMM")
	if sig != want {
		t.Fatalf("signature = %s, want known vector %s", sig, want)
	}
	if !c.VerifyCheckoutSignature("order_NNN", "pay_MMM", want) {
		t.Fatal("valid known-vector signature rejected")
	}
}

func TestVerifyWebhookSignature_KnownVector(t *testing.T) {
	c := New(Config{KeyID: "rzp_test_X", WebhookSecret: "whsec_abc"})
	// Independent vector (python hmac over the exact bytes).
	const want = "73ff7094b086eceb198de37f9118d95565795cc5cac95fda050fce99f222ad44"
	body := []byte(`{"event":"payment.captured","id":"evt_1"}`)

	if sig := c.SignWebhookBody(body); sig != want {
		t.Fatalf("webhook signature = %s, want known vector %s", sig, want)
	}
	if !c.VerifyWebhookSignature(body, want) {
		t.Fatal("valid known-vector webhook signature rejected")
	}
}

func TestVerifyCheckoutSignature_Tamper(t *testing.T) {
	c := New(Config{KeyID: "rzp_test_X", KeySecret: "secret123"})
	sig := c.SignCheckoutPair("order_A", "pay_B")

	cases := []struct{ name, order, payment, signature string }{
		{"wrong order", "order_NOT_A", "pay_B", sig},
		{"wrong payment", "order_A", "pay_NOT_B", sig},
		{"swapped pair", "pay_B", "order_A", sig},
		{"empty sig", "order_A", "pay_B", ""},
		{"garbage sig", "order_A", "pay_B", "0" + sig[1:]}, // 1 hex bit flip
	}
	for _, tc := range cases {
		if c.VerifyCheckoutSignature(tc.order, tc.payment, tc.signature) {
			t.Fatalf("%s: tampered signature ACCEPTED", tc.name)
		}
	}
}

func TestVerifyWebhookSignature_RawBytes(t *testing.T) {
	c := New(Config{KeyID: "rzp_test_X", WebhookSecret: "whsec_abc"})
	body := []byte(`{"event":"payment.captured","id":"evt_1"}`)

	sig := c.SignWebhookBody(body)
	if !c.VerifyWebhookSignature(body, sig) {
		t.Fatal("valid webhook signature rejected")
	}

	// ONE byte of difference must invalidate (raw-bytes discipline).
	if c.VerifyWebhookSignature([]byte(`{"event":"payment.captured","id":"evt_2"}`), sig) {
		t.Fatal("signature verified across different body — raw-bytes contract broken")
	}

	// Whitespace difference must invalidate too (no normalization allowed).
	if c.VerifyWebhookSignature(append(body, ' '), sig) {
		t.Fatal("signature verified across modified body")
	}
}

func TestSignature_FailClosedOnUnsetSecrets(t *testing.T) {
	c := New(Config{KeyID: "rzp_test_X"}) // no secrets configured
	if c.VerifyCheckoutSignature("o", "p", "anything") {
		t.Fatal("checkout verification must fail closed with unset key secret")
	}
	if c.VerifyWebhookSignature([]byte("x"), "anything") {
		t.Fatal("webhook verification must fail closed with unset webhook secret")
	}
}
