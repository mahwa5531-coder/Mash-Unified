// concurrency_test.go — THE RACE SCENARIOS: concurrent users, concurrent
// checkouts, webhook+confirm+reconcile storms on one order. Every test
// asserts EXACTLY-ONCE crediting (run with -race in CI).
package payment_test

import (
	"context"
	"fmt"
	"sync"
	"testing"

	"github.com/nexau-cloud/nexau-api/internal/payment"
)

// TestConcurrent_CheckoutSameIdempotencyKey: 32 goroutines fire checkout
// with the SAME Idempotency-Key simultaneously (a quadruple-click plus
// network retries). Exactly ONE local order may exist afterwards.
func TestConcurrent_CheckoutSameIdempotencyKey(t *testing.T) {
	f := newFixture(t)
	pack := firstPack(t)

	const n = 32
	var wg sync.WaitGroup
	start := make(chan struct{})
	orders := make([]*payment.Order, n)
	errs := make([]error, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			orders[i], errs[i] = f.svc.Checkout(context.Background(), tenantA, userA, pack.ID, "race-key")
		}(i)
	}
	close(start)
	wg.Wait()

	// All callers must SUCCEED (idempotent replay semantics) and all
	// non-nil orders must be THE SAME order.
	var first *payment.Order
	for i := range errs {
		if errs[i] != nil {
			t.Fatalf("goroutine %d failed: %v", i, errs[i])
		}
		if first == nil {
			first = orders[i]
		} else if orders[i].ID != first.ID {
			t.Fatalf("two different orders minted for one idempotency key: %s vs %s", first.ID, orders[i].ID)
		}
	}
	// Exactly one row in the store.
	f.store.mu.Lock()
	rows := 0
	for _, o := range f.store.orders {
		if o.TenantID == tenantA && o.PackID == pack.ID {
			rows++
		}
	}
	f.store.mu.Unlock()
	if rows != 1 {
		t.Fatalf("store holds %d orders for one idempotency key, want 1", rows)
	}
}

// TestConcurrent_ConfirmWebhookReconcileStorm: one paid order, three
// competing completion paths × 12 goroutines each. EXACTLY ONE credit.
func TestConcurrent_ConfirmWebhookReconcileStorm(t *testing.T) {
	f := newFixture(t)
	pack := firstPack(t)
	o, err := f.svc.Checkout(context.Background(), tenantA, userA, pack.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	payID := f.provider.Capture(o.ProviderOrderID)
	sig := f.provider.SignCheckout(o.ProviderOrderID, payID)

	const perPath = 12
	var wg sync.WaitGroup
	start := make(chan struct{})

	// Path 1: client confirms (browser posts the handshake).
	for i := 0; i < perPath; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, _ = f.svc.Confirm(context.Background(), tenantA, o.ProviderOrderID, payID, sig)
		}()
	}
	// Path 2: webhook deliveries (provider retries the same event id).
	for i := 0; i < perPath; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			body := payment.BuildWebhookBody(fmt.Sprintf("evt_storm_%d", i), payment.EventPaymentCaptured, o.ProviderOrderID, payID, pack.AmountPaise)
			_ = f.svc.HandleWebhook(context.Background(), body, f.provider.SignWebhook(body), "10.0.0.9")
		}()
	}
	// Path 3: reconciliation polls (status page hammering).
	for i := 0; i < perPath; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, _ = f.svc.GetOrder(context.Background(), tenantA, o.ID)
		}()
	}
	close(start)
	wg.Wait()

	if n := f.store.ledgerCountForOrder(o.ID); n != 1 {
		t.Fatalf("EXACTLY-ONCE VIOLATED: %d ledger entries for order %s", n, o.ID)
	}
	b, _ := f.store.Balance(context.Background(), tenantA)
	if b.Balance != pack.Credits {
		t.Fatalf("EXACTLY-ONCE VIOLATED: balance = %d, want %d", b.Balance, pack.Credits)
	}
	got, _ := f.store.OrderByID(context.Background(), o.ID)
	if got.Status != payment.StatusPaid {
		t.Fatalf("final status = %s, want paid", got.Status)
	}
}

// TestConcurrent_ManyUsersManyOrders: 50 tenants × 4 checkouts + full
// payment lifecycle each, interleaved. Verifies per-tenant isolation of
// balances under load (each tenant must see EXACTLY their own credits).
func TestConcurrent_ManyUsersManyOrders(t *testing.T) {
	f := newFixture(t)
	packs := mustCatalog(t).Packs()

	const tenants = 50
	const perTenant = 4
	var wg sync.WaitGroup
	for tn := 0; tn < tenants; tn++ {
		tnID := fmt.Sprintf("ten_%02d", tn)
		wg.Add(1)
		go func(tnID string, tn int) {
			defer wg.Done()
			var wantCredits int64
			for i := 0; i < perTenant; i++ {
				pack := packs[i%len(packs)]
				o, err := f.svc.Checkout(context.Background(), tnID, "usr", pack.ID, fmt.Sprintf("k-%s-%d", tnID, i))
				if err != nil {
					t.Errorf("%s checkout %d: %v", tnID, i, err)
					return
				}
				payID := f.provider.Capture(o.ProviderOrderID)
				// Half via confirm, half via webhook — both must work out.
				if i%2 == 0 {
					sig := f.provider.SignCheckout(o.ProviderOrderID, payID)
					if _, err := f.svc.Confirm(context.Background(), tnID, o.ProviderOrderID, payID, sig); err != nil {
						t.Errorf("%s confirm %d: %v", tnID, i, err)
						return
					}
				} else {
					body := payment.BuildWebhookBody(fmt.Sprintf("evt_%s_%d", tnID, i), payment.EventPaymentCaptured, o.ProviderOrderID, payID, pack.AmountPaise)
					if err := f.svc.HandleWebhook(context.Background(), body, f.provider.SignWebhook(body), "10.0.0.5"); err != nil {
						t.Errorf("%s webhook %d: %v", tnID, i, err)
						return
					}
				}
				wantCredits += pack.Credits
			}
			b, err := f.store.Balance(context.Background(), tnID)
			if err != nil {
				t.Errorf("%s balance: %v", tnID, err)
				return
			}
			if b.Balance != wantCredits {
				t.Errorf("%s balance = %d, want %d", tnID, b.Balance, wantCredits)
			}
		}(tnID, tn)
	}
	wg.Wait()
}
