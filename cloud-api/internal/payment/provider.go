package payment

import (
	"context"
	"fmt"
	"time"
)

// Provider is the ONLY money-transmission contract in this module. Production
// implementation: internal/payment/razorpay. MockProvider (mock.go) serves
// development and tests. Nothing else may talk to a payment network.
type Provider interface {
	// Name matches the `provider` column (ProviderRazorpay / ProviderMock).
	Name() string

	// PublicKeyID is the browser-safe key id (Razorpay Checkout.js
	// needs it; public by design, never a secret).
	PublicKeyID() string

	// CreateOrder registers the purchasable amount at the provider and
	// returns the provider-issued order id. It must be single-shot: no
	// automatic retries (a timed-out create may have succeeded upstream —
	// see razorpay/client.go for the reasoning).
	CreateOrder(ctx context.Context, req CreateOrderRequest) (*ProviderOrder, error)

	// FetchOrder reads the provider-side order state (safe to retry).
	FetchOrder(ctx context.Context, providerOrderID string) (*ProviderOrder, error)

	// FetchPayment reads a payment attempt (safe to retry). Used by the
	// confirm path: the client handshake proves existence, the fetch proves
	// status=captured and the amount matches.
	FetchPayment(ctx context.Context, providerPaymentID string) (*ProviderPayment, error)

	// FetchOrderPayments lists the payment attempts against an order
	// (safe to retry). Used by reconciliation: an order the provider
	// reports as paid, whose payment id we never learned (missed
	// webhook), is completed WITH its payment id for the audit trail.
	FetchOrderPayments(ctx context.Context, providerOrderID string) ([]*ProviderPayment, error)

	// VerifyCheckoutSignature checks HMAC(orderID|paymentID, key_secret).
	VerifyCheckoutSignature(orderID, paymentID, signature string) bool

	// VerifyWebhookSignature checks HMAC(rawBody, webhook_secret) in
	// constant time. Providers without webhook support (mock in strict
	// mode) return false.
	VerifyWebhookSignature(body []byte, signature string) bool

	// ParseWebhook normalizes a (already signature-verified) raw event
	// body into the domain event. Provider envelope shapes differ — this
	// is where each provider translates its own wire format.
	ParseWebhook(body []byte) (*WebhookEvent, error)
}

// ProviderError is the typed failure surface of Provider implementations.
// The service maps it (checkout.go mapProviderError) onto client-safe
// domain errors; implementations put operator-useful detail in Err while
// Kind decides the client-facing class.
type ProviderError struct {
	Kind   ProviderErrKind
	HTTP   int
	Err    error
	Detail string
}

// ProviderErrKind classifies provider failures.
type ProviderErrKind int

const (
	// ProviderErrAuth — 401/403: credentials rejected (operator problem).
	ProviderErrAuth ProviderErrKind = iota
	// ProviderErrRequest — other 4xx: request-side contract problem.
	ProviderErrRequest
	// ProviderErrUnavailable — 5xx / network / timeout: retryable later.
	ProviderErrUnavailable
)

func (e *ProviderError) Error() string {
	if e.Err != nil {
		return "payment provider: " + e.Err.Error()
	}
	return "payment provider: kind=" + fmt.Sprint(int(e.Kind)) + " " + e.Detail
}

func (e *ProviderError) Unwrap() error { return e.Err }

// CreateOrderRequest — the provider needs amounts and a correlatable
// receipt; notes carry only support-correlation ids (design §13: no PII).
type CreateOrderRequest struct {
	AmountPaise int64
	Currency    string
	Receipt     string // local order id (pay_...)
	Notes       map[string]string
}

// ProviderOrder is the provider-side view of an order.
type ProviderOrder struct {
	ID          string
	Status      string // provider vocabulary: created | paid | attempted
	AmountPaise int64
	Currency    string
}

// ProviderPayment is a single payment attempt against an order.
type ProviderPayment struct {
	ID          string
	OrderID     string
	Status      string // captured | failed | refunded | ...
	AmountPaise int64
	Currency    string
	Captured    bool
	Method      string // card | upi | netbanking | wallet | ...
	CreatedAt   time.Time
}

// NormalizeOrderStatus maps provider vocabulary onto the local state
// machine (razorpay: created|attempted|paid).
func NormalizeOrderStatus(providerStatus string) string {
	switch providerStatus {
	case "paid":
		return StatusPaid
	case "attempted":
		return StatusAttempted
	default:
		return StatusPending
	}
}

// NormalizePaymentStatus maps a payment attempt status onto the local
// machine. A refunded payment was captured first — it maps to paid (the
// refund reversal is a ledger v2 concern, not an order state change).
func NormalizePaymentStatus(providerStatus string) string {
	switch providerStatus {
	case "captured", "refunded", "partially_refunded":
		return StatusPaid
	case "failed":
		return StatusFailed
	default:
		return StatusAttempted // authorized, pending, etc.: attempt seen
	}
}
