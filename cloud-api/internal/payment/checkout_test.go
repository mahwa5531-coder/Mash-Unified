// checkout_test.go — scenarios: order creation. Snapshot pricing, unknown
// SKUs, plan validation, idempotency (replay + reuse) and the per-user
// checkout budget.
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
	sku := firstSKU(t)

	o, err := f.svc.Checkout(context.Background(), tenantA, userA, sku.ID, "idem-1")
	if err != nil {
		t.Fatal(err)
	}
	if o.Status != payment.StatusPending {
		t.Fatalf("status = %s, want pending", o.Status)
	}
	if o.AmountPaise != sku.AmountPaise || o.PlanCode != sku.PlanCode || o.PeriodDays != sku.PeriodDays {
		t.Fatalf("snapshot mismatch: amount=%d plan=%s days=%d", o.AmountPaise, o.PlanCode, o.PeriodDays)
	}
	if o.SKUID != sku.ID {
		t.Fatalf("sku id = %s, want %s", o.SKUID, sku.ID)
	}
	if o.Provider != payment.ProviderMock || o.ProviderOrderID == "" {
		t.Fatalf("provider fields not set: %+v", o)
	}
	if !o.ExpiresAt.After(time.Now()) {
		t.Fatal("expiry not set")
	}
}

func TestCheckout_UnknownSKU(t *testing.T) {
	f := newFixture(t)
	_, err := f.svc.Checkout(context.Background(), tenantA, userA, "plan_nope", "")
	if err == nil || err.Error() == "" {
		t.Fatal("expected error")
	}
}

// TestCheckout_UnknownPlan: a SKU whose plan_code has no plans row must be
// REJECTED at checkout — never create an order that cannot activate at
// capture.
func TestCheckout_UnknownPlan(t *testing.T) {
	f := newFixture(t)
	f.store.mu.Lock()
	f.store.plans["pro"] = false // plan deleted mid-flight simulation
	f.store.mu.Unlock()
	if _, err := f.svc.Checkout(context.Background(), tenantA, userA, firstSKU(t).ID, ""); err == nil {
		t.Fatal("checkout accepted a SKU whose plan does not exist")
	}
}

func TestCheckout_Idempotency_ReplayAndReuse(t *testing.T) {
	f := newFixture(t)
	skus := mustCatalog(t).SKUs()

	o1, err := f.svc.Checkout(context.Background(), tenantA, userA, skus[0].ID, "key-42")
	if err != nil {
		t.Fatal(err)
	}
	// Same key, same sku → same order (network retry).
	o2, err := f.svc.Checkout(context.Background(), tenantA, userA, skus[0].ID, "key-42")
	if err != nil {
		t.Fatal(err)
	}
	if o1.ID != o2.ID {
		t.Fatalf("idempotent replay created new order: %s vs %s", o1.ID, o2.ID)
	}
	// Same key, DIFFERENT sku → IDEMPOTENCY_KEY_REUSE (422).
	_, err = f.svc.Checkout(context.Background(), tenantA, userA, skus[1].ID, "key-42")
	if err == nil {
		t.Fatal("key reuse with different body accepted")
	}
	// Different tenant may use the same key independently.
	if _, err := f.svc.Checkout(context.Background(), tenantB, userA, skus[0].ID, "key-42"); err != nil {
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
	sku := firstSKU(t)
	for i := 0; i < 2; i++ {
		if _, err := f.svc.Checkout(context.Background(), tenantA, userA, sku.ID, fmt.Sprintf("k%d", i)); err != nil {
			t.Fatalf("checkout %d failed: %v", i, err)
		}
	}
	if _, err := f.svc.Checkout(context.Background(), tenantA, userA, sku.ID, "k3"); err == nil {
		t.Fatal("budget exhausted but checkout allowed")
	}
}
