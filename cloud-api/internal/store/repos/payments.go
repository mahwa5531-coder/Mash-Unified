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

// constraint names → payment package sentinels (migration 000010).
const (
	cnIdempotency = "uq_payment_orders_idempotency"
	cnProviderOrd = "uq_payment_orders_provider_order"
	cnLedger      = "credit_ledger_order_id_kind_key"
)

func mapPgErr(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.ConstraintName {
		case cnIdempotency:
			return payment.ErrOrderExistsIdem
		case cnProviderOrd:
			return payment.ErrOrderExistsProvider
		case cnLedger:
			return payment.ErrOrderExistsIdem // ledger race backstop: treat as already-applied path
		}
	}
	return err
}

// orderCols — the SELECT column list. Nullable text columns are
// COALESCEd to ” because the Go layer represents "absent" as the zero
// string (the write side mirrors this with NULLIF — see CreateOrder).
const orderCols = `id, tenant_id, user_id, provider, provider_order_id,
        COALESCE(provider_payment_id, ''), pack_id, currency, amount_paise, credits, status,
        COALESCE(failure_reason, ''), COALESCE(idempotency_key, ''), COALESCE(request_hash, ''),
        created_at, updated_at, paid_at, expires_at`

func scanOrder(row pgx.Row) (*payment.Order, error) {
	var o payment.Order
	err := row.Scan(&o.ID, &o.TenantID, &o.UserID, &o.Provider, &o.ProviderOrderID, &o.ProviderPaymentID,
		&o.PackID, &o.Currency, &o.AmountPaise, &o.Credits, &o.Status, &o.FailureReason, &o.IdempotencyKey,
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
                        provider_payment_id, pack_id, currency, amount_paise, credits, status,
                        failure_reason, idempotency_key, request_hash, created_at, updated_at, paid_at, expires_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
                        NULLIF($13,''), NULLIF($14,''), $15,$16,$17,$18)`,
		o.ID, o.TenantID, o.UserID, o.Provider, o.ProviderOrderID, o.ProviderPaymentID,
		o.PackID, o.Currency, o.AmountPaise, o.Credits, o.Status, o.FailureReason, o.IdempotencyKey,
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
// a no-op; the ledger UNIQUE(order_id, kind) is the durable backstop that
// makes double-crediting impossible even under a storage-level bug.
func (r *PaymentsRepo) ApplyPaid(ctx context.Context, orderID, providerPaymentID string) (bool, *payment.Order, error) {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return false, nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Serialize on the order row (and read the order's own credits — the
	// caller NEVER passes an amount to credit).
	var (
		tenantID string
		credits  int64
	)
	err = tx.QueryRow(ctx,
		`SELECT tenant_id, credits FROM payment_orders WHERE id = $1 FOR UPDATE`,
		orderID).Scan(&tenantID, &credits)
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

	// Balance read INSIDE the transaction (after the row lock): the
	// balance_after ledger snapshot is consistent with the bump.
	var balanceAfter int64
	err = tx.QueryRow(ctx, `
                INSERT INTO credit_balances (tenant_id, balance)
                VALUES ($1, $2)
                ON CONFLICT (tenant_id) DO UPDATE
                   SET balance = credit_balances.balance + EXCLUDED.balance,
                       updated_at = now()
                RETURNING balance`, tenantID, credits).Scan(&balanceAfter)
	if err != nil {
		return false, nil, err
	}

	if _, err := tx.Exec(ctx, `
                INSERT INTO credit_ledger (id, tenant_id, order_id, kind, credits, balance_after)
                VALUES ($1, $2, $3, 'topup', $4, $5)`,
		ids.New("led"), tenantID, orderID, credits, balanceAfter); err != nil {
		return false, nil, mapPgErr(err) // cnLedger → already applied race
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

// Balance returns the tenant's credit balance (0 when never topped up).
func (r *PaymentsRepo) Balance(ctx context.Context, tenantID string) (*payment.Balance, error) {
	b := &payment.Balance{TenantID: tenantID}
	err := r.Pool.QueryRow(ctx, `SELECT balance FROM credit_balances WHERE tenant_id = $1`, tenantID).
		Scan(&b.Balance)
	if errors.Is(err, pgx.ErrNoRows) {
		return b, nil
	}
	if err != nil {
		return nil, err
	}
	// Last top-up metadata (left join: balance may exist without ledger
	// rows only in pathological states; treat as zero top-ups).
	_ = r.Pool.QueryRow(ctx, `
                SELECT credits, created_at FROM credit_ledger
                 WHERE tenant_id = $1 AND kind = 'topup'
                 ORDER BY created_at DESC LIMIT 1`, tenantID).Scan(&b.LastTopupAmount, &b.LastTopupAt)
	return b, nil
}

// Ledger returns the tenant's ledger entries newest-first (bounded).
func (r *PaymentsRepo) Ledger(ctx context.Context, tenantID string, limit int) ([]*payment.LedgerEntry, error) {
	rows, err := r.Pool.Query(ctx, `
                SELECT id, tenant_id, order_id, kind, credits, balance_after, created_at
                  FROM credit_ledger WHERE tenant_id = $1
                 ORDER BY created_at DESC LIMIT $2`, tenantID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*payment.LedgerEntry
	for rows.Next() {
		var e payment.LedgerEntry
		if err := rows.Scan(&e.ID, &e.TenantID, &e.OrderID, &e.Kind, &e.Credits, &e.BalanceAfter, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, &e)
	}
	return out, rows.Err()
}
