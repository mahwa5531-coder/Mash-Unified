// reconcile_test.go — scenarios: truth recovery when webhooks are lost.
// GetOrder read-through reconcile and the sweeper's TTL expiry.
package payment_test

import (
	"context"
	"testing"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/payment"
)

func TestGetOrder_ReconcilesMissedWebhook(t *testing.T) {
	f := newFixture(t)
	pack := firstPack(t)
	o, _ := f.svc.Checkout(context.Background(), tenantA, userA, pack.ID, "")

	// The webhook was LOST — but the provider captured. GetOrder must
	// reconcile: provider truth → paid → credits minted.
	f.provider.Capture(o.ProviderOrderID)

	got, err := f.svc.GetOrder(context.Background(), tenantA, o.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != payment.StatusPaid {
		t.Fatalf("reconcile missed the capture: %s", got.Status)
	}
	b, _ := f.store.Balance(context.Background(), tenantA)
	if b.Balance != pack.Credits {
		t.Fatalf("reconcile did not mint credits: %d", b.Balance)
	}
}

func TestSweepOnce_ExpiresStaleOrders(t *testing.T) {
	f := newFixture(t)
	pack := firstPack(t)
	o, _ := f.svc.Checkout(context.Background(), tenantA, userA, pack.ID, "")

	// Age the order past its TTL, then sweep.
	f.store.mu.Lock()
	stale := f.store.orders[o.ID]
	stale.ExpiresAt = time.Now().Add(-time.Minute)
	f.store.mu.Unlock()

	n, err := f.store.ExpireStale(context.Background(), time.Now())
	if err != nil || n != 1 {
		t.Fatalf("ExpireStale n=%d err=%v", n, err)
	}
	got, _ := f.store.OrderByID(context.Background(), o.ID)
	if got.Status != payment.StatusExpired {
		t.Fatalf("status = %s, want expired", got.Status)
	}
	// A LATE capture must still beat expiry (money arrived).
	if applied, _, _ := f.store.ApplyPaid(context.Background(), o.ID, "pay_late"); !applied {
		t.Fatal("late capture after expiry must apply")
	}
	b, _ := f.store.Balance(context.Background(), tenantA)
	if b.Balance != pack.Credits {
		t.Fatalf("late-capture credits missing: %d", b.Balance)
	}
}
