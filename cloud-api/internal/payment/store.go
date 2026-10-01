package payment

import (
	"context"
	"time"
)

// Store is the ONLY persistence contract. Production implementation:
// internal/store/repos.Payments (PostgreSQL). Validation/tests use
// in-memory fakes that honor the same concurrency semantics (mutex +
// conditional writes emulate the SQL guards).
//
// Concurrency contract (must hold for every implementation):
//
//   - CreateOrder is idempotent-safe: unique (tenant_id, idempotency_key)
//     and (provider, provider_order_id) races return ErrOrderExistsIdem /
//     ErrOrderExistsProvider instead of creating rows.
//   - ApplyPaid / ApplyFailed / ApplyExpired are atomic state transitions.
//     Concurrent calls on one order must serialize exactly as the SQL does
//     (row lock + status guard): exactly one returns applied=true, the rest
//     observe the winner's result with applied=false.
//   - RecordWebhookEvent deduplicates by EventID (second delivery returns
//     duplicate=true, never an error).
type Store interface {
	// CreateOrder inserts a fresh order (pending). Violations of either
	// unique constraint map to ErrOrderExistsIdem / ErrOrderExistsProvider.
	CreateOrder(ctx context.Context, o *Order) error

	// OrderByID / OrderByProviderID / OrderByIdempotencyKey are tenant-
	// scoped lookups (tenantID "" = service-internal, e.g. webhook resolve
	// before the tenant is known — implementation must scope by id alone).
	OrderByID(ctx context.Context, id string) (*Order, error)
	OrderByProviderID(ctx context.Context, provider, providerOrderID string) (*Order, error)
	OrderByIdempotencyKey(ctx context.Context, tenantID, key string) (*Order, error)

	// ListOrders returns the tenant's orders newest-first (bounded).
	ListOrders(ctx context.Context, tenantID string, limit int) ([]*Order, error)

	// MarkAttempted records a payment attempt id (best-effort visibility,
	// never a money-moving transition).
	MarkAttempted(ctx context.Context, orderID, providerPaymentID string) error

	// ApplyPaid moves an order into `paid` and appends the topup ledger
	// entry + balance bump in ONE transaction. Returns applied=false when
	// the order was already paid (idempotent no-op, not an error). The
	// credits are read from the order row itself — callers pass the order
	// id, never a client-supplied amount.
	ApplyPaid(ctx context.Context, orderID, providerPaymentID string) (applied bool, order *Order, err error)

	// ApplyFailed marks failed (only from pending/attempted); applied=false
	// when the order was already terminal (a late failed-after-captured is
	// dropped silently by design).
	ApplyFailed(ctx context.Context, orderID, reason string) (applied bool, err error)

	// ApplyExpired expires a pending/attempted order past its TTL.
	ApplyExpired(ctx context.Context, orderID string) (applied bool, err error)

	// RecordWebhookEvent persists the raw event for audit + dedupe.
	RecordWebhookEvent(ctx context.Context, ev *WebhookEvent) (duplicate bool, err error)

	// Balance returns the tenant's current credit balance (0 when the
	// tenant never topped up).
	Balance(ctx context.Context, tenantID string) (*Balance, error)

	// Ledger returns the tenant's ledger entries newest-first (bounded).
	Ledger(ctx context.Context, tenantID string, limit int) ([]*LedgerEntry, error)

	// ExpireStale sweeps non-terminal orders whose expires_at has passed.
	// Returns the number expired (sweeper calls this periodically).
	ExpireStale(ctx context.Context, now time.Time) (int64, error)

	// ListOpenOrders returns non-terminal orders (bounded; oldest first —
	// the sweeper re-checks these for missed captures).
	ListOpenOrders(ctx context.Context, limit int) ([]*Order, error)
}
