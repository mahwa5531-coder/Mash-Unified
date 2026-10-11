// reconcile_test.go — scenarios: truth recovery when webhooks are lost.
// GetOrder read-through reconcile and the sweeper's TTL expiry.
package payment_test

import (
	"context"
	"testing"
	"time"

	"github.com/mash-cloud/mash-api/internal/payment"
)

func TestGetOrder_ReconcilesMissedWebhook(t *testing.T) {
	f := newFixture(t)
	sku := firstSKU(t)
	o, _ := f.svc.Checkout(context.Background(), tenantA, userA, sku.ID, "")

	// The webhook was LOST — but the provider captured. GetOrder must
	// reconcile: provider truth → paid → plan activated.
	f.provider.Capture(o.ProviderOrderID)

	got, err := f.svc.GetOrder(context.Background(), tenantA, o.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != payment.StatusPaid {
		t.Fatalf("reconcile missed the capture: %s", got.Status)
	}
	st, _ := f.store.Subscription(context.Background(), tenantA)
	if st.Status != payment.SubActive {
		t.Fatalf("reconcile did not activate the plan: %+v", st)
	}
}

func TestSweepOnce_ExpiresStaleOrders(t *testing.T) {
	f := newFixture(t)
	sku := firstSKU(t)
	o, _ := f.svc.Checkout(context.Background(), tenantA, userA, sku.ID, "")

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
	if st, _ := f.store.Subscription(context.Background(), tenantA); st.Status != payment.SubActive {
		t.Fatalf("late-capture activation missing: %+v", st)
	}
}
