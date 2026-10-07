// confirm_test.go — scenarios: the client handshake path (Razorpay
// Checkout.js posts order/payment/signature). Three-legged verification,
// tenant isolation, and confirm-after-webhook idempotency.
package payment_test

import (
	"context"
	"testing"

	"github.com/mash-cloud/mash-api/internal/payment"
)

func TestConfirm_HappyPath_CreditsApplied(t *testing.T) {
	f := newFixture(t)
	pack := firstPack(t)

	o, err := f.svc.Checkout(context.Background(), tenantA, userA, pack.ID, "")
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
	b, _ := f.store.Balance(context.Background(), tenantA)
	if b.Balance != pack.Credits {
		t.Fatalf("balance = %d, want %d", b.Balance, pack.Credits)
	}
	if n := f.store.ledgerCountForOrder(o.ID); n != 1 {
		t.Fatalf("ledger entries = %d, want 1", n)
	}
}

func TestConfirm_BadSignature_Rejected(t *testing.T) {
	f := newFixture(t)
	pack := firstPack(t)
	o, _ := f.svc.Checkout(context.Background(), tenantA, userA, pack.ID, "")
	payID := f.provider.Capture(o.ProviderOrderID)

	if _, err := f.svc.Confirm(context.Background(), tenantA, o.ProviderOrderID, payID, "deadbeef"); err == nil {
		t.Fatal("forged signature accepted")
	}
	// Order must remain pending (no state change from a bad handshake).
	got, _ := f.store.OrderByID(context.Background(), o.ID)
	if got.Status != payment.StatusPending {
		t.Fatalf("bad signature mutated order to %s", got.Status)
	}
}

func TestConfirm_TenantIsolation(t *testing.T) {
	f := newFixture(t)
	pack := firstPack(t)
	o, _ := f.svc.Checkout(context.Background(), tenantA, userA, pack.ID, "")
	payID := f.provider.Capture(o.ProviderOrderID)
	sig := f.provider.SignCheckout(o.ProviderOrderID, payID)

	// tenantB must NOT see or confirm tenantA's order (404, not 403).
	if _, err := f.svc.Confirm(context.Background(), tenantB, o.ProviderOrderID, payID, sig); err == nil {
		t.Fatal("cross-tenant confirm allowed")
	}
	if _, err := f.svc.GetOrder(context.Background(), tenantB, o.ID); err == nil {
		t.Fatal("cross-tenant read allowed")
	}
}

func TestConfirm_Idempotent_AfterWebhook(t *testing.T) {
	f := newFixture(t)
	pack := firstPack(t)
	o, _ := f.svc.Checkout(context.Background(), tenantA, userA, pack.ID, "")
	payID := f.provider.Capture(o.ProviderOrderID)
	sig := f.provider.SignCheckout(o.ProviderOrderID, payID)

	// Webhook wins first.
	body := payment.BuildWebhookBody("evt_c1", payment.EventPaymentCaptured, o.ProviderOrderID, payID, pack.AmountPaise)
	if err := f.svc.HandleWebhook(context.Background(), body, f.provider.SignWebhook(body), "10.0.0.1"); err != nil {
		t.Fatal(err)
	}
	// Confirm after webhook → success, NOT conflict, no double credit.
	confirmed, err := f.svc.Confirm(context.Background(), tenantA, o.ProviderOrderID, payID, sig)
	if err != nil {
		t.Fatalf("confirm after webhook failed: %v", err)
	}
	if confirmed.Status != payment.StatusPaid {
		t.Fatalf("status = %s", confirmed.Status)
	}
	if n := f.store.ledgerCountForOrder(o.ID); n != 1 {
		t.Fatalf("ledger entries = %d, want 1 (double credit!)", n)
	}
	b, _ := f.store.Balance(context.Background(), tenantA)
	if b.Balance != pack.Credits {
		t.Fatalf("balance = %d, want exactly %d", b.Balance, pack.Credits)
	}
}
