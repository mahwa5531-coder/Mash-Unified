// confirm_test.go — scenarios: the client handshake path (the provider
// completion fields posted by the browser). Three-legged verification,
// tenant isolation, confirm-after-webhook idempotency, and subscription
// activation on success.
package payment_test

import (
	"context"
	"testing"
	"time"

	"github.com/mash-cloud/mash-api/internal/payment"
)

func TestConfirm_HappyPath_PlanActivated(t *testing.T) {
	f := newFixture(t)
	sku := firstSKU(t)

	o, err := f.svc.Checkout(context.Background(), tenantA, userA, sku.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	payID := f.provider.Capture(o.ProviderOrderID)
	sig := f.provider.SignCheckout(o.ProviderOrderID, payID)

	confirmed, err := f.svc.Confirm(context.Background(), tenantA, o.ProviderOrderID, payID, sig)
	if err != nil {
		t.Fatal(err)
	}
	if confirmed.Status != payment.StatusPaid || confirmed.PaidAt == nil {
		t.Fatalf("order not paid: %+v", confirmed)
	}
	// The plan activated: effective subscription = pro, ~sku period left.
	st, _ := f.store.Subscription(context.Background(), tenantA)
	if st.Status != payment.SubActive || st.PlanCode != sku.PlanCode {
		t.Fatalf("subscription not activated: %+v", st)
	}
	if st.DaysRemaining < sku.PeriodDays-1 || st.DaysRemaining > sku.PeriodDays {
		t.Fatalf("days remaining = %d, want ~%d", st.DaysRemaining, sku.PeriodDays)
	}
}

func TestConfirm_ForgedSignature_Rejected(t *testing.T) {
	f := newFixture(t)
	sku := firstSKU(t)

	o, _ := f.svc.Checkout(context.Background(), tenantA, userA, sku.ID, "")
	payID := f.provider.Capture(o.ProviderOrderID)

	if _, err := f.svc.Confirm(context.Background(), tenantA, o.ProviderOrderID, payID, "forged"); err == nil {
		t.Fatal("forged handshake accepted")
	}
	got, _ := f.store.OrderByID(context.Background(), o.ID)
	if got.Status != payment.StatusPending {
		t.Fatal("forged confirm mutated state")
	}
	if _, ok := f.store.subscriptionPeriodEnd(tenantA); ok {
		t.Fatal("forged confirm activated a plan")
	}
}

func TestConfirm_CrossTenant_Is404(t *testing.T) {
	f := newFixture(t)
	sku := firstSKU(t)

	o, _ := f.svc.Checkout(context.Background(), tenantA, userA, sku.ID, "")
	payID := f.provider.Capture(o.ProviderOrderID)
	sig := f.provider.SignCheckout(o.ProviderOrderID, payID)

	// tenantB confirms tenantA's order: identical 404, no existence oracle.
	if _, err := f.svc.Confirm(context.Background(), tenantB, o.ProviderOrderID, payID, sig); err == nil {
		t.Fatal("cross-tenant confirm accepted")
	}
	if _, ok := f.store.subscriptionPeriodEnd(tenantA); ok {
		t.Fatal("cross-tenant confirm activated a plan")
	}
}

func TestConfirm_AfterWebhook_ReturnsPaidOrder(t *testing.T) {
	f := newFixture(t)
	sku := firstSKU(t)

	o, _ := f.svc.Checkout(context.Background(), tenantA, userA, sku.ID, "")
	payID := f.provider.Capture(o.ProviderOrderID)

	// Webhook lands FIRST (normal production ordering).
	body := payment.BuildWebhookBody("evt_c1", payment.EventPaymentCaptured, o.ProviderOrderID, payID, sku.AmountPaise)
	if err := f.svc.HandleWebhook(context.Background(), body, f.provider.SignWebhook(body), "10.0.0.1"); err != nil {
		t.Fatal(err)
	}
	// Then the browser posts confirm: settled success, not conflict — and
	// CRITICALLY the plan activated exactly once (stacking must NOT fire).
	sig := f.provider.SignCheckout(o.ProviderOrderID, payID)
	confirmed, err := f.svc.Confirm(context.Background(), tenantA, o.ProviderOrderID, payID, sig)
	if err != nil {
		t.Fatal(err)
	}
	if confirmed.Status != payment.StatusPaid {
		t.Fatalf("confirm-after-webhook status = %s", confirmed.Status)
	}
	st, _ := f.store.Subscription(context.Background(), tenantA)
	if st.DaysRemaining > sku.PeriodDays {
		t.Fatalf("period stacked twice: %d days", st.DaysRemaining)
	}
}

func TestConfirm_StackingRenewals(t *testing.T) {
	f := newFixture(t)
	sku := firstSKU(t)
	ctx := context.Background()

	// First purchase: fresh activation.
	o1, _ := f.svc.Checkout(ctx, tenantA, userA, sku.ID, "")
	pay1 := f.provider.Capture(o1.ProviderOrderID)
	sig1 := f.provider.SignCheckout(o1.ProviderOrderID, pay1)
	if _, err := f.svc.Confirm(ctx, tenantA, o1.ProviderOrderID, pay1, sig1); err != nil {
		t.Fatal(err)
	}
	end1, _ := f.store.subscriptionPeriodEnd(tenantA)

	// Second purchase while active: periods STACK (no lost days).
	time.Sleep(10 * time.Millisecond)
	o2, _ := f.svc.Checkout(ctx, tenantA, userA, sku.ID, "")
	pay2 := f.provider.Capture(o2.ProviderOrderID)
	sig2 := f.provider.SignCheckout(o2.ProviderOrderID, pay2)
	if _, err := f.svc.Confirm(ctx, tenantA, o2.ProviderOrderID, pay2, sig2); err != nil {
		t.Fatal(err)
	}
	end2, _ := f.store.subscriptionPeriodEnd(tenantA)
	// Stacking: the second period rides on TOP of the first's end, so the
	// gap between the two ends is exactly ~one SKU period (not from-now).
	want := time.Duration(sku.PeriodDays)*24*time.Hour - time.Hour
	if got := end2.Sub(end1); got < want {
		t.Fatalf("stacked period = %v, want ~%v (one more SKU period on top of the existing end)", got, want)
	}
}
