// phonepe_e2e_test.go — the full service wired to the REAL phonepe.Client
// against a wire-compatible fake PhonePe PG: checkout → redirect_url →
// confirm via merchant_transaction_id → signed X-VERIFY callback →
// duplicate → forged rejected → exactly-one activation; callback-only
// capture; failure path; reconcile recovery; amount-mismatch alarm.
package payment_test

import (
	"context"
	"testing"
	"time"

	"github.com/mash-cloud/mash-api/internal/payment"
	"github.com/mash-cloud/mash-api/internal/payment/phonepe"
)

func newPhonePeE2E(t *testing.T) (*payment.Service, *phonepe.Client, *fakePGServer) {
	t.Helper()
	fake := newPhonePeFakeServer(t)
	client := phonepe.New(phonepe.Config{
		MerchantID: fake.merchant, SaltKey: fake.saltKey, SaltIndex: fake.saltIndex,
		RedirectURL: "https://app.example.com/return", RedirectMode: "REDIRECT",
		CallbackURL: "https://api.example.com/v1/payments/webhook",
		BaseURL:     fake.url,
	})
	store := newFakeStore()
	svc := payment.New(payment.Config{
		Store: store, Provider: client, Catalog: mustCatalog(t),
		OrderTTL: time.Minute, SweepInterval: time.Hour, HistoryLimit: 10,
	})
	return svc, client, fake
}

func TestPhonePeE2E_FullLifecycle_PlansOnly(t *testing.T) {
	svc, client, fake := newPhonePeE2E(t)
	ctx := context.Background()
	sku := firstSKU(t)

	// 1. Checkout → merchantTransactionId + hosted PAY_PAGE redirect_url.
	o, err := svc.Checkout(ctx, tenantA, userA, sku.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	if o.Provider != payment.ProviderPhonepe || o.ProviderCheckoutURL == "" {
		t.Fatalf("phonepe handles missing: %+v", o)
	}
	if o.ProviderOrderID[:4] != "PAY-" {
		t.Fatalf("provider order id = %s, want PAY-…", o.ProviderOrderID)
	}

	// 2. The user pays on the hosted page; the SERVER-to-server callback
	// arrives signed (X-VERIFY over the base64 body).
	fake.capture(o.ProviderOrderID, sku.AmountPaise)
	callback := phonepe.BuildCallbackBody("PAYMENT_SUCCESS", o.ProviderOrderID, sku.AmountPaise)
	if err := svc.HandleWebhook(ctx, callback, client.SignCallback(callback), "10.9.8.7"); err != nil {
		t.Fatalf("signed callback rejected: %v", err)
	}

	// 3. Duplicate callback: acked, still exactly one activation.
	if err := svc.HandleWebhook(ctx, callback, client.SignCallback(callback), "10.9.8.7"); err != nil {
		t.Fatalf("duplicate callback rejected: %v", err)
	}

	// 4. The browser then lands and posts confirm with the
	// merchant_transaction_id spelling: settled success, no double stack.
	confirmed, err := svc.Confirm(ctx, tenantA, o.ProviderOrderID, o.ProviderOrderID, "")
	if err != nil {
		t.Fatal(err)
	}
	if confirmed.Status != payment.StatusPaid {
		t.Fatalf("confirm-after-callback status = %s", confirmed.Status)
	}

	// 5. Exactly-one activation of the plan.
	st, _ := svc.Subscription(ctx, tenantA)
	if st.Status != payment.SubActive || st.PlanCode != sku.PlanCode || st.DaysRemaining > sku.PeriodDays {
		t.Fatalf("subscription = %+v, want exactly one %s activation", st, sku.PlanCode)
	}
}

func TestPhonePeE2E_ForgedCallback_Rejected(t *testing.T) {
	svc, _, fake := newPhonePeE2E(t)
	ctx := context.Background()
	sku := firstSKU(t)

	o, err := svc.Checkout(ctx, tenantA, userA, sku.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	fake.capture(o.ProviderOrderID, sku.AmountPaise)
	callback := phonepe.BuildCallbackBody("PAYMENT_SUCCESS", o.ProviderOrderID, sku.AmountPaise)

	if err := svc.HandleWebhook(ctx, callback, "forged###1", "10.9.8.7"); err == nil {
		t.Fatal("forged X-VERIFY accepted")
	}
	if st, _ := svc.Subscription(ctx, tenantA); st.Status != payment.SubNone {
		t.Fatalf("forged callback activated a plan: %+v", st)
	}
}

func TestPhonePeE2E_FailurePath_NoActivation(t *testing.T) {
	svc, client, fake := newPhonePeE2E(t)
	ctx := context.Background()
	sku := firstSKU(t)

	o, err := svc.Checkout(ctx, tenantA, userA, sku.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	fake.fail(o.ProviderOrderID)
	callback := phonepe.BuildCallbackBody("PAYMENT_ERROR", o.ProviderOrderID, sku.AmountPaise)
	if err := svc.HandleWebhook(ctx, callback, client.SignCallback(callback), "10.9.8.7"); err != nil {
		t.Fatal(err)
	}
	got, _ := svc.History(ctx, tenantA, 10)
	if len(got) != 1 || got[0].Status != payment.StatusFailed {
		t.Fatalf("order not failed: %+v", got)
	}
	if st, _ := svc.Subscription(ctx, tenantA); st.Status != payment.SubNone {
		t.Fatalf("failed payment activated a plan: %+v", st)
	}
}

func TestPhonePeE2E_MissedCallback_ReconcileRecovers(t *testing.T) {
	svc, _, fake := newPhonePeE2E(t)
	ctx := context.Background()
	sku := firstSKU(t)

	// The callback was LOST; the user paid. The order status view
	// read-through reconciles via the signed status API.
	o, err := svc.Checkout(ctx, tenantA, userA, sku.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	fake.capture(o.ProviderOrderID, sku.AmountPaise)

	got, err := svc.GetOrder(ctx, tenantA, o.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != payment.StatusPaid {
		t.Fatalf("reconcile missed the capture: %s", got.Status)
	}
	st, _ := svc.Subscription(ctx, tenantA)
	if st.Status != payment.SubActive {
		t.Fatalf("reconcile did not activate: %+v", st)
	}
}

func TestPhonePeE2E_AmountMismatch_TamperAlarm(t *testing.T) {
	svc, client, fake := newPhonePeE2E(t)
	ctx := context.Background()
	sku := firstSKU(t)

	o, err := svc.Checkout(ctx, tenantA, userA, sku.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	fake.capture(o.ProviderOrderID, sku.AmountPaise)
	// Correctly signed, but claims ₹1 for a ₹1,999 order.
	tampered := phonepe.BuildCallbackBody("PAYMENT_SUCCESS", o.ProviderOrderID, 100)
	if err := svc.HandleWebhook(ctx, tampered, client.SignCallback(tampered), "10.9.8.7"); err == nil {
		t.Fatal("amount-mismatched callback accepted")
	}
	got, _ := svc.History(ctx, tenantA, 10)
	if got[0].Status != payment.StatusPending {
		t.Fatalf("tampered amount mutated order: %s", got[0].Status)
	}
	if st, _ := svc.Subscription(ctx, tenantA); st.Status != payment.SubNone {
		t.Fatalf("tampered amount activated a plan: %+v", st)
	}
}
