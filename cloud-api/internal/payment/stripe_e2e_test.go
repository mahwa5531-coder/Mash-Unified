// stripe_e2e_test.go — the full service wired to the REAL stripe.Client
// against a wire-compatible fake Stripe API: checkout → client_secret →
// confirm via intent fetch → signed webhook → duplicate → forged/stale
// rejected → exactly-one activation; plus reconcile recovery.
package payment_test

import (
	"context"
	"testing"
	"time"

	"github.com/mash-cloud/mash-api/internal/payment"
	"github.com/mash-cloud/mash-api/internal/payment/stripe"
)

func newStripeE2E(t *testing.T) (*payment.Service, *stripe.Client, *fakeStripeServer) {
	t.Helper()
	fake := newStripeFakeServer(t)
	client := stripe.New(stripe.Config{
		APIKey: fake.apiKey, PublishableKey: "pk_test_E2E",
		WebhookSecret: "whsec_e2e", BaseURL: fake.url,
	})
	store := newFakeStore()
	svc := payment.New(payment.Config{
		Store: store, Provider: client, Catalog: mustCatalog(t),
		OrderTTL: time.Minute, SweepInterval: time.Hour, HistoryLimit: 10,
	})
	return svc, client, fake
}

func TestStripeE2E_FullLifecycle_PlansOnly(t *testing.T) {
	svc, client, fake := newStripeE2E(t)
	ctx := context.Background()
	sku := firstSKU(t)

	// 1. Checkout → intent id + client_secret relay.
	o, err := svc.Checkout(ctx, tenantA, userA, sku.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	if o.Provider != payment.ProviderStripe || o.ProviderClientSecret == "" {
		t.Fatalf("stripe handles missing: %+v", o)
	}

	// 2. Complete the intent at the "provider", then confirm via the
	// payment_intent_id spelling (no client HMAC — fetch is the authority).
	payID := fake.succeedIntent(o.ProviderOrderID)
	confirmed, err := svc.Confirm(ctx, tenantA, o.ProviderOrderID, payID, "")
	if err != nil {
		t.Fatal(err)
	}
	if confirmed.Status != payment.StatusPaid {
		t.Fatalf("status = %s", confirmed.Status)
	}

	// 3. Signed webhook AFTER confirm (production ordering): acked, no
	// double activation.
	body := fake.buildEvent("evt_e2e_1", "payment_intent.succeeded", o.ProviderOrderID, sku.AmountPaise)
	if err := svc.HandleWebhook(ctx, body, client.SignWebhookBody(body, time.Now()), "127.0.0.1"); err != nil {
		t.Fatalf("signed webhook rejected: %v", err)
	}
	// 4. Duplicate delivery: acked, still exactly one activation.
	if err := svc.HandleWebhook(ctx, body, client.SignWebhookBody(body, time.Now()), "127.0.0.1"); err != nil {
		t.Fatalf("duplicate delivery rejected: %v", err)
	}

	// 5. Exactly-one activation.
	st, _ := svc.Subscription(ctx, tenantA)
	if st.Status != payment.SubActive || st.PlanCode != sku.PlanCode || st.DaysRemaining > sku.PeriodDays {
		t.Fatalf("subscription = %+v, want exactly one %s activation", st, sku.PlanCode)
	}
}

func TestStripeE2E_ForgedAndStaleWebhooks_Rejected(t *testing.T) {
	svc, client, fake := newStripeE2E(t)
	ctx := context.Background()
	sku := firstSKU(t)

	o, _ := svc.Checkout(ctx, tenantA, userA, sku.ID, "")
	body := fake.buildEvent("evt_f1", "payment_intent.succeeded", o.ProviderOrderID, sku.AmountPaise)

	// Forged signature: fail closed.
	if err := svc.HandleWebhook(ctx, body, "t=1,v1=forged", "127.0.0.1"); err == nil {
		t.Fatal("forged webhook accepted")
	}
	// Stale timestamp (replay): fail closed.
	stale := client.SignWebhookBody(body, time.Now().Add(-10*time.Minute))
	if err := svc.HandleWebhook(ctx, body, stale, "127.0.0.1"); err == nil {
		t.Fatal("stale webhook accepted")
	}
	if st, _ := svc.Subscription(ctx, tenantA); st.Status != payment.SubNone {
		t.Fatalf("rejected webhook activated a plan: %+v", st)
	}
}

func TestStripeE2E_CallbackOnlyCapture_ReconcileRecovers(t *testing.T) {
	svc, client, fake := newStripeE2E(t)
	ctx := context.Background()
	sku := firstSKU(t)

	// The webhook was LOST: the user paid (intent succeeded upstream) but
	// no event ever arrived. The order status view (GET) read-through
	// reconciles via the intent fetch.
	o, err := svc.Checkout(ctx, tenantA, userA, sku.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	fake.succeedIntent(o.ProviderOrderID)

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
	_ = client
}
