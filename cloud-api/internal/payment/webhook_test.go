// webhook_test.go — scenarios: the provider webhook path (the money-moving
// one). Fail-closed signatures, duplicate deliveries, out-of-order events,
// amount tampering, orphan orders, unhandled event types, per-IP budget.
package payment_test

import (
	"context"
	"testing"
	"time"

	"github.com/mash-cloud/mash-api/internal/payment"
)

func TestWebhook_Captured_AppliesCredits(t *testing.T) {
	f := newFixture(t)
	pack := firstPack(t)
	o, _ := f.svc.Checkout(context.Background(), tenantA, userA, pack.ID, "")
	payID := f.provider.Capture(o.ProviderOrderID)

	body := payment.BuildWebhookBody("evt_w1", payment.EventPaymentCaptured, o.ProviderOrderID, payID, pack.AmountPaise)
	if err := f.svc.HandleWebhook(context.Background(), body, f.provider.SignWebhook(body), "10.0.0.1"); err != nil {
		t.Fatal(err)
	}
	got, _ := f.store.OrderByID(context.Background(), o.ID)
	if got.Status != payment.StatusPaid {
		t.Fatalf("status = %s, want paid", got.Status)
	}
	b, _ := f.store.Balance(context.Background(), tenantA)
	if b.Balance != pack.Credits {
		t.Fatalf("balance = %d, want %d", b.Balance, pack.Credits)
	}
}

func TestWebhook_BadSignature_FailClosed(t *testing.T) {
	f := newFixture(t)
	pack := firstPack(t)
	o, _ := f.svc.Checkout(context.Background(), tenantA, userA, pack.ID, "")
	payID := f.provider.Capture(o.ProviderOrderID)

	body := payment.BuildWebhookBody("evt_bad", payment.EventPaymentCaptured, o.ProviderOrderID, payID, pack.AmountPaise)
	if err := f.svc.HandleWebhook(context.Background(), body, "forged", "10.0.0.1"); err == nil {
		t.Fatal("forged webhook accepted")
	}
	got, _ := f.store.OrderByID(context.Background(), o.ID)
	if got.Status != payment.StatusPending {
		t.Fatal("forged webhook mutated state")
	}
}

func TestWebhook_Duplicate_NoDoubleCredit(t *testing.T) {
	f := newFixture(t)
	pack := firstPack(t)
	o, _ := f.svc.Checkout(context.Background(), tenantA, userA, pack.ID, "")
	payID := f.provider.Capture(o.ProviderOrderID)

	body := payment.BuildWebhookBody("evt_dup", payment.EventPaymentCaptured, o.ProviderOrderID, payID, pack.AmountPaise)
	sig := f.provider.SignWebhook(body)
	for i := 0; i < 3; i++ { // provider re-delivers
		if err := f.svc.HandleWebhook(context.Background(), body, sig, "10.0.0.1"); err != nil {
			t.Fatalf("delivery %d failed: %v", i+1, err)
		}
	}
	if n := f.store.ledgerCountForOrder(o.ID); n != 1 {
		t.Fatalf("ledger entries = %d, want 1", n)
	}
	b, _ := f.store.Balance(context.Background(), tenantA)
	if b.Balance != pack.Credits {
		t.Fatalf("balance = %d, want %d", b.Balance, pack.Credits)
	}
}

func TestWebhook_OutOfOrder_FailedAfterCaptured(t *testing.T) {
	f := newFixture(t)
	pack := firstPack(t)
	o, _ := f.svc.Checkout(context.Background(), tenantA, userA, pack.ID, "")
	payID := f.provider.Capture(o.ProviderOrderID)

	captured := payment.BuildWebhookBody("evt_o1", payment.EventPaymentCaptured, o.ProviderOrderID, payID, pack.AmountPaise)
	if err := f.svc.HandleWebhook(context.Background(), captured, f.provider.SignWebhook(captured), "10.0.0.1"); err != nil {
		t.Fatal(err)
	}
	// Late failure event must NOT regress the paid order.
	failed := payment.BuildWebhookBody("evt_o2", payment.EventPaymentFailed, o.ProviderOrderID, payID, pack.AmountPaise)
	if err := f.svc.HandleWebhook(context.Background(), failed, f.provider.SignWebhook(failed), "10.0.0.1"); err != nil {
		t.Fatalf("late failed event errored: %v", err)
	}
	got, _ := f.store.OrderByID(context.Background(), o.ID)
	if got.Status != payment.StatusPaid {
		t.Fatalf("paid order regressed to %s", got.Status)
	}
	b, _ := f.store.Balance(context.Background(), tenantA)
	if b.Balance != pack.Credits {
		t.Fatalf("balance changed after late failure: %d", b.Balance)
	}
}

func TestWebhook_AmountMismatch_TamperAlarm(t *testing.T) {
	f := newFixture(t)
	pack := firstPack(t)
	o, _ := f.svc.Checkout(context.Background(), tenantA, userA, pack.ID, "")
	payID := f.provider.Capture(o.ProviderOrderID)

	// Correctly signed, but claims ₹1 for a ₹500 order.
	tampered := payment.BuildWebhookBody("evt_tam", payment.EventPaymentCaptured, o.ProviderOrderID, payID, 100)
	if err := f.svc.HandleWebhook(context.Background(), tampered, f.provider.SignWebhook(tampered), "10.0.0.1"); err == nil {
		t.Fatal("amount-mismatched webhook accepted")
	}
	got, _ := f.store.OrderByID(context.Background(), o.ID)
	if got.Status != payment.StatusPending {
		t.Fatal("tampered amount mutated order")
	}
	if b, _ := f.store.Balance(context.Background(), tenantA); b.Balance != 0 {
		t.Fatalf("tampered amount minted credits: %d", b.Balance)
	}
}

func TestWebhook_OrphanOrder_AckedAndRecorded(t *testing.T) {
	f := newFixture(t)
	// No checkout — a webhook for an order we never created.
	body := payment.BuildWebhookBody("evt_orphan", payment.EventPaymentCaptured, "order_unknown", "pay_x", 50000)
	if err := f.svc.HandleWebhook(context.Background(), body, f.provider.SignWebhook(body), "10.0.0.1"); err != nil {
		t.Fatalf("orphan webhook must be acked, got error: %v", err)
	}
}

func TestWebhook_UnhandledEvent_RecordedIgnored(t *testing.T) {
	f := newFixture(t)
	body := payment.BuildWebhookBody("evt_refund", "payment.refunded", "order_x", "pay_y", 500)
	if err := f.svc.HandleWebhook(context.Background(), body, f.provider.SignWebhook(body), "10.0.0.1"); err != nil {
		t.Fatalf("refund event must be acked (v1), got: %v", err)
	}
}

func TestWebhook_PerIPBudget(t *testing.T) {
	f := newFixture(t)
	f.svc = payment.New(payment.Config{
		Store: f.store, Provider: f.provider, Catalog: mustCatalog(t),
		OrderTTL: time.Minute, SweepInterval: time.Hour, HistoryLimit: 10,
		CheckoutPerUser: 100, WebhookPerIP: 2, Limiter: &budgetLimiter{limit: 2},
	})
	body := payment.BuildWebhookBody("evt_ip1", payment.EventPaymentCaptured, "order_x", "pay_y", 500)
	sig := f.provider.SignWebhook(body)
	for i := 0; i < 2; i++ {
		if err := f.svc.HandleWebhook(context.Background(), body, sig, "1.2.3.4"); err != nil {
			t.Fatalf("webhook %d failed: %v", i, err)
		}
	}
	if err := f.svc.HandleWebhook(context.Background(), body, sig, "1.2.3.4"); err == nil {
		t.Fatal("webhook flood allowed past budget")
	}
}
