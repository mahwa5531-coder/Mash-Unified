// Package payment implements the prepaid credit top-up flow (Razorpay):
// checkout, client-handshake confirmation, signed webhooks, reconciliation,
// and an append-only credit ledger with per-tenant balances.
//
// # Architecture (docs/PAYMENT-GATEWAY.md)
//
//	api ──► payment.Service ──► Provider (interface: razorpay.Client | MockProvider)
//	             │
//	             └──────────► Store (interface: repos.Payments | test fakes)
//
// The package owns exactly two seams — Provider (money transmission) and
// Store (persistence) — both defined here, implemented elsewhere. Wire DTOs
// never cross the razorpay/ boundary; persistence details never cross
// repos/.
//
// # Invariants (enforced jointly by service guards and SQL, see apply.go)
//
//   - Credits apply EXACTLY ONCE per order (row lock + status guard +
//     UNIQUE(order_id, kind) on the ledger).
//   - "paid" is absorbing: no later event can regress a paid order.
//   - Money is integer paise, INR only; floats never appear on this path.
//   - The webhook route authenticates by HMAC over the raw body — it is the
//     only unauthenticated route this package mounts.
package payment

import "time"

// Order statuses (state machine: docs/PAYMENT-GATEWAY.md §4).
const (
	StatusPending   = "pending"   // created at provider, no payment attempt yet
	StatusAttempted = "attempted" // a payment attempt exists (may still fail)
	StatusPaid      = "paid"      // CAPTURED — absorbing terminal state
	StatusFailed    = "failed"    // terminal (superseded only by a later capture)
	StatusExpired   = "expired"   // TTL elapsed without capture (a late capture still wins)
)

// Payment providers known to the service (mock exists for dev + tests).
const (
	ProviderRazorpay = "razorpay"
	ProviderMock     = "mock"
)

// Order is a single purchasable top-up: one local row, one provider order.
// Amounts are integer paise; credits are snapshotted at creation so catalog
// edits never mutate in-flight orders.
type Order struct {
	ID                string
	TenantID          string
	UserID            string
	Provider          string
	ProviderOrderID   string
	ProviderPaymentID string
	PackID            string
	Currency          string
	AmountPaise       int64
	Credits           int64
	Status            string
	FailureReason     string
	IdempotencyKey    string
	RequestHash       string
	CreatedAt         time.Time
	UpdatedAt         time.Time
	PaidAt            *time.Time
	ExpiresAt         time.Time
}

// ClientView is the JSON shape returned by the API layer (no secrets).
type ClientView struct {
	OrderID           string     `json:"order_id"`
	ProviderOrderID   string     `json:"provider_order_id"`
	ProviderPaymentID string     `json:"provider_payment_id,omitempty"`
	Provider          string     `json:"provider"`
	PackID            string     `json:"pack_id"`
	Currency          string     `json:"currency"`
	AmountPaise       int64      `json:"amount_paise"`
	Credits           int64      `json:"credits"`
	Status            string     `json:"status"`
	FailureReason     string     `json:"failure_reason,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
	PaidAt            *time.Time `json:"paid_at,omitempty"`
	ExpiresAt         time.Time  `json:"expires_at"`
}

// ClientViewOf projects the order for API responses.
func (o *Order) ClientViewOf() ClientView {
	return ClientView{
		OrderID: o.ID, ProviderOrderID: o.ProviderOrderID, ProviderPaymentID: o.ProviderPaymentID,
		Provider: o.Provider,
		PackID:   o.PackID, Currency: o.Currency, AmountPaise: o.AmountPaise,
		Credits: o.Credits, Status: o.Status, FailureReason: o.FailureReason,
		CreatedAt: o.CreatedAt, PaidAt: o.PaidAt, ExpiresAt: o.ExpiresAt,
	}
}

// Terminal reports whether the status is final (no further transitions
// except the paid-absorbing rule: paid can still be entered, never left).
//
// The transition RULES themselves live in exactly one place outside this
// file: the SQL WHERE guards of migration 000010 (mirrored by the test
// fakeStore). There is deliberately no parallel in-memory state-machine
// validator in production code — the store is the single authority:
//
//	pending   → attempted, paid, failed, expired
//	attempted → paid, failed, expired
//	paid      → (absorbing: nothing leaves)
//	failed    → paid (late capture beats failure — money arrived)
//	expired   → paid (late capture beats expiry)
func Terminal(status string) bool {
	switch status {
	case StatusPaid, StatusFailed, StatusExpired:
		return true
	}
	return false
}

// LedgerEntry is one append-only credit mutation. v1 writes only kind=topup;
// the enum reserves adjustment (manual ops) and refund (v2 reversal).
type LedgerEntry struct {
	ID           string
	TenantID     string
	OrderID      string
	Kind         string
	Credits      int64
	BalanceAfter int64
	CreatedAt    time.Time
}

// Ledger kinds.
const (
	LedgerTopup      = "topup"
	LedgerAdjustment = "adjustment"
	LedgerRefund     = "refund"
)

// Balance is the tenant's credit position + last top-up metadata.
type Balance struct {
	TenantID        string     `json:"tenant_id"`
	Balance         int64      `json:"balance"`
	LastTopupAt     *time.Time `json:"last_topup_at,omitempty"`
	LastTopupAmount int64      `json:"last_topup_credits,omitempty"`
}

// WebhookEvent is a normalized provider event (already signature-verified
// by the Provider before the service sees it).
type WebhookEvent struct {
	EventID  string
	Provider string
	Type     string // payment.captured, payment.failed, order.paid, ...
	// ProviderOrderID / ProviderPaymentID resolve the affected order; both
	// are empty for events this module does not map (record-only).
	ProviderOrderID   string
	ProviderPaymentID string
	// LocalOrderID is the resolved pay_ id (service fills this before
	// recording the event; "" = unknown/orphan order).
	LocalOrderID string
	Status       string // normalized provider payment status when present
	AmountPaise  int64  // when present (order events) — cross-checked on apply
	Captured     bool
	Raw          []byte // original body (audit; never logged wholesale)
}

// Webhook event types this module acts on. Everything else is recorded and
// acknowledged without state change (refund reversal is v2 — §8 of design).
const (
	EventPaymentCaptured = "payment.captured"
	EventPaymentFailed   = "payment.failed"
	EventOrderPaid       = "order.paid"
)

// Handled reports whether the event type drives the state machine.
func (e *WebhookEvent) Handled() bool {
	switch e.Type {
	case EventPaymentCaptured, EventPaymentFailed, EventOrderPaid:
		return true
	}
	return false
}
