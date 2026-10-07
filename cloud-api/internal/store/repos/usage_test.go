package repos

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/mash-cloud/mash-api/internal/domain"
	"github.com/mash-cloud/mash-api/internal/ids"
	"github.com/mash-cloud/mash-api/internal/store"
)

// usageTestDB provisions a fresh schema for the llm_calls + token_normalization
// suites (disposable test DB only): drops both tables, resets their migration
// bookkeeping rows (000005 owns llm_calls, 000008 owns token_normalization and
// the llm_calls ALTER), then re-migrates.
func usageTestDB(t *testing.T) (*store.Postgres, *LLMCallsRepo, *NormalizationRepo) {
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

	if _, err := pg.Pool.Exec(ctx, `
                DROP TABLE IF EXISTS token_normalization CASCADE;
                ALTER TABLE llm_calls DROP COLUMN IF EXISTS raw_prompt_tokens, DROP COLUMN IF EXISTS raw_completion_tokens;
                DROP TABLE IF EXISTS llm_calls CASCADE`); err != nil {
		t.Fatalf("drop: %v", err)
	}
	for _, version := range []int64{5, 8} {
		if _, err := pg.Pool.Exec(ctx, `DELETE FROM schema_migrations WHERE version = $1`, version); err != nil {
			if !strings.Contains(err.Error(), "does not exist") {
				t.Fatalf("reset bookkeeping %d: %v", version, err)
			}
		}
	}
	if err := store.Migrate(ctx, pg); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return pg, NewLLMCalls(pg.Pool), NewNormalization(pg.Pool)
}

func seedUsageTenant(t *testing.T, pg *store.Postgres) string {
	t.Helper()
	tenantID := "ten_" + ids.New("u")[6:]
	if _, err := pg.Pool.Exec(context.Background(),
		`INSERT INTO tenants (id, slug, name, status, created_at, updated_at) VALUES ($1, $1, $1, 'active', now(), now())`,
		tenantID); err != nil {
		t.Fatalf("seed tenant: %v", err)
	}
	// llm_calls.user_id carries a real FK — provision the personal user too.
	if _, err := pg.Pool.Exec(context.Background(),
		`INSERT INTO users (id, email, display_name, status, is_platform_admin, auth_provider, external_subject, email_verified, created_at, updated_at)
                 VALUES ($1, $1 || '@test', 'U', 'active', FALSE, 'google', 'sub_' || $1, TRUE, now(), now())`,
		tenantID); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	return tenantID
}

// insertCall writes one metering fact with an explicit recorded_at (age ago)
// so window math is deterministic.
func insertCall(t *testing.T, pg *store.Postgres, tenantID string, total int64, age time.Duration) {
	t.Helper()
	_, err := pg.Pool.Exec(context.Background(), `
                INSERT INTO llm_calls (call_id, tenant_id, user_id, request_id, requested_model,
                                       stream, status, input_tokens, output_tokens, total_tokens,
                                       raw_prompt_tokens, raw_completion_tokens, started_at, completed_at, recorded_at)
                VALUES ($1, $2, $2, 'req_x', 'openai/gpt-4o', TRUE, 'completed',
                        $3, $4, $5, $6, $7, now() - $8::interval, now() - $8::interval, now() - $8::interval)`,
		ids.New("llm"), tenantID, total/2, total/2, total, total/2, total/2, age.String())
	if err != nil {
		t.Fatalf("insert call: %v", err)
	}
}

// TestPG_WindowUsage_RollingSums: 5h and 7d sums are computed over exactly the
// rolling windows — recent calls count in both, old ones only in weekly, and
// ancient ones in neither.
func TestPG_WindowUsage_RollingSums(t *testing.T) {
	pg, calls, _ := usageTestDB(t)
	ten := seedUsageTenant(t, pg)

	insertCall(t, pg, ten, 100, 10*time.Minute)  // both windows
	insertCall(t, pg, ten, 200, 2*time.Hour)     // both windows
	insertCall(t, pg, ten, 400, 6*time.Hour)     // weekly only
	insertCall(t, pg, ten, 800, 3*24*time.Hour)  // weekly only
	insertCall(t, pg, ten, 1600, 8*24*time.Hour) // neither

	pos, err := calls.WindowUsage(context.Background(), ten)
	if err != nil {
		t.Fatalf("WindowUsage: %v", err)
	}
	if pos.Used5h != 300 {
		t.Fatalf("Used5h = %d, want 300", pos.Used5h)
	}
	if pos.UsedWeekly != 1500 {
		t.Fatalf("UsedWeekly = %d, want 1500", pos.UsedWeekly)
	}

	// Isolation: another tenant sees zero.
	other := seedUsageTenant(t, pg)
	pos2, err := calls.WindowUsage(context.Background(), other)
	if err != nil {
		t.Fatalf("WindowUsage(other): %v", err)
	}
	if pos2.Used5h != 0 || pos2.UsedWeekly != 0 {
		t.Fatalf("tenant isolation broken: %+v", pos2)
	}
}

// TestPG_WindowRecovery_ExactInstant: recovery is the earliest expiry that
// drops the window below quota — the answer to "when can I run again".
func TestPG_WindowRecovery_ExactInstant(t *testing.T) {
	pg, calls, _ := usageTestDB(t)
	ten := seedUsageTenant(t, pg)

	// Window (5h): rows of 300 (10m ago), 200 (2h ago), 400 (4h ago) = 900 used.
	insertCall(t, pg, ten, 300, 10*time.Minute)
	insertCall(t, pg, ten, 200, 2*time.Hour)
	insertCall(t, pg, ten, 400, 4*time.Hour)

	ctx := context.Background()
	pos, err := calls.WindowUsage(ctx, ten)
	if err != nil || pos.Used5h != 900 {
		t.Fatalf("setup: pos=%+v err=%v", pos, err)
	}

	within := func(rec *time.Time, low, high time.Duration) {
		t.Helper()
		if rec == nil {
			t.Fatal("recovery must exist when at/over quota")
		}
		now := time.Now()
		if rec.Before(now.Add(low)) || rec.After(now.Add(high)) {
			t.Fatalf("recovery = %v, want ~now+%v", *rec, high)
		}
	}

	// Over by 50 (quota 850): expiring the oldest row (400) already drops the
	// window to 500 < 850 → recovery = (now−4h) + 5h = now+1h.
	rec, err := calls.WindowRecovery(ctx, ten, 5*time.Hour, 850, pos.Used5h)
	if err != nil {
		t.Fatalf("WindowRecovery: %v", err)
	}
	within(rec, 55*time.Minute, 65*time.Minute)

	// Over by 400 (quota 500): the oldest row alone is NOT enough (900−400 =
	// 500 still >= 500 → still blocked); the 2h row must expire too →
	// recovery = (now−2h) + 5h = now+3h. This is the cumulative-prefix logic
	// in action — partial expiry must not promise recovery.
	recDeep, err := calls.WindowRecovery(ctx, ten, 5*time.Hour, 500, pos.Used5h)
	if err != nil {
		t.Fatalf("WindowRecovery(deep): %v", err)
	}
	within(recDeep, 175*time.Minute, 185*time.Minute)
	if !recDeep.After(*rec) {
		t.Fatalf("deeper overage must recover later: %v vs %v", recDeep, rec)
	}

	// At quota (used == quota): any single row's expiry unblocks — the oldest.
	recAt, err := calls.WindowRecovery(ctx, ten, 5*time.Hour, 900, pos.Used5h)
	if err != nil {
		t.Fatalf("at-quota recovery: %v", err)
	}
	within(recAt, 55*time.Minute, 65*time.Minute)

	// Under quota: no recovery needed.
	recNone, err := calls.WindowRecovery(ctx, ten, 5*time.Hour, 5000, pos.Used5h)
	if err != nil {
		t.Fatalf("under-quota WindowRecovery: %v", err)
	}
	if recNone != nil {
		t.Fatalf("under quota must return nil, got %v", recNone)
	}
}

// TestPG_NormalizationRepo_LoadsTable: the repo reads the active rows with
// their weights; the seeded '*' default is exactly the identity rule.
func TestPG_NormalizationRepo_LoadsTable(t *testing.T) {
	pg, _, norms := usageTestDB(t)
	ctx := context.Background()

	rules, err := norms.All(ctx)
	if err != nil {
		t.Fatalf("All: %v", err)
	}
	if len(rules) != 1 || rules[0].Model != "*" {
		t.Fatalf("seeded rules: %+v", rules)
	}
	if rules[0] != (domain.NormRule{Model: "*", InputWeight: 1, CachedReadWeight: 1, CachedWriteWeight: 1, OutputWeight: 1}) {
		t.Fatalf("seeded '*' must be the identity rule: %+v", rules[0])
	}

	// Hot-change: a plain UPDATE is what the operator does — the next read
	// sees it (the in-process cache TTL governs the API's pickup delay).
	if _, err := pg.Pool.Exec(ctx, `
                INSERT INTO token_normalization (model, input_weight, cached_read_weight, cached_write_weight, output_weight)
                VALUES ('anthropic/*',                 1, 0.1, 1, 1),
                       ('anthropic/claude-sonnet-4',    2, 1,   1, 2)`); err != nil {
		t.Fatalf("insert rules: %v", err)
	}
	rules, err = norms.All(ctx)
	if err != nil {
		t.Fatalf("All after insert: %v", err)
	}
	if len(rules) != 3 {
		t.Fatalf("rules after insert: %+v", rules)
	}
	for _, r := range rules {
		switch r.Model {
		case "anthropic/*":
			if r.CachedReadWeight != 0.1 {
				t.Fatalf("pattern weights: %+v", r)
			}
		case "anthropic/claude-sonnet-4":
			if r.InputWeight != 2 || r.OutputWeight != 2 {
				t.Fatalf("exact weights: %+v", r)
			}
		}
	}

	// Inactive rows are excluded.
	if _, err := pg.Pool.Exec(ctx, `UPDATE token_normalization SET is_active = FALSE WHERE model = 'anthropic/*'`); err != nil {
		t.Fatalf("deactivate: %v", err)
	}
	rules, err = norms.All(ctx)
	if err != nil || len(rules) != 2 {
		t.Fatalf("active-only filter: %+v err=%v", rules, err)
	}
}

// TestPG_Migration8_PlanWindowKeys: the 000008 conversion retires
// monthly_token_quota and guarantees both window keys on every public plan —
// fresh installs (000007 seeds) and monthly-era upgrades converge.
func TestPG_Migration8_PlanWindowKeys(t *testing.T) {
	pg, _, _ := usageTestDB(t)
	var hasMonthly, has5h, hasWeekly int
	err := pg.Pool.QueryRow(context.Background(), `
                SELECT count(*) FILTER (WHERE limits ? 'monthly_token_quota'),
                       count(*) FILTER (WHERE limits ? 'window_5h_tokens'),
                       count(*) FILTER (WHERE limits ? 'window_weekly_tokens')
                FROM plans WHERE is_public`).Scan(&hasMonthly, &has5h, &hasWeekly)
	if err != nil {
		t.Fatalf("plan keys query: %v", err)
	}
	if hasMonthly != 0 || has5h != 2 || hasWeekly != 2 {
		t.Fatalf("plan limits keys: monthly=%d 5h=%d weekly=%d (want 0/2/2)", hasMonthly, has5h, hasWeekly)
	}
}

// TestPG_SubscriptionsFreeFallback: a canceled/expired subscription yields
// Effective()=nil, and FreeFallback() returns the public Free plan with its
// limits decoded — the read-time entitlement the identity resolver degrades
// tenants to. With no public free plan configured, FreeFallback returns nil
// (fail-closed SUBSCRIPTION_INACTIVE posture).
func TestPG_SubscriptionsFreeFallback(t *testing.T) {
	pg, _, _ := usageTestDB(t)
	subs := NewSubscriptions(pg.Pool)
	ctx := context.Background()

	tenant := seedUsageTenant(t, pg)
	if _, err := pg.Pool.Exec(ctx, `
		INSERT INTO subscriptions (id, tenant_id, plan_id, status, current_period_start)
		VALUES ('sub_ff', $1, 'pln_pro', 'active', now())`, tenant); err != nil {
		t.Fatalf("seed pro sub: %v", err)
	}

	// Active Pro sub: Effective returns it; FreeFallback unused.
	sub, err := subs.Effective(ctx, tenant)
	if err != nil || sub == nil || sub.Plan.Code != "pro" {
		t.Fatalf("effective pro: %+v err=%v", sub, err)
	}

	// Canceled: Effective drops to nil, FreeFallback carries the Free plan
	// and its limits (the resolver degrades the tenant to Free).
	if _, err := pg.Pool.Exec(ctx, `UPDATE subscriptions SET status='canceled' WHERE id='sub_ff'`); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	sub, err = subs.Effective(ctx, tenant)
	if err != nil || sub != nil {
		t.Fatalf("canceled effective should be nil: %+v err=%v", sub, err)
	}
	fb, err := subs.FreeFallback(ctx)
	if err != nil || fb == nil {
		t.Fatalf("free fallback: %+v err=%v", fb, err)
	}
	if fb.Plan.Code != "free" || fb.Status != "active" || fb.Plan.Limits.Window5hTokens == 0 || fb.Plan.Limits.WindowWeeklyTokens == 0 {
		t.Fatalf("fallback shape: %+v", fb)
	}

	// No public free plan → nil (fail-closed), error-free.
	if _, err := pg.Pool.Exec(ctx, `UPDATE plans SET is_public = FALSE WHERE code='free'`); err != nil {
		t.Fatalf("hide free: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pg.Pool.Exec(context.Background(), `UPDATE plans SET is_public = TRUE WHERE code='free'`)
	})
	fb, err = subs.FreeFallback(ctx)
	if err != nil || fb != nil {
		t.Fatalf("no public free → nil: %+v err=%v", fb, err)
	}
}
