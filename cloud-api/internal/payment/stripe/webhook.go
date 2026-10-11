package stripe

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"

	"github.com/mash-cloud/mash-api/internal/payment"
)

// webhook.go — the Stripe webhook envelope. Stripe POSTs one event type
// per delivery; the two this module acts on:
//
//	payment_intent.succeeded  → payment.captured (money moved)
//	payment_intent.payment_failed → payment.failed
//
// Everything else is parsed for the event id only and recorded (ack, no
// state change — refunds/reversals are a v2 concern).

// eventDTO is Stripe's event envelope.
type eventDTO struct {
	ID       string `json:"id"` // evt_…
	Type     string `json:"type"`
	Livemode bool   `json:"livemode"`
	Data     struct {
		Object json.RawMessage `json:"object"`
	} `json:"data"`
}

// ParseWebhook implements payment.Provider.
func (c *Client) ParseWebhook(body []byte) (*payment.WebhookEvent, error) {
	var ev eventDTO
	if err := json.Unmarshal(body, &ev); err != nil {
		return nil, err
	}
	if ev.ID == "" || ev.Type == "" {
		return nil, fmt.Errorf("stripe: webhook envelope missing id/type")
	}

	out := &payment.WebhookEvent{
		EventID:  ev.ID,
		Provider: c.Name(),
		Type:     mapEventType(ev.Type),
		Raw:      body,
	}

	switch out.Type {
	case payment.EventPaymentCaptured, payment.EventPaymentFailed:
		var pi paymentIntentDTO
		if err := json.Unmarshal(ev.Data.Object, &pi); err != nil || pi.ID == "" {
			// Signed but unparseable: record-only shape (type stays mapped;
			// empty provider ids make it a no-op downstream).
			return out, nil
		}
		out.ProviderOrderID = pi.ID
		out.ProviderPaymentID = pi.ID // intent plays both roles
		out.Status = mapChargeStatus(pi.Status)
		out.AmountPaise = pi.Amount
		out.Captured = pi.Status == "succeeded"
	default:
		// record-only: no provider ids, no state change.
	}
	return out, nil
}

// mapEventType translates Stripe event names onto this module's vocabulary.
func mapEventType(t string) string {
	switch t {
	case "payment_intent.succeeded":
		return payment.EventPaymentCaptured
	case "payment_intent.payment_failed":
		return payment.EventPaymentFailed
	default:
		return t // recorded verbatim, acted on never
	}
}

// synthesizedEventID builds a deterministic id from a raw body — used by
// tests (and any path that must dedupe on payload identity).
func synthesizedEventID(raw []byte) string {
	h := sha256.Sum256(raw)
	return "evt_" + hex.EncodeToString(h[:16])
}
