// checkout_test.go — scenarios: order creation. Snapshot pricing, unknown
// packs, idempotency (replay + reuse) and the per-user checkout budget.
package payment_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/mash-cloud/mash-api/internal/payment"
)

func TestCheckout_HappyPath_Snapshot(t *testing.T) {
	f := newFixture(t)
	pack := firstPack(t)

	o, err := f.svc.Checkout(context.Background(), tenantA, userA, pack.ID, "idem-1")
	if err != nil {
		t.Fatal(err)
	}
	if o.Status != payment.StatusPending {
		t.Fatalf("status = %s, want pending", o.Status)
	}
	if o.AmountPaise != pack.AmountPaise || o.Credits != pack.Credits {
		t.Fatalf("snapshot mismatch: amount=%d credits=%d", o.AmountPaise, o.Credits)
	}
	if o.Provider != payment.ProviderMock || o.ProviderOrderID == "" {
		t.Fatalf("provider fields not set: %+v", o)
	}
	if !o.ExpiresAt.After(time.Now()) {
		t.Fatal("expiry not set")
	}
}

func TestCheckout_UnknownPack(t *testing.T) {
	f := newFixture(t)
	_, err := f.svc.Checkout(context.Background(), tenantA, userA, "pack_nope", "")
	if err == nil || err.Error() == "" {
		t.Fatal("expected error")
	}
}

func TestCheckout_Idempotency_ReplayAndReuse(t *testing.T) {
	f := newFixture(t)
	packs := mustCatalog(t).Packs()

	o1, err := f.svc.Checkout(context.Background(), tenantA, userA, packs[0].ID, "key-42")
	if err != nil {
		t.Fatal(err)
	}
	// Same key, same pack → same order (network retry).
	o2, err := f.svc.Checkout(context.Background(), tenantA, userA, packs[0].ID, "key-42")
	if err != nil {
		t.Fatal(err)
	}
	if o1.ID != o2.ID {
		t.Fatalf("idempotent replay created new order: %s vs %s", o1.ID, o2.ID)
	}
	// Same key, DIFFERENT pack → IDEMPOTENCY_KEY_REUSE (422).
	_, err = f.svc.Checkout(context.Background(), tenantA, userA, packs[1].ID, "key-42")
	if err == nil {
		t.Fatal("key reuse with different body accepted")
	}
	// Different tenant may use the same key independently.
	if _, err := f.svc.Checkout(context.Background(), tenantB, userA, packs[0].ID, "key-42"); err != nil {
		t.Fatalf("cross-tenant key collision rejected: %v", err)
	}
}

func TestCheckout_PerUserBudget(t *testing.T) {
	f := newFixture(t)
	lim := &budgetLimiter{limit: 2}
	f.svc = payment.New(payment.Config{
		Store: f.store, Provider: f.provider, Catalog: mustCatalog(t),
		OrderTTL: time.Minute, SweepInterval: time.Hour, HistoryLimit: 10,
		CheckoutPerUser: 2, Limiter: lim,
	})
	pack := firstPack(t)
	for i := 0; i < 2; i++ {
		if _, err := f.svc.Checkout(context.Background(), tenantA, userA, pack.ID, fmt.Sprintf("k%d", i)); err != nil {
			t.Fatalf("checkout %d failed: %v", i, err)
		}
	}
	if _, err := f.svc.Checkout(context.Background(), tenantA, userA, pack.ID, "k3"); err == nil {
		t.Fatal("budget exhausted but checkout allowed")
	}
}
