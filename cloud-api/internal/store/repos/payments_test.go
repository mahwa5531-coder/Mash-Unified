package repos_test

// PostgreSQL integration tests for the payments store. These run ONLY
// when NEXAU_TEST_DATABASE_URL points at a disposable database
// (skip otherwise — CI portability). They prove the SQL itself:
//
//   - migrations 000001–000012 apply cleanly (plans-only schema)
//   - the state-machine conditional UPDATEs behave under REAL row locks
//   - ApplyPaid activates the subscription EXACTLY ONCE (stacking periods)
//     under a genuine concurrent storm
//   - read-side expiry: an active-status row past current_period_end is
//     NOT effective (the free-plan fallback path)
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
	// Payments live in migrations 000006/000009/0000010/000012 (the
	// post-cleanup chain touching payment_orders + the credit tables).
	// The dropped tables above are exactly their products, so their
	// bookkeeping rows must go too — otherwise Migrate skips them and the
	// tables never come back. 000011 (model economics) is idempotent and
	// touches untouched tables — its row stays.
	if _, err := pg.Pool.Exec(ctx, `DELETE FROM schema_migrations WHERE version IN (6, 9, 10, 12)`); err != nil {
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

// newOrder builds a plan_pro_1m-shaped order (₹1,999 / pro / 30 days).
func newOrder(tenantID string, amount int64, key string) *payment.Order {
	now := time.Now().UTC()
	return &payment.Order{
		ID: ids.New("pay"), TenantID: tenantID, UserID: "usr_test",
		Provider: payment.ProviderMock, ProviderOrderID: ids.New("order")[7:],
		SKUID: "plan_pro_1m", PlanCode: "pro", PeriodDays: 30, Currency: "INR",
		AmountPaise: amount, Status: payment.StatusPending,
		IdempotencyKey: key, RequestHash: "hash_" + key,
		CreatedAt: now, UpdatedAt: now, ExpiresAt: now.Add(15 * time.Minute),
	}
}

// paidThrough reads the tenant's active subscription period end directly.
func paidThrough(t *testing.T, pg *store.Postgres, tenantID string) (time.Time, bool) {
	t.Helper()
	var end time.Time
	err := pg.Pool.QueryRow(context.Background(),
		`SELECT current_period_end FROM subscriptions WHERE tenant_id = $1 AND status IN ('trialing','active','past_due')`,
		tenantID).Scan(&end)
	if err != nil {
		return time.Time{}, false
	}
	return end, true
}

func TestPG_CreateOrder_UniqueConstraints(t *testing.T) {
	r, pg := testDB(t)
	ctx := context.Background()
	tenant := seedTenant(t, pg)

	o := newOrder(tenant, 199900, "idem-1")
	if err := r.CreateOrder(ctx, o); err != nil {
		t.Fatal(err)
	}
	// Same (tenant, idempotency_key) → sentinel, not an error row.
	dup := newOrder(tenant, 199900, "idem-1")
	if err := r.CreateOrder(ctx, dup); err != payment.ErrOrderExistsIdem {
		t.Fatalf("want ErrOrderExistsIdem, got %v", err)
	}
	// Same (provider, provider_order_id) → sentinel.
	dup2 := newOrder(tenant, 199900, "idem-2")
	dup2.ProviderOrderID = o.ProviderOrderID
	if err := r.CreateOrder(ctx, dup2); err != payment.ErrOrderExistsProvider {
		t.Fatalf("want ErrOrderExistsProvider, got %v", err)
	}
	// The plan snapshot round-trips.
	got, _ := r.OrderByID(ctx, o.ID)
	if got.SKUID != "plan_pro_1m" || got.PlanCode != "pro" || got.PeriodDays != 30 {
		t.Fatalf("plan snapshot lost: %+v", got)
	}
}

func TestPG_Lookups(t *testing.T) {
	r, pg := testDB(t)
	ctx := context.Background()
	tenant := seedTenant(t, pg)

	o := newOrder(tenant, 199900, "idem-look")
	if err := r.CreateOrder(ctx, o); err != nil {
		t.Fatal(err)
	}
	got, err := r.OrderByID(ctx, o.ID)
	if err != nil || got.ID != o.ID || got.AmountPaise != 199900 {
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

func TestPG_ApplyPaid_ActivatesSubscription_ExactlyOnce(t *testing.T) {
	r, pg := testDB(t)
	ctx := context.Background()
	tenant := seedTenant(t, pg)
	tenant2 := seedTenant(t, pg)

	o := newOrder(tenant, 199900, "")
	if err := r.CreateOrder(ctx, o); err != nil {
		t.Fatal(err)
	}

	// No subscription before the purchase.
	if st, _ := r.Subscription(ctx, tenant); st.Status != payment.SubNone {
		t.Fatalf("pre-purchase subscription = %+v, want none", st)
	}

	// First apply: wins, activates pro for 30 days.
	applied, ord, err := r.ApplyPaid(ctx, o.ID, "pay_1")
	if err != nil || !applied {
		t.Fatalf("first ApplyPaid: applied=%v err=%v", applied, err)
	}
	if ord.Status != payment.StatusPaid || ord.PaidAt == nil {
		t.Fatalf("order not paid: %+v", ord)
	}
	st, err := r.Subscription(ctx, tenant)
	if err != nil {
		t.Fatal(err)
	}
	if st.Status != payment.SubActive || st.PlanCode != "pro" {
		t.Fatalf("subscription = %+v, want active pro", st)
	}
	if st.DaysRemaining < 29 || st.DaysRemaining > 30 {
		t.Fatalf("days remaining = %d, want ~30", st.DaysRemaining)
	}
	end1, _ := paidThrough(t, pg, tenant)

	// Second apply (webhook duplicate / confirm replay): no-op — the
	// period does NOT double.
	applied2, ord2, err := r.ApplyPaid(ctx, o.ID, "pay_2")
	if err != nil {
		t.Fatal(err)
	}
	if applied2 {
		t.Fatal("second ApplyPaid reported applied=true — DOUBLE ACTIVATION")
	}
	if ord2.Status != payment.StatusPaid {
		t.Fatalf("replay changed status: %s", ord2.Status)
	}
	end2, _ := paidThrough(t, pg, tenant)
	if !end2.Equal(end1) {
		t.Fatalf("replay extended the period: %v → %v", end1, end2)
	}

	// A SECOND PAID order stacks its period on top (renewals never lose days).
	o2 := newOrder(tenant, 199900, "")
	if err := r.CreateOrder(ctx, o2); err != nil {
		t.Fatal(err)
	}
	if ok, _, _ := r.ApplyPaid(ctx, o2.ID, "pay_3"); !ok {
		t.Fatal("renewal order did not apply")
	}
	end3, _ := paidThrough(t, pg, tenant)
	if got := end3.Sub(end2); got < 29*24*time.Hour {
		t.Fatalf("renewal did not stack: +%v, want ~30d", got)
	}

	// Other tenant unaffected.
	if st2, _ := r.Subscription(ctx, tenant2); st2.Status != payment.SubNone {
		t.Fatalf("cross-tenant activation leak: %+v", st2)
	}
}

// TestPG_ApplyPaid_ConcurrentStorm — 24 concurrent transactions applying
// the SAME order simultaneously: exactly one wins, the subscription
// activates exactly one period. This exercises REAL PostgreSQL row locks
// (SELECT ... FOR UPDATE) — the exact production race between confirm,
// webhook and reconcile.
func TestPG_ApplyPaid_ConcurrentStorm(t *testing.T) {
	r, pg := testDB(t)
	ctx := context.Background()
	tenant := seedTenant(t, pg)

	o := newOrder(tenant, 199900, "")
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
	// The period is exactly ONE SKU activation (~30 days, not 24×).
	st, err := r.Subscription(ctx, tenant)
	if err != nil {
		t.Fatal(err)
	}
	if st.Status != payment.SubActive || st.DaysRemaining > 30 {
		t.Fatalf("activation after storm = %+v (want one ~30d period)", st)
	}
}

// TestPG_Subscription_ReadSideExpiry: an active-status row past its
// paid-through date must read as SubNone (the free-plan fallback path) —
// expiry is read-side, no sweeper needed.
func TestPG_Subscription_ReadSideExpiry(t *testing.T) {
	r, pg := testDB(t)
	ctx := context.Background()
	tenant := seedTenant(t, pg)

	o := newOrder(tenant, 199900, "")
	if err := r.CreateOrder(ctx, o); err != nil {
		t.Fatal(err)
	}
	if ok, _, _ := r.ApplyPaid(ctx, o.ID, "pay_x"); !ok {
		t.Fatal("order did not apply")
	}
	// Force the period into the past.
	if _, err := pg.Pool.Exec(ctx,
		`UPDATE subscriptions SET current_period_end = now() - interval '1 day' WHERE tenant_id = $1`, tenant); err != nil {
		t.Fatal(err)
	}
	st, err := r.Subscription(ctx, tenant)
	if err != nil {
		t.Fatal(err)
	}
	if st.Status != payment.SubNone || st.PlanCode != "" {
		t.Fatalf("expired subscription still effective: %+v", st)
	}
}

func TestPG_PlanExists(t *testing.T) {
	r, _ := testDB(t)
	ctx := context.Background()
	if ok, err := r.PlanExists(ctx, "pro"); err != nil || !ok {
		t.Fatalf("pro plan: ok=%v err=%v", ok, err)
	}
	if ok, err := r.PlanExists(ctx, "enterprise_nope"); err != nil || ok {
		t.Fatalf("unknown plan: ok=%v err=%v", ok, err)
	}
}

func TestPG_ApplyFailed_ThenLateCaptureStillWins(t *testing.T) {
	r, pg := testDB(t)
	ctx := context.Background()
	tenant := seedTenant(t, pg)

	o := newOrder(tenant, 199900, "")
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
	if st, _ := r.Subscription(ctx, tenant); st.Status != payment.SubActive {
		t.Fatalf("late capture did not activate: %+v", st)
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

	fresh := newOrder(tenant, 199900, "k1")
	stale := newOrder(tenant, 199900, "k2")
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

	o := newOrder(tenant, 199900, "")
	if err := r.CreateOrder(ctx, o); err != nil {
		t.Fatal(err)
	}

	ev := &payment.WebhookEvent{
		EventID: "evt_dedupe_1", Provider: payment.ProviderMock,
		Type: payment.EventPaymentCaptured, ProviderOrderID: o.ProviderOrderID,
		LocalOrderID: o.ID, AmountPaise: 199900, Raw: []byte(`{"event":"payment.captured"}`),
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

	o1 := newOrder(tenant, 199900, "")
	o2 := newOrder(tenant, 199900, "")
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
	o3 := newOrder(tenant, 199900, "real-key")
	if err := r.CreateOrder(ctx, o3); err != nil {
		t.Fatal(err)
	}
	o4 := newOrder(tenant, 199900, "real-key")
	if err := r.CreateOrder(ctx, o4); err != payment.ErrOrderExistsIdem {
		t.Fatalf("keyed dup not rejected: %v", err)
	}
}

func TestPG_SubscriptionNoneForUnknownTenant(t *testing.T) {
	r, _ := testDB(t)
	st, err := r.Subscription(context.Background(), "ten_never_existed")
	if err != nil {
		t.Fatal(err)
	}
	if st.Status != payment.SubNone {
		t.Fatalf("unknown tenant subscription = %+v, want none", st)
	}
}
