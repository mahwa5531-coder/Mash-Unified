// Package stripe implements payment.Provider against the Stripe REST API
// (https://api.stripe.com/v1). It owns exactly the wire concerns: Bearer
// authentication, x-www-form-urlencoded writes, GET-only retries, error
// classification and the Stripe-Signature webhook scheme. Domain logic
// never lives here — the payment package owns all money decisions.
package stripe

// DefaultBaseURL — override (NEXAU_STRIPE_API_BASE) exists for tests and
// proxied deployments only.
const DefaultBaseURL = "https://api.stripe.com/v1"

// paymentIntentDTO is the /payment_intents wire shape (create + fetch).
// A PaymentIntent is BOTH the order and the payment in Stripe's model —
// there is no separate order resource.
type paymentIntentDTO struct {
	ID             string `json:"id"` // pi_…
	ClientSecret   string `json:"client_secret"`
	Amount         int64  `json:"amount"` // smallest currency unit (paise)
	Currency       string `json:"currency"`
	Status         string `json:"status"` // requires_payment_method | requires_confirmation | processing | requires_capture | canceled | succeeded
	LastPaymentErr *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"last_payment_error"`
}

// chargeDTO is one element of the /charges list (reconcile: the charge
// carries the captured truth for an intent).
type chargeDTO struct {
	ID       string `json:"id"` // ch_…
	IntentID string `json:"payment_intent"`
	Amount   int64  `json:"amount"`
	Currency string `json:"currency"`
	Status   string `json:"status"` // succeeded | failed | pending | ...
	Captured bool   `json:"captured"`
	Method   string `json:"payment_method"`
}

// chargesListDTO is the list envelope.
type chargesListDTO struct {
	Object  string      `json:"object"`
	Data    []chargeDTO `json:"data"`
	HasMore bool        `json:"has_more"`
}

// errorDTO is Stripe's error envelope:
//
//	{"error":{"type":"card_error","code":"...","message":"...","param":"..."}}
type errorDTO struct {
	Error struct {
		Type    string `json:"type"`
		Code    string `json:"code"`
		Message string `json:"message"`
		Param   string `json:"param"`
	} `json:"error"`
}

// mapIntentStatus translates Stripe's PaymentIntent status vocabulary onto
// the shared provider order vocabulary. Succeeded is the ONLY paid state;
// canceled maps to failed; everything else is an in-flight attempt.
func mapIntentStatus(s string) string {
	switch s {
	case "succeeded":
		return "paid"
	case "canceled":
		return "failed"
	case "processing", "requires_capture", "requires_confirmation",
		"requires_payment_method", "requires_action":
		return "attempted"
	default:
		return "created"
	}
}

// mapChargeStatus translates a charge status onto the shared payment
// vocabulary (captured-first: a refunded charge WAS captured).
func mapChargeStatus(s string) string {
	switch s {
	case "succeeded", "refunded", "partially_refunded":
		return "captured"
	case "failed":
		return "failed"
	default:
		return "pending"
	}
}
