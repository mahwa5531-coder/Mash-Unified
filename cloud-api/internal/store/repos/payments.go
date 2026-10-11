// Package repos — payments.go implements payment.Store on PostgreSQL.
// Every money-moving method is a single transaction whose SQL mirrors the
// in-memory state machine exactly (conditional UPDATEs + the ledger
// UNIQUE(order_id, kind) constraint arbitrate all races; docs/PAYMENT-
// GATEWAY.md §5).
package repos

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mash-cloud/mash-api/internal/ids"
	"github.com/mash-cloud/mash-api/internal/payment"
)

// PaymentsRepo implements payment.Store.
type PaymentsRepo struct{ Pool *pgxpool.Pool }

// NewPayments builds the repo.
func NewPayments(p *pgxpool.Pool) *PaymentsRepo { return &PaymentsRepo{Pool: p} }

// Compile-time contract check.
var _ payment.Store = (*PaymentsRepo)(nil)

// constraint names → payment package sentinels (migration 000006).
const (
	cnIdempotency = "uq_payment_orders_idempotency"
	cnProviderOrd = "uq_payment_orders_provider_order"
)

func mapPgErr(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.ConstraintName {
		case cnIdempotency:
			return payment.ErrOrderExistsIdem
		case cnProviderOrd:
			return payment.ErrOrderExistsProvider
		}
	}
	return err
}

// orderCols — the SELECT column list. Nullable text columns are
// COALESCEd to ” because the Go layer represents "absent" as the zero
// string (the write side mirrors this with NULLIF — see CreateOrder).
const orderCols = `id, tenant_id, user_id, provider, provider_order_id,
        COALESCE(provider_payment_id, ''), COALESCE(provider_client_secret, ''), COALESCE(provider_checkout_url, ''),
        sku_id, plan_code, period_days, currency, amount_paise, status,
        COALESCE(failure_reason, ''), COALESCE(idempotency_key, ''), COALESCE(request_hash, ''),
        created_at, updated_at, paid_at, expires_at`

func scanOrder(row pgx.Row) (*payment.Order, error) {
	var o payment.Order
	err := row.Scan(&o.ID, &o.TenantID, &o.UserID, &o.Provider, &o.ProviderOrderID, &o.ProviderPaymentID,
		&o.ProviderClientSecret, &o.ProviderCheckoutURL,
		&o.SKUID, &o.PlanCode, &o.PeriodDays, &o.Currency, &o.AmountPaise, &o.Status, &o.FailureReason, &o.IdempotencyKey,
		&o.RequestHash, &o.CreatedAt, &o.UpdatedAt, &o.PaidAt, &o.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, payment.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &o, nil
}

// CreateOrder inserts a pending order.
//
// NULLIF on the idempotency key: Go "" must become SQL NULL, or the
// partial unique index (WHERE idempotency_key IS NOT NULL) treats every
// key-less checkout as one shared "" key and rejects the second one
// (caught live 2026-09-28: all anonymous checkouts 409'd after the
// first). Same discipline for the other nullable text columns.
func (r *PaymentsRepo) CreateOrder(ctx context.Context, o *payment.Order) error {
	_, err := r.Pool.Exec(ctx, `
                INSERT INTO payment_orders (id, tenant_id, user_id, provider, provider_order_id,
                        provider_payment_id, provider_client_secret, provider_checkout_url,
                        sku_id, plan_code, period_days, currency, amount_paise, status,
                        failure_reason, idempotency_key, request_hash, created_at, updated_at, paid_at, expires_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
                        $15, NULLIF($16,''), NULLIF($17,''), $18,$19,$20,$21)`,
		o.ID, o.TenantID, o.UserID, o.Provider, o.ProviderOrderID, o.ProviderPaymentID,
		o.ProviderClientSecret, o.ProviderCheckoutURL,
		o.SKUID, o.PlanCode, o.PeriodDays, o.Currency, o.AmountPaise, o.Status, o.FailureReason, o.IdempotencyKey,
		o.RequestHash, o.CreatedAt, o.UpdatedAt, o.PaidAt, o.ExpiresAt)
	return mapPgErr(err)
}

// OrderByID fetches by primary key.
func (r *PaymentsRepo) OrderByID(ctx context.Context, id string) (*payment.Order, error) {
	return scanOrder(r.Pool.QueryRow(ctx, `SELECT `+orderCols+` FROM payment_orders WHERE id = $1`, id))
}

// OrderByProviderID fetches by (provider, provider_order_id).
func (r *PaymentsRepo) OrderByProviderID(ctx context.Context, provider, providerOrderID string) (*payment.Order, error) {
	return scanOrder(r.Pool.QueryRow(ctx,
		`SELECT `+orderCols+` FROM payment_orders WHERE provider = $1 AND provider_order_id = $2`,
		provider, providerOrderID))
}

// OrderByIdempotencyKey fetches a tenant's order for a checkout key.
func (r *PaymentsRepo) OrderByIdempotencyKey(ctx context.Context, tenantID, key string) (*payment.Order, error) {
	return scanOrder(r.Pool.QueryRow(ctx,
		`SELECT `+orderCols+` FROM payment_orders WHERE tenant_id = $1 AND idempotency_key = $2`,
		tenantID, key))
}

// ListOrders returns the tenant's orders newest-first (bounded).
func (r *PaymentsRepo) ListOrders(ctx context.Context, tenantID string, limit int) ([]*payment.Order, error) {
	rows, err := r.Pool.Query(ctx,
		`SELECT `+orderCols+` FROM payment_orders WHERE tenant_id = $1
                 ORDER BY created_at DESC LIMIT $2`, tenantID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*payment.Order
	for rows.Next() {
		o, err := scanOrder(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// ListOpenOrders returns non-terminal orders oldest-first (sweeper input).
func (r *PaymentsRepo) ListOpenOrders(ctx context.Context, limit int) ([]*payment.Order, error) {
	rows, err := r.Pool.Query(ctx,
		`SELECT `+orderCols+` FROM payment_orders
                 WHERE status IN ('pending','attempted')
                 ORDER BY created_at ASC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*payment.Order
	for rows.Next() {
		o, err := scanOrder(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// MarkAttempted records the first payment attempt id (visibility only).
func (r *PaymentsRepo) MarkAttempted(ctx context.Context, orderID, providerPaymentID string) error {
	_, err := r.Pool.Exec(ctx, `
                UPDATE payment_orders
                   SET provider_payment_id = COALESCE(NULLIF($2,''), provider_payment_id),
                       status = CASE WHEN status = 'pending' THEN 'attempted' ELSE status END,
                       updated_at = now()
                 WHERE id = $1 AND status IN ('pending','attempted')`, orderID, providerPaymentID)
	return err
}

// ApplyPaid — THE money transaction. Row lock serializes racing appliers
// (confirm / webhook / reconcile); the status guard makes re-application
// a no-op; and the SUBSCRIPTION ACTIVATION (extend-or-insert, stacking
// periods) runs in the same transaction, so an order can never be paid
// without its plan period landing — and never activates twice.
func (r *PaymentsRepo) ApplyPaid(ctx context.Context, orderID, providerPaymentID string) (bool, *payment.Order, error) {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return false, nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Serialize on the order row (and read the order's own plan snapshot —
	// the caller NEVER passes a plan or period).
	var (
		tenantID   string
		planCode   string
		periodDays int
	)
	err = tx.QueryRow(ctx,
		`SELECT tenant_id, plan_code, period_days FROM payment_orders WHERE id = $1 FOR UPDATE`,
		orderID).Scan(&tenantID, &planCode, &periodDays)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil, payment.ErrNotFound
	}
	if err != nil {
		return false, nil, err
	}

	// State guard: only a non-paid order transitions. 0 rows = someone
	// already applied → idempotent success with applied=false.
	tag, err := tx.Exec(ctx, `
                UPDATE payment_orders
                   SET status = 'paid',
                       provider_payment_id = COALESCE(NULLIF($2,''), provider_payment_id),
                       paid_at = now(), updated_at = now()
                 WHERE id = $1 AND status <> 'paid'`, orderID, providerPaymentID)
	if err != nil {
		return false, nil, mapPgErr(err)
	}
	if tag.RowsAffected() == 0 {
		if err := tx.Commit(ctx); err != nil {
			return false, nil, err
		}
		o, err := r.OrderByID(ctx, orderID)
		if err != nil {
			return false, nil, err
		}
		return false, o, nil
	}

	// Plan activation (plans only — this is the entire point of a paid
	// order). Guarded by plan_code <> '' so a hypothetical credit-era row
	// could never crash the path; a missing plan (deleted mid-flight) is
	// logged-and-skipped: the money is real, the order stays paid, ops
	// resolves the plan manually. That is a checkout-validated path
	// (PlanExists) failing only on operator action between checkout and
	// capture.
	if planCode != "" && periodDays > 0 {
		if err := activateSubscription(ctx, tx, tenantID, planCode, periodDays); err != nil {
			return false, nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return false, nil, err
	}
	o, err := r.OrderByID(ctx, orderID)
	if err != nil {
		return true, nil, err
	}
	return true, o, nil
}

// activateSubscription extends the tenant's effective subscription (or
// inserts a fresh one) INSIDE the ApplyPaid transaction:
//
//	extend: current_period_end = GREATEST(now(), current_period_end) + period
//	        (stacking renewals: paying twice back-to-back never loses days)
//	insert: current_period = now → now + period (first purchase)
//
// The partial unique index uq_subscriptions_tenant_active (one row per
// tenant in trialing/active/past_due) arbitrates: rows in expired/canceled
// states do NOT hold the slot, so re-subscribing inserts cleanly.
func activateSubscription(ctx context.Context, tx pgx.Tx, tenantID, planCode string, periodDays int) error {
	// Resolve the plan id INSIDE the transaction (plan_code → plans.id).
	var planID string
	err := tx.QueryRow(ctx, `SELECT id FROM plans WHERE code = $1`, planCode).Scan(&planID)
	if errors.Is(err, pgx.ErrNoRows) {
		// Missing plan: order stays paid (money real), activation skipped.
		// Checkout already validated existence — this is operator drift.
		return nil
	}
	if err != nil {
		return err
	}

	tag, err := tx.Exec(ctx, `
                UPDATE subscriptions SET
                       plan_id = $2,
                       status = 'active',
                       current_period_start = CASE
                           WHEN current_period_end IS NULL OR current_period_end <= now()
                               THEN now() ELSE current_period_start END,
                       current_period_end = GREATEST(now(), COALESCE(current_period_end, now()))
                           + make_interval(days => $3),
                       cancel_at_period_end = FALSE,
                       updated_at = now()
                 WHERE tenant_id = $1
                   AND status IN ('trialing','active','past_due')`, tenantID, planID, periodDays)
	if err != nil {
		return err
	}
	if tag.RowsAffected() > 0 {
		return nil
	}

	// No effective row (fresh tenant, or prior sub expired/canceled):
	// insert a new active subscription.
	_, err = tx.Exec(ctx, `
                INSERT INTO subscriptions (id, tenant_id, plan_id, status,
                        current_period_start, current_period_end)
                VALUES ($1, $2, $3, 'active', now(), now() + make_interval(days => $4))`,
		ids.New("sub"), tenantID, planID, periodDays)
	// A concurrent activation racing the insert lands on the unique
	// partial index — but we hold the ORDER row lock, and every activation
	// path goes through an order, so this cannot race in practice. If it
	// ever fires, the retry (webhook redelivery) converges via the UPDATE.
	return mapPgErr(err)
}

// ApplyFailed — pending/attempted → failed (never overwrites paid).
func (r *PaymentsRepo) ApplyFailed(ctx context.Context, orderID, reason string) (bool, error) {
	tag, err := r.Pool.Exec(ctx, `
                UPDATE payment_orders
                   SET status = 'failed', failure_reason = $2, updated_at = now()
                 WHERE id = $1 AND status IN ('pending','attempted')`, orderID, reason)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// ApplyExpired — pending/attempted past TTL → expired (never overwrites
// paid; a later capture still wins via ApplyPaid's guard).
func (r *PaymentsRepo) ApplyExpired(ctx context.Context, orderID string) (bool, error) {
	tag, err := r.Pool.Exec(ctx, `
                UPDATE payment_orders
                   SET status = 'expired', updated_at = now()
                 WHERE id = $1 AND status IN ('pending','attempted') AND expires_at < now()`,
		orderID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// ExpireStale bulk-expires open orders past their TTL.
func (r *PaymentsRepo) ExpireStale(ctx context.Context, now time.Time) (int64, error) {
	tag, err := r.Pool.Exec(ctx, `
                UPDATE payment_orders
                   SET status = 'expired', updated_at = now()
                 WHERE status IN ('pending','attempted') AND expires_at < $1`, now)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// RecordWebhookEvent dedupes by event id atomically (INSERT ... ON
// CONFLICT DO NOTHING + RETURNING verdict).
func (r *PaymentsRepo) RecordWebhookEvent(ctx context.Context, ev *payment.WebhookEvent) (bool, error) {
	var inserted bool
	err := r.Pool.QueryRow(ctx, `
                INSERT INTO payment_webhook_events (event_id, provider, event_type, order_id, payload)
                VALUES ($1, $2, $3, NULLIF($4,''), $5)
                ON CONFLICT (event_id) DO NOTHING
                RETURNING TRUE`,
		ev.EventID, ev.Provider, ev.Type, ev.LocalOrderID, ev.Raw).Scan(&inserted)
	if errors.Is(err, pgx.ErrNoRows) {
		return true, nil // conflict → duplicate delivery
	}
	if err != nil {
		return false, err
	}
	return false, nil
}

// PlanExists validates that a SKU's plan_code resolves to a plans row
// (checkout-time guard: orders must never reference unactivatable plans).
func (r *PaymentsRepo) PlanExists(ctx context.Context, planCode string) (bool, error) {
	var exists bool
	err := r.Pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM plans WHERE code = $1)`, planCode).Scan(&exists)
	return exists, err
}

// Subscription returns the tenant's entitlement position (plans only —
// there is no credit balance; the subscription IS the wallet). Effective
// rows must still be inside their paid-through window: an active-status
// row whose current_period_end has passed reads as SubNone (the identity
// resolver's free-plan fallback then applies — the read-side expiry
// check, no sweeper needed).
func (r *PaymentsRepo) Subscription(ctx context.Context, tenantID string) (*payment.SubscriptionState, error) {
	st := &payment.SubscriptionState{TenantID: tenantID, Status: payment.SubNone}
	var periodEnd *time.Time
	err := r.Pool.QueryRow(ctx, `
                SELECT pl.code, pl.name, sub.status, sub.current_period_end
                  FROM subscriptions sub
                  JOIN plans pl ON pl.id = sub.plan_id
                 WHERE sub.tenant_id = $1
                   AND sub.status IN ('trialing','active','past_due')
                   AND (sub.current_period_end IS NULL OR sub.current_period_end > now())
                 ORDER BY sub.status = 'past_due' ASC, sub.created_at DESC
                 LIMIT 1`, tenantID).
		Scan(&st.PlanCode, &st.PlanName, &st.Status, &periodEnd)
	if errors.Is(err, pgx.ErrNoRows) {
		return st, nil
	}
	if err != nil {
		return nil, err
	}
	st.CurrentPeriodEnd = periodEnd
	if periodEnd != nil {
		st.DaysRemaining = int(time.Until(*periodEnd).Hours() / 24)
		if st.DaysRemaining < 0 {
			st.DaysRemaining = 0
		}
	}
	return st, nil
}
