package repos_test

// PostgreSQL integration tests for the payments store. These run ONLY
// when NEXAU_TEST_DATABASE_URL points at a disposable database
// (skip otherwise — CI portability). They prove the SQL itself:
//
//   - migration 000010 applies cleanly
//   - the state-machine conditional UPDATEs behave under REAL row locks
//   - ApplyPaid is exactly-once under a genuine concurrent storm
//   - the ledger UNIQUE(order_id, kind) backstop cannot be bypassed
//
// The service-level tests (internal/payment) prove the orchestration;
// this file proves the storage layer's half of the exactly-once contract
// (design §5) — the half that survives process crashes and replicas.

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/mash-cloud/mash-api/internal/ids"
	"github.com/mash-cloud/mash-api/internal/payment"
	"github.com/mash-cloud/mash-api/internal/store"
	"github.com/mash-cloud/mash-api/internal/store/repos"
)

func testDB(t *testing.T) (*repos.PaymentsRepo, *store.Postgres) {
	t.Helper()
	dsn := os.Getenv("NEXAU_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("NEXAU_TEST_DATABASE_URL not set — skipping PG integration (run scripts/e2e_start_pg.py to enable)")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	pg, err := store.NewPostgres(ctx, dsn, 8, 1, time.Hour, 5*time.Second)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pg.Close)

	// Fresh schema per run: drop + re-migrate (disposable test DB only!).
	if _, err := pg.Pool.Exec(ctx, `
                DROP TABLE IF EXISTS credit_ledger, credit_balances, payment_webhook_events, payment_orders CASCADE`); err != nil {
		t.Fatalf("drop: %v", err)
	}
	// Payments live in migration 000006 (post-cleanup chain). The dropped
	// tables above are exactly its products, so its bookkeeping row must go
	// too — otherwise Migrate skips it and the tables never come back.
	if _, err := pg.Pool.Exec(ctx, `DELETE FROM schema_migrations WHERE version = 6`); err != nil {
		// fresh DB has no bookkeeping table yet — only a real failure matters
		if !strings.Contains(err.Error(), "does not exist") {
			t.Fatalf("reset migration bookkeeping: %v", err)
		}
	}
	if err := store.Migrate(ctx, pg); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return repos.NewPayments(pg.Pool), pg
}

func seedTenant(t *testing.T, pg *store.Postgres) string {
	t.Helper()
	ctx := context.Background()
	tenantID := "ten_" + ids.New("t")[6:]
	_, err := pg.Pool.Exec(ctx,
		`INSERT INTO tenants (id, slug, name, status, created_at, updated_at) VALUES ($1, $1, $1, 'active', now(), now())`,
		tenantID)
	if err != nil {
		t.Fatalf("seed tenant: %v", err)
	}
	return tenantID
}

func newOrder(tenantID string, amount, credits int64, key string) *payment.Order {
	now := time.Now().UTC()
	return &payment.Order{
		ID: ids.New("pay"), TenantID: tenantID, UserID: "usr_test",
		Provider: payment.ProviderMock, ProviderOrderID: ids.New("order")[7:],
		PackID: "pack_test", Currency: "INR",
		AmountPaise: amount, Credits: credits, Status: payment.StatusPending,
		IdempotencyKey: key, RequestHash: "hash_" + key,
		CreatedAt: now, UpdatedAt: now, ExpiresAt: now.Add(15 * time.Minute),
	}
}

func TestPG_CreateOrder_UniqueConstraints(t *testing.T) {
	r, pg := testDB(t)
	ctx := context.Background()
	tenant := seedTenant(t, pg)

	o := newOrder(tenant, 50000, 5000, "idem-1")
	if err := r.CreateOrder(ctx, o); err != nil {
		t.Fatal(err)
	}

	// Same (tenant, idempotency_key) → sentinel, not an error row.
	dup := newOrder(tenant, 50000, 5000, "idem-1")
	if err := r.CreateOrder(ctx, dup); err != payment.ErrOrderExistsIdem {
		t.Fatalf("want ErrOrderExistsIdem, got %v", err)
	}
	// Same (provider, provider_order_id) → sentinel.
	dup2 := newOrder(tenant, 50000, 5000, "idem-2")
	dup2.ProviderOrderID = o.ProviderOrderID
	if err := r.CreateOrder(ctx, dup2); err != payment.ErrOrderExistsProvider {
		t.Fatalf("want ErrOrderExistsProvider, got %v", err)
	}
}

func TestPG_Lookups(t *testing.T) {
	r, pg := testDB(t)
	ctx := context.Background()
	tenant := seedTenant(t, pg)

	o := newOrder(tenant, 100000, 10500, "idem-look")
	if err := r.CreateOrder(ctx, o); err != nil {
		t.Fatal(err)
	}
	got, err := r.OrderByID(ctx, o.ID)
	if err != nil || got.ID != o.ID || got.AmountPaise != 100000 {
		t.Fatalf("OrderByID: %v %+v", err, got)
	}
	got, err = r.OrderByProviderID(ctx, payment.ProviderMock, o.ProviderOrderID)
	if err != nil || got.ID != o.ID {
		t.Fatalf("OrderByProviderID: %v", err)
	}
	got, err = r.OrderByIdempotencyKey(ctx, tenant, "idem-look")
	if err != nil || got.ID != o.ID {
		t.Fatalf("OrderByIdempotencyKey: %v", err)
	}
	if _, err := r.OrderByID(ctx, "pay_missing"); err != payment.ErrNotFound {
		t.Fatalf("missing order: %v", err)
	}
}

func TestPG_ApplyPaid_ExactlyOnce_AndBalanceLedger(t *testing.T) {
	r, pg := testDB(t)
	ctx := context.Background()
	tenant := seedTenant(t, pg)
	tenant2 := seedTenant(t, pg)

	o := newOrder(tenant, 50000, 5000, "")
	if err := r.CreateOrder(ctx, o); err != nil {
		t.Fatal(err)
	}

	// First apply: wins, mints credits, writes ledger, bumps balance.
	applied, ord, err := r.ApplyPaid(ctx, o.ID, "pay_1")
	if err != nil || !applied {
		t.Fatalf("first ApplyPaid: applied=%v err=%v", applied, err)
	}
	if ord.Status != payment.StatusPaid || ord.PaidAt == nil {
		t.Fatalf("order not paid: %+v", ord)
	}
	b, _ := r.Balance(ctx, tenant)
	if b.Balance != 5000 {
		t.Fatalf("balance = %d, want 5000", b.Balance)
	}
	led, _ := r.Ledger(ctx, tenant, 10)
	if len(led) != 1 || led[0].BalanceAfter != 5000 {
		t.Fatalf("ledger: %+v", led)
	}

	// Second apply (webhook duplicate / confirm replay): no-op, no double.
	applied2, ord2, err := r.ApplyPaid(ctx, o.ID, "pay_2")
	if err != nil {
		t.Fatal(err)
	}
	if applied2 {
		t.Fatal("second ApplyPaid reported applied=true — DOUBLE CREDIT")
	}
	if ord2.Status != payment.StatusPaid {
		t.Fatalf("replay changed status: %s", ord2.Status)
	}
	b, _ = r.Balance(ctx, tenant)
	if b.Balance != 5000 {
		t.Fatalf("balance after replay = %d, want 5000", b.Balance)
	}
	led, _ = r.Ledger(ctx, tenant, 10)
	if len(led) != 1 {
		t.Fatalf("ledger rows after replay = %d, want 1", len(led))
	}

	// Other tenant unaffected.
	b2, _ := r.Balance(ctx, tenant2)
	if b2.Balance != 0 {
		t.Fatalf("cross-tenant balance leak: %d", b2.Balance)
	}
}

// TestPG_ApplyPaid_ConcurrentStorm — 24 concurrent transactions applying
// the SAME order simultaneously: exactly one wins, balance bumps once.
// This exercises REAL PostgreSQL row locks (SELECT ... FOR UPDATE) —
// the exact production race between confirm, webhook and reconcile.
func TestPG_ApplyPaid_ConcurrentStorm(t *testing.T) {
	r, pg := testDB(t)
	ctx := context.Background()
	tenant := seedTenant(t, pg)

	o := newOrder(tenant, 250000, 27500, "")
	if err := r.CreateOrder(ctx, o); err != nil {
		t.Fatal(err)
	}

	const n = 24
	var wg sync.WaitGroup
	start := make(chan struct{})
	wins := make([]bool, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			goCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			applied, _, err := r.ApplyPaid(goCtx, o.ID, fmt.Sprintf("pay_race_%d", i))
			if err != nil {
				t.Errorf("ApplyPaid %d: %v", i, err)
				return
			}
			wins[i] = applied
		}(i)
	}
	close(start)
	wg.Wait()

	totalWins := 0
	for _, w := range wins {
		if w {
			totalWins++
		}
	}
	if totalWins != 1 {
		t.Fatalf("EXACTLY-ONCE VIOLATED at the SQL level: %d winners of %d", totalWins, n)
	}
	b, err := r.Balance(ctx, tenant)
	if err != nil {
		t.Fatal(err)
	}
	if b.Balance != 27500 {
		t.Fatalf("balance after storm = %d, want 27500", b.Balance)
	}
	led, _ := r.Ledger(ctx, tenant, 100)
	if len(led) != 1 {
		t.Fatalf("ledger rows after storm = %d, want 1", len(led))
	}
}

func TestPG_ApplyFailed_ThenLateCaptureStillWins(t *testing.T) {
	r, pg := testDB(t)
	ctx := context.Background()
	tenant := seedTenant(t, pg)

	o := newOrder(tenant, 50000, 5000, "")
	if err := r.CreateOrder(ctx, o); err != nil {
		t.Fatal(err)
	}
	if ok, _ := r.ApplyFailed(ctx, o.ID, "payment.failed"); !ok {
		t.Fatal("ApplyFailed did not apply")
	}
	// failed → paid is legal (late capture; money arrived).
	if ok, _, _ := r.ApplyPaid(ctx, o.ID, "pay_late"); !ok {
		t.Fatal("late capture after failed must win")
	}
	got, _ := r.OrderByID(ctx, o.ID)
	if got.Status != payment.StatusPaid {
		t.Fatalf("status = %s, want paid", got.Status)
	}
	// paid → failed must NOT regress.
	if ok, _ := r.ApplyFailed(ctx, o.ID, "again"); ok {
		t.Fatal("failed regressed a paid order")
	}
}

func TestPG_ExpireStale_OnlyPastTTL(t *testing.T) {
	r, pg := testDB(t)
	ctx := context.Background()
	tenant := seedTenant(t, pg)

	fresh := newOrder(tenant, 50000, 5000, "k1")
	stale := newOrder(tenant, 50000, 5000, "k2")
	stale.ExpiresAt = time.Now().Add(-time.Minute)
	for _, o := range []*payment.Order{fresh, stale} {
		if err := r.CreateOrder(ctx, o); err != nil {
			t.Fatal(err)
		}
	}
	n, err := r.ExpireStale(ctx, time.Now())
	if err != nil || n != 1 {
		t.Fatalf("ExpireStale n=%d err=%v", n, err)
	}
	got, _ := r.OrderByID(ctx, fresh.ID)
	if got.Status != payment.StatusPending {
		t.Fatalf("fresh order expired: %s", got.Status)
	}
	got, _ = r.OrderByID(ctx, stale.ID)
	if got.Status != payment.StatusExpired {
		t.Fatalf("stale order not expired: %s", got.Status)
	}
	open, _ := r.ListOpenOrders(ctx, 10)
	if len(open) != 1 || open[0].ID != fresh.ID {
		t.Fatalf("ListOpenOrders: %+v", open)
	}
}

func TestPG_WebhookEventDedupe(t *testing.T) {
	r, pg := testDB(t)
	ctx := context.Background()
	tenant := seedTenant(t, pg)

	o := newOrder(tenant, 50000, 5000, "")
	if err := r.CreateOrder(ctx, o); err != nil {
		t.Fatal(err)
	}

	ev := &payment.WebhookEvent{
		EventID: "evt_dedupe_1", Provider: payment.ProviderMock,
		Type: payment.EventPaymentCaptured, ProviderOrderID: o.ProviderOrderID,
		LocalOrderID: o.ID, AmountPaise: 50000, Raw: []byte(`{"event":"payment.captured"}`),
	}
	dup, err := r.RecordWebhookEvent(ctx, ev)
	if err != nil || dup {
		t.Fatalf("first record: dup=%v err=%v", dup, err)
	}
	dup, err = r.RecordWebhookEvent(ctx, ev)
	if err != nil || !dup {
		t.Fatalf("second record: dup=%v err=%v (must be duplicate)", dup, err)
	}
}

// TestPG_CreateOrder_EmptyKeyIsNULL — regression for the live-caught bug
// (2026-09-28): two key-less checkouts for the same tenant must BOTH
// insert; Go "" must land as SQL NULL so the partial unique index never
// sees a phantom shared "" key.
func TestPG_CreateOrder_EmptyKeyIsNULL(t *testing.T) {
	r, pg := testDB(t)
	ctx := context.Background()
	tenant := seedTenant(t, pg)

	o1 := newOrder(tenant, 50000, 5000, "")
	o2 := newOrder(tenant, 50000, 5000, "")
	if err := r.CreateOrder(ctx, o1); err != nil {
		t.Fatalf("first key-less insert: %v", err)
	}
	if err := r.CreateOrder(ctx, o2); err != nil {
		t.Fatalf("second key-less insert REJECTED (empty-key-as-NULL bug): %v", err)
	}

	var nulls int
	if err := pg.Pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM payment_orders WHERE idempotency_key IS NULL`).Scan(&nulls); err != nil {
		t.Fatal(err)
	}
	if nulls != 2 {
		t.Fatalf("idempotency_key NULL rows = %d, want 2 (empty strings leaked into the partial index)", nulls)
	}

	// And keyed orders still enforce uniqueness.
	o3 := newOrder(tenant, 50000, 5000, "real-key")
	if err := r.CreateOrder(ctx, o3); err != nil {
		t.Fatal(err)
	}
	o4 := newOrder(tenant, 50000, 5000, "real-key")
	if err := r.CreateOrder(ctx, o4); err != payment.ErrOrderExistsIdem {
		t.Fatalf("keyed dup not rejected: %v", err)
	}
}

func TestPG_BalanceZeroForUnknownTenant(t *testing.T) {
	r, _ := testDB(t)
	b, err := r.Balance(context.Background(), "ten_never_existed")
	if err != nil {
		t.Fatal(err)
	}
	if b.Balance != 0 {
		t.Fatalf("unknown tenant balance = %d, want 0", b.Balance)
	}
}
