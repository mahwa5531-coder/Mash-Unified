// catalog_test.go — scenarios: pack catalog validation and the order state
// machine (exercised through the store guards, which mirror the SQL of
// migration 000010 — the single authority; production code deliberately has
// no parallel in-memory transition validator).
package payment_test

import (
	"context"
	"testing"
	"time"

	"github.com/mash-cloud/mash-api/internal/payment"
)

func TestStateMachine_StoreGuards(t *testing.T) {
	f := newFixture(t)
	pack := firstPack(t)
	ctx := context.Background()

	// pending → failed → paid: a LATE CAPTURE beats failure (money arrived).
	o := mustCheckout(t, f, pack.ID, "")
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
		t.Fatal("paid order credited twice")
	}
	if n := f.store.ledgerCountForOrder(o.ID); n != 1 {
		t.Fatalf("ledger entries = %d, want exactly 1", n)
	}

	// pending → expired → paid: a late capture beats expiry too.
	o2 := mustCheckout(t, f, pack.ID, "")
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
	o3 := mustCheckout(t, f, pack.ID, "")
	if err := f.store.MarkAttempted(ctx, o3.ID, "pay_vis"); err != nil {
		t.Fatal(err)
	}
	got, _ := f.store.OrderByID(ctx, o3.ID)
	if got.Status != payment.StatusAttempted || got.ProviderPaymentID != "pay_vis" {
		t.Fatalf("MarkAttempted did not record: %+v", got)
	}
	if b, _ := f.store.Balance(ctx, tenantA); b.Balance != 2*pack.Credits {
		t.Fatalf("balance = %d, want exactly 2×%d (two paid orders)", b.Balance, pack.Credits)
	}
}

func TestCatalogValidation(t *testing.T) {
	if _, err := payment.NewCatalog(nil); err == nil {
		t.Error("empty catalog accepted")
	}
	if _, err := payment.NewCatalog([]payment.Pack{{ID: "x", Label: "X", AmountPaise: 99, Credits: 10}}); err == nil {
		t.Error("amount below floor accepted")
	}
	if _, err := payment.NewCatalog([]payment.Pack{{ID: "x", Label: "X", AmountPaise: 100, Credits: 0}}); err == nil {
		t.Error("zero credits accepted")
	}
	if _, err := payment.NewCatalog([]payment.Pack{
		{ID: "x", Label: "X", AmountPaise: 100, Credits: 10},
		{ID: "x", Label: "X", AmountPaise: 200, Credits: 20},
	}); err == nil {
		t.Error("duplicate ids accepted")
	}
	if _, err := payment.CatalogFromEnv(`[{"id":"custom","label":"Custom","amount_paise":123400,"credits":1234}]`); err != nil {
		t.Fatalf("valid JSON override rejected: %v", err)
	}
	if _, err := payment.CatalogFromEnv(`not json`); err == nil {
		t.Error("invalid JSON override accepted")
	}
}
