// catalog_test.go — scenarios: SKU catalog validation and the order state
// machine (exercised through the store guards, which mirror the SQL — the
// single authority; production code deliberately has no parallel in-memory
// transition validator).
package payment_test

import (
	"context"
	"testing"
	"time"

	"github.com/mash-cloud/mash-api/internal/payment"
)

func TestStateMachine_StoreGuards(t *testing.T) {
	f := newFixture(t)
	sku := firstSKU(t)
	ctx := context.Background()

	// pending → failed → paid: a LATE CAPTURE beats failure (money arrived).
	o := mustCheckout(t, f, sku.ID, "")
	if applied, err := f.store.ApplyFailed(ctx, o.ID, "declined"); !applied || err != nil {
		t.Fatalf("pending→failed rejected: applied=%v err=%v", applied, err)
	}
	if applied, _, err := f.store.ApplyPaid(ctx, o.ID, "pay_late"); !applied || err != nil {
		t.Fatalf("late capture after failure must apply: applied=%v err=%v", applied, err)
	}

	// paid is ABSORBING: failure, expiry and re-pay are all no-ops after it.
	if applied, _ := f.store.ApplyFailed(ctx, o.ID, "late decline"); applied {
		t.Fatal("paid order regressed to failed")
	}
	if applied, _ := f.store.ApplyExpired(ctx, o.ID); applied {
		t.Fatal("paid order regressed to expired")
	}
	if applied, _, _ := f.store.ApplyPaid(ctx, o.ID, "pay_again"); applied {
		t.Fatal("paid order activated twice")
	}
	// Exactly one activation: the period is exactly one SKU period past
	// the activation instant (not two).
	end, ok := f.store.subscriptionPeriodEnd(tenantA)
	if !ok {
		t.Fatal("no subscription after capture")
	}
	if d := time.Until(end); d < 29*24*time.Hour || d > 31*24*time.Hour {
		t.Fatalf("period = %v, want ~%d days (exactly one activation)", d, sku.PeriodDays)
	}

	// pending → expired → paid: a late capture beats expiry too.
	o2 := mustCheckout(t, f, sku.ID, "")
	f.store.mu.Lock()
	f.store.orders[o2.ID].ExpiresAt = time.Now().Add(-time.Minute)
	f.store.mu.Unlock()
	if n, err := f.store.ExpireStale(ctx, time.Now()); err != nil || n != 1 {
		t.Fatalf("ExpireStale n=%d err=%v", n, err)
	}
	if applied, _, _ := f.store.ApplyPaid(ctx, o2.ID, "pay_late2"); !applied {
		t.Fatal("late capture after expiry must apply")
	}

	// pending → attempted: visibility only, never a money-moving transition.
	o3 := mustCheckout(t, f, sku.ID, "")
	if err := f.store.MarkAttempted(ctx, o3.ID, "pay_vis"); err != nil {
		t.Fatal(err)
	}
	got, _ := f.store.OrderByID(ctx, o3.ID)
	if got.Status != payment.StatusAttempted || got.ProviderPaymentID != "pay_vis" {
		t.Fatalf("MarkAttempted did not record: %+v", got)
	}
	// Two paid orders → the periods STACKED (two × the SKU period).
	end2, _ := f.store.subscriptionPeriodEnd(tenantA)
	if !end2.After(end) {
		t.Fatal("second paid order did not extend the subscription")
	}
}

func TestCatalogValidation(t *testing.T) {
	if _, err := payment.NewCatalog(nil); err == nil {
		t.Error("empty catalog accepted")
	}
	if _, err := payment.NewCatalog([]payment.PlanSKU{{ID: "x", Label: "X", PlanCode: "pro", PeriodDays: 30, AmountPaise: 99}}); err == nil {
		t.Error("amount below floor accepted")
	}
	if _, err := payment.NewCatalog([]payment.PlanSKU{{ID: "x", Label: "X", PlanCode: "pro", PeriodDays: 0, AmountPaise: 100}}); err == nil {
		t.Error("zero period accepted")
	}
	if _, err := payment.NewCatalog([]payment.PlanSKU{{ID: "x", Label: "X", AmountPaise: 100, PeriodDays: 30}}); err == nil {
		t.Error("missing plan_code accepted (plans only — credits are not sellable)")
	}
	if _, err := payment.NewCatalog([]payment.PlanSKU{
		{ID: "x", Label: "X", PlanCode: "pro", PeriodDays: 30, AmountPaise: 100},
		{ID: "x", Label: "X", PlanCode: "pro", PeriodDays: 365, AmountPaise: 200},
	}); err == nil {
		t.Error("duplicate ids accepted")
	}
	if _, err := payment.CatalogFromEnv(`[{"id":"custom","label":"Custom","plan_code":"pro","period_days":30,"amount_paise":123400}]`); err != nil {
		t.Fatalf("valid JSON override rejected: %v", err)
	}
	if _, err := payment.CatalogFromEnv(`not json`); err == nil {
		t.Error("invalid JSON override accepted")
	}
	// Default catalog sanity: every SKU references the pro plan.
	for _, s := range mustCatalog(t).SKUs() {
		if s.PlanCode != "pro" {
			t.Fatalf("default sku %s references plan %q, want pro", s.ID, s.PlanCode)
		}
	}
}
