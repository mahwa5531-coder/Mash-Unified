// Package payment implements the plan-purchase flow (plans only — no
// individual credits are sold): checkout, client-handshake confirmation,
// signed webhooks, reconciliation, and subscription activation with
// stacking renewal periods.
//
// # Commerce model (docs/MODELS-AND-PRICING.md §4)
//
// The ONLY purchasable thing is a PLAN PERIOD (a SKU): e.g. Pro monthly
// (₹1,999 / 30 days) or Pro annual (₹19,999 / 365 days). A captured order
// activates or extends the tenant's subscription in the SAME transaction
// that marks the order paid — no credits, no wallet, no balance. Free is
// the default state of every tenant (enforced by the identity resolver's
// free-plan fallback, identity.go), never something you buy.
//
// # Architecture (docs/PAYMENT-GATEWAY.md)
//
//	api ──► payment.Service ──► Provider (interface: razorpay.Client |
//	                             stripe.Client | phonepe.Client | MockProvider)
//	             │
//	             └──────────► Store (interface: repos.Payments | test fakes)
//
// The package owns exactly two seams — Provider (money transmission) and
// Store (persistence) — both defined here, implemented elsewhere. Wire DTOs
// never cross the provider boundaries; persistence details never cross
// repos/.
//
// # Invariants (enforced jointly by service guards and SQL, see apply.go)
//
//   - A paid order activates the subscription EXACTLY ONCE (row lock +
//     status guard; renewal extension happens in the same transaction).
//   - "paid" is absorbing: no later event can regress a paid order.
//   - Renewals stack: paid_through = GREATEST(now, paid_through) + period.
//   - Money is integer paise, INR only; floats never appear on this path.
//   - The webhook route authenticates by provider signature over the raw
//     body — it is the only unauthenticated route this package mounts.
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
// Exactly one is active per deployment (NEXAU_PAYMENT_PROVIDER).
const (
	ProviderRazorpay = "razorpay"
	ProviderStripe   = "stripe"
	ProviderPhonepe  = "phonepe"
	ProviderMock     = "mock"
)

// Order is a single plan purchase: one local row, one provider order.
// Amounts are integer paise; plan_code + period_days are snapshotted at
// creation so catalog edits never mutate in-flight orders.
type Order struct {
	ID                   string
	TenantID             string
	UserID               string
	Provider             string
	ProviderOrderID      string
	ProviderPaymentID    string
	ProviderClientSecret string // stripe: browser handle (public by design)
	ProviderCheckoutURL  string // phonepe: hosted PAY_PAGE url (public by design)
	SKUID                string // catalog SKU id ("plan_pro_1m")
	PlanCode             string // snapshot: plans.code the purchase activates
	PeriodDays           int    // snapshot: days the activation extends
	Currency             string
	AmountPaise          int64
	Status               string
	FailureReason        string
	IdempotencyKey       string
	RequestHash          string
	CreatedAt            time.Time
	UpdatedAt            time.Time
	PaidAt               *time.Time
	ExpiresAt            time.Time
}

// ClientView is the JSON shape returned by the API layer (no secrets).
type ClientView struct {
	OrderID           string     `json:"order_id"`
	ProviderOrderID   string     `json:"provider_order_id"`
	ProviderPaymentID string     `json:"provider_payment_id,omitempty"`
	Provider          string     `json:"provider"`
	SKUID             string     `json:"sku_id"`
	PlanCode          string     `json:"plan_code"`
	PeriodDays        int        `json:"period_days"`
	Currency          string     `json:"currency"`
	AmountPaise       int64      `json:"amount_paise"`
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
		SKUID:    o.SKUID, PlanCode: o.PlanCode, PeriodDays: o.PeriodDays,
		Currency: o.Currency, AmountPaise: o.AmountPaise,
		Status: o.Status, FailureReason: o.FailureReason,
		CreatedAt: o.CreatedAt, PaidAt: o.PaidAt, ExpiresAt: o.ExpiresAt,
	}
}

// Terminal reports whether the status is final (no further transitions
// except the paid-absorbing rule: paid can still be entered, never left).
//
// The transition RULES themselves live in exactly one place outside this
// file: the SQL WHERE guards of the payment_orders table (mirrored by the
// test fakeStore). There is deliberately no parallel in-memory state-machine
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
	default:
		return false
	}
}

// SubscriptionState is the tenant's entitlement position — what a plan
// purchase buys and what expiry means. Replaces the retired credit
// balance: the "wallet" IS the subscription's paid-through date.
type SubscriptionState struct {
	TenantID         string     `json:"tenant_id"`
	PlanCode         string     `json:"plan_code"` // "" = no active row → free default
	PlanName         string     `json:"plan_name"`
	Status           string     `json:"status"` // active | trialing | past_due | none
	CurrentPeriodEnd *time.Time `json:"current_period_end,omitempty"`
	DaysRemaining    int        `json:"days_remaining"` // 0 when none; rounded down
}

// Subscription status vocabulary (mirrors the DB CHECK constraint).
const (
	SubNone     = "none" // no effective row — the free-plan default
	SubActive   = "active"
	SubTrialing = "trialing"
	SubPastDue  = "past_due"
)

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
	default:
		return false
	}
}
