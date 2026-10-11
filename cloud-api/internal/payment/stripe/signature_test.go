package stripe

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/mash-cloud/mash-api/internal/payment"
)

// signature_test.go — the Stripe-Signature scheme: valid/wrong-secret/
// tampered/stale/future/malformed/rotation/unset-secret/checkout
// passthrough/parse mapping/record-only.

const testWhsec = "whsec_test_secret"

func newSigClient() *Client {
	return New(Config{
		APIKey: "sk_test_x", PublishableKey: "pk_test_x",
		WebhookSecret: testWhsec,
	})
}

func TestWebhookSignature_Valid(t *testing.T) {
	c := newSigClient()
	body := []byte(`{"id":"evt_1","type":"payment_intent.succeeded"}`)
	sig := c.SignWebhookBody(body, time.Now())
	if !c.VerifyWebhookSignature(body, sig) {
		t.Fatal("valid signature rejected")
	}
}

func TestWebhookSignature_WrongSecret(t *testing.T) {
	c := newSigClient()
	other := New(Config{APIKey: "sk_test_x", WebhookSecret: "whsec_OTHER"})
	body := []byte(`{"id":"evt_1","type":"x"}`)
	sig := other.SignWebhookBody(body, time.Now())
	if c.VerifyWebhookSignature(body, sig) {
		t.Fatal("signature from a different secret accepted")
	}
}

func TestWebhookSignature_TamperedBody(t *testing.T) {
	c := newSigClient()
	sig := c.SignWebhookBody([]byte(`{"amount":500}`), time.Now())
	if c.VerifyWebhookSignature([]byte(`{"amount":50000}`), sig) {
		t.Fatal("tampered body accepted")
	}
}

func TestWebhookSignature_Stale_ReplayDefense(t *testing.T) {
	c := newSigClient()
	body := []byte(`{"id":"evt_1"}`)
	sig := c.SignWebhookBody(body, time.Now().Add(-10*time.Minute)) // > 5m tolerance
	if c.VerifyWebhookSignature(body, sig) {
		t.Fatal("stale signature (replay) accepted")
	}
}

func TestWebhookSignature_FutureTimestamp(t *testing.T) {
	c := newSigClient()
	body := []byte(`{"id":"evt_1"}`)
	sig := c.SignWebhookBody(body, time.Now().Add(10*time.Minute))
	if c.VerifyWebhookSignature(body, sig) {
		t.Fatal("future timestamp accepted")
	}
}

func TestWebhookSignature_MalformedHeaders(t *testing.T) {
	c := newSigClient()
	body := []byte(`{"id":"evt_1"}`)
	_ = c.SignWebhookBody(body, time.Now())
	for _, bad := range []string{"", "garbage", "t=abc,v1=zz", "v1=only", "t=123"} {
		if c.VerifyWebhookSignature(body, bad) {
			t.Fatalf("malformed header accepted: %q", bad)
		}
	}
}

func TestWebhookSignature_Rotation_MultiV1(t *testing.T) {
	c := newSigClient()
	body := []byte(`{"id":"evt_1"}`)
	now := time.Now()
	newSecret := New(Config{APIKey: "sk", WebhookSecret: "whsec_NEW"})
	oldSig := c.SignWebhookBody(body, now)
	newSig := newSecret.SignWebhookBody(body, now)
	// During rotation the header may carry BOTH signatures; either may win.
	combined := oldSig + "," + newSig
	if !c.VerifyWebhookSignature(body, combined) {
		t.Fatal("rotated multi-v1 header rejected (old still valid)")
	}
	if !newSecret.VerifyWebhookSignature(body, combined) {
		t.Fatal("rotated multi-v1 header rejected (new valid)")
	}
}

func TestWebhookSignature_UnsetSecret_FailClosed(t *testing.T) {
	c := New(Config{APIKey: "sk_test_x"}) // no webhook secret
	body := []byte(`{"id":"evt_1"}`)
	sig := newSigClient().SignWebhookBody(body, time.Now())
	if c.VerifyWebhookSignature(body, sig) {
		t.Fatal("verification with unset secret must fail closed")
	}
}

func TestCheckoutSignature_Passthrough(t *testing.T) {
	// Stripe has NO client-side checkout HMAC: the confirm-path intent
	// fetch is the authority. The passthrough is the contract.
	c := newSigClient()
	if !c.VerifyCheckoutSignature("pi_x", "pi_x", "") {
		t.Fatal("checkout verification must pass through (no client scheme)")
	}
	if !c.VerifyCheckoutSignature("", "", "anything") {
		t.Fatal("checkout verification must pass through unconditionally")
	}
}

func TestParseWebhook_EventMapping(t *testing.T) {
	c := newSigClient()
	cases := []struct {
		wireType string
		wantType string
	}{
		{"payment_intent.succeeded", payment.EventPaymentCaptured},
		{"payment_intent.payment_failed", payment.EventPaymentFailed},
		{"charge.refunded", "charge.refunded"}, // record-only: verbatim
	}
	for _, tc := range cases {
		body, _ := json.Marshal(map[string]any{
			"id": "evt_" + tc.wireType, "type": tc.wireType,
			"data": map[string]any{"object": map[string]any{
				"id": "pi_123", "amount": 50000, "status": "succeeded",
			}},
		})
		ev, err := c.ParseWebhook(body)
		if err != nil {
			t.Fatalf("%s: %v", tc.wireType, err)
		}
		if ev.Type != tc.wantType {
			t.Fatalf("type = %s, want %s", ev.Type, tc.wantType)
		}
	}
}

func TestParseWebhook_RecordOnlyShape(t *testing.T) {
	c := newSigClient()
	body := []byte(`{"id":"evt_x","type":"charge.updated","data":{"object":{"id":"ch_1"}}}`)
	ev, err := c.ParseWebhook(body)
	if err != nil {
		t.Fatal(err)
	}
	if ev.Handled() {
		t.Fatal("unmapped event type must not be handled")
	}
	if ev.ProviderOrderID != "" || ev.AmountPaise != 0 {
		t.Fatalf("record-only event leaked linkage: %+v", ev)
	}
}
