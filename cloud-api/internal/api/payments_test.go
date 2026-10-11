// payments_test.go — ROUTE-level scenarios through the REAL router + auth
// chain (stub verifier/resolver): catalog shape, 503-on-disabled, 401s,
// checkout validation/idempotency, confirm spellings, order status +
// read-through reconcile, history, subscription state, webhook signature
// handling, and the phonepe wire shape (redirect relay + X-VERIFY).
package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/mash-cloud/mash-api/internal/auth"
	"github.com/mash-cloud/mash-api/internal/config"
	"github.com/mash-cloud/mash-api/internal/domain"
	"github.com/mash-cloud/mash-api/internal/payment"
)

// --- stubs -------------------------------------------------------------------

type stubVerifier struct{}

func (stubVerifier) Verify(_ context.Context, token string) (*auth.Claims, error) {
	if token != "good-token" {
		return nil, domain.ErrUnauthorized(nil)
	}
	return &auth.Claims{Subject: "usr_1", TenantID: "ten_1", TokenID: "tok_1"}, nil
}

type stubResolver struct{}

func (stubResolver) Resolve(_ context.Context, _, _ string) (*auth.Identity, error) {
	return &auth.Identity{
		User:       auth.UserInfo{ID: "usr_1", Status: "active", EmailVerified: true},
		Tenant:     auth.TenantInfo{ID: "ten_1", Status: "active"},
		Membership: auth.MembershipInfo{Role: "owner", Status: "active"},
	}, nil
}

// apiFakeStore — a minimal in-memory payment.Store (the payment package's
// own fakeStore lives in its test package; this one mirrors the same SQL
// semantics for the route-level suite).
type apiFakeStore struct {
	mu         sync.Mutex
	orders     map[string]*payment.Order
	byProvider map[string]*payment.Order
	byIdem     map[string]*payment.Order
	events     map[string]bool
	subs       map[string]*apiFakeSub
	plans      map[string]bool
}

type apiFakeSub struct {
	planCode  string
	status    string
	periodEnd time.Time
}

func newAPIFakeStore() *apiFakeStore {
	return &apiFakeStore{
		orders:     map[string]*payment.Order{},
		byProvider: map[string]*payment.Order{},
		byIdem:     map[string]*payment.Order{},
		events:     map[string]bool{},
		subs:       map[string]*apiFakeSub{},
		plans:      map[string]bool{"free": true, "pro": true},
	}
}

func (f *apiFakeStore) CreateOrder(_ context.Context, o *payment.Order) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if o.IdempotencyKey != "" {
		if _, ok := f.byIdem[o.TenantID+"|"+o.IdempotencyKey]; ok {
			return payment.ErrOrderExistsIdem
		}
	}
	if _, ok := f.byProvider[o.Provider+"|"+o.ProviderOrderID]; ok {
		return payment.ErrOrderExistsProvider
	}
	f.orders[o.ID] = o
	f.byProvider[o.Provider+"|"+o.ProviderOrderID] = o
	if o.IdempotencyKey != "" {
		f.byIdem[o.TenantID+"|"+o.IdempotencyKey] = o
	}
	return nil
}

func (f *apiFakeStore) OrderByID(_ context.Context, id string) (*payment.Order, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if o, ok := f.orders[id]; ok {
		cp := *o
		return &cp, nil
	}
	return nil, payment.ErrNotFound
}

func (f *apiFakeStore) OrderByProviderID(_ context.Context, provider, providerOrderID string) (*payment.Order, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if o, ok := f.byProvider[provider+"|"+providerOrderID]; ok {
		cp := *o
		return &cp, nil
	}
	return nil, payment.ErrNotFound
}

func (f *apiFakeStore) OrderByIdempotencyKey(_ context.Context, tenantID, key string) (*payment.Order, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if o, ok := f.byIdem[tenantID+"|"+key]; ok {
		cp := *o
		return &cp, nil
	}
	return nil, payment.ErrNotFound
}

func (f *apiFakeStore) ListOrders(_ context.Context, tenantID string, limit int) ([]*payment.Order, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []*payment.Order
	for _, o := range f.orders {
		if o.TenantID == tenantID {
			cp := *o
			out = append(out, &cp)
		}
	}
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (f *apiFakeStore) MarkAttempted(_ context.Context, orderID, providerPaymentID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if o, ok := f.orders[orderID]; ok && o.Status == payment.StatusPending {
		o.Status = payment.StatusAttempted
		if providerPaymentID != "" {
			o.ProviderPaymentID = providerPaymentID
		}
	}
	return nil
}

func (f *apiFakeStore) ApplyPaid(_ context.Context, orderID, providerPaymentID string) (bool, *payment.Order, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	o, ok := f.orders[orderID]
	if !ok {
		return false, nil, payment.ErrNotFound
	}
	if o.Status == payment.StatusPaid {
		return false, o, nil
	}
	o.Status = payment.StatusPaid
	o.ProviderPaymentID = providerPaymentID
	now := time.Now().UTC()
	o.PaidAt = &now
	if o.PlanCode != "" && o.PeriodDays > 0 && f.plans[o.PlanCode] {
		if sub, exists := f.subs[o.TenantID]; exists && sub.periodEnd.After(now) {
			sub.planCode, sub.status = o.PlanCode, "active"
			sub.periodEnd = sub.periodEnd.Add(time.Duration(o.PeriodDays) * 24 * time.Hour)
		} else if sub, exists := f.subs[o.TenantID]; exists {
			sub.planCode, sub.status = o.PlanCode, "active"
			sub.periodEnd = now.Add(time.Duration(o.PeriodDays) * 24 * time.Hour)
		} else {
			f.subs[o.TenantID] = &apiFakeSub{planCode: o.PlanCode, status: "active",
				periodEnd: now.Add(time.Duration(o.PeriodDays) * 24 * time.Hour)}
		}
	}
	return true, o, nil
}

func (f *apiFakeStore) ApplyFailed(_ context.Context, orderID, reason string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if o, ok := f.orders[orderID]; ok && !payment.Terminal(o.Status) {
		o.Status = payment.StatusFailed
		o.FailureReason = reason
		return true, nil
	}
	return false, nil
}

func (f *apiFakeStore) ApplyExpired(_ context.Context, orderID string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if o, ok := f.orders[orderID]; ok && !payment.Terminal(o.Status) && !o.ExpiresAt.After(time.Now()) {
		o.Status = payment.StatusExpired
		return true, nil
	}
	return false, nil
}

func (f *apiFakeStore) ExpireStale(_ context.Context, now time.Time) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var n int64
	for _, o := range f.orders {
		if (o.Status == payment.StatusPending || o.Status == payment.StatusAttempted) && o.ExpiresAt.Before(now) {
			o.Status = payment.StatusExpired
			n++
		}
	}
	return n, nil
}

func (f *apiFakeStore) RecordWebhookEvent(_ context.Context, ev *payment.WebhookEvent) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.events[ev.EventID] {
		return true, nil
	}
	f.events[ev.EventID] = true
	return false, nil
}

func (f *apiFakeStore) PlanExists(_ context.Context, planCode string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.plans[planCode], nil
}

func (f *apiFakeStore) Subscription(_ context.Context, tenantID string) (*payment.SubscriptionState, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	st := &payment.SubscriptionState{TenantID: tenantID, Status: payment.SubNone}
	sub, ok := f.subs[tenantID]
	if !ok || !sub.periodEnd.After(time.Now()) {
		return st, nil
	}
	st.PlanCode, st.PlanName, st.Status = sub.planCode, "Pro", sub.status
	end := sub.periodEnd
	st.CurrentPeriodEnd = &end
	st.DaysRemaining = int(time.Until(end).Hours() / 24)
	return st, nil
}

func (f *apiFakeStore) ListOpenOrders(_ context.Context, limit int) ([]*payment.Order, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []*payment.Order
	for _, o := range f.orders {
		if o.Status == payment.StatusPending || o.Status == payment.StatusAttempted {
			cp := *o
			out = append(out, &cp)
		}
	}
	return out, nil
}

// stubRedirectProvider — a phonepe-shaped provider for route-level wire
// tests (redirect_url relay + X-VERIFY webhook + mTxn id translation).
type stubRedirectProvider struct {
	inner *payment.MockProvider
}

func (s *stubRedirectProvider) Name() string        { return payment.ProviderPhonepe }
func (s *stubRedirectProvider) PublicKeyID() string { return "MERCHANTUAT" }

func (s *stubRedirectProvider) CreateOrder(ctx context.Context, req payment.CreateOrderRequest) (*payment.ProviderOrder, error) {
	po, err := s.inner.CreateOrder(ctx, req)
	if err != nil {
		return nil, err
	}
	po.ID = "PAY-" + po.ID[len("order_"):] // phonepe-shaped mTxn
	po.CheckoutURL = "https://mercury-till.phonepe.com/transact?token=route"
	return po, nil
}

// toInnerID maps the phonepe-shaped mTxn back to the mock's order id.
func (s *stubRedirectProvider) toInnerID(id string) string {
	return "order_" + strings.TrimPrefix(id, "PAY-")
}

func (s *stubRedirectProvider) FetchOrder(ctx context.Context, id string) (*payment.ProviderOrder, error) {
	return s.inner.FetchOrder(ctx, s.toInnerID(id))
}

// FetchPayment — phonepe semantics: the mTxn IS the payment reference;
// resolve the transaction's payment through the order-payments view.
func (s *stubRedirectProvider) FetchPayment(ctx context.Context, id string) (*payment.ProviderPayment, error) {
	pays, err := s.inner.FetchOrderPayments(ctx, s.toInnerID(id))
	if err != nil {
		return nil, err
	}
	if len(pays) == 0 {
		return nil, &payment.ProviderError{Kind: payment.ProviderErrRequest, Detail: "no payment on transaction " + id}
	}
	p := *pays[0]
	p.ID, p.OrderID = id, id // the mTxn plays both roles
	return &p, nil
}

func (s *stubRedirectProvider) FetchOrderPayments(ctx context.Context, id string) ([]*payment.ProviderPayment, error) {
	pays, err := s.inner.FetchOrderPayments(ctx, s.toInnerID(id))
	for _, p := range pays {
		p.ID, p.OrderID = id, id
	}
	return pays, err
}

func (s *stubRedirectProvider) VerifyCheckoutSignature(_, _, _ string) bool { return true } // no client scheme
func (s *stubRedirectProvider) VerifyWebhookSignature(body []byte, sig string) bool {
	return payment.VerifySignedHex(payment.SignWebhook(body, "route_secret"), sig)
}
func (s *stubRedirectProvider) ParseWebhook(body []byte) (*payment.WebhookEvent, error) {
	ev, err := payment.ParseWebhookEnvelope(body)
	if ev != nil {
		ev.Provider = s.Name()
	}
	return ev, err
}

// --- rig ---------------------------------------------------------------------

func newPaymentsAPI(t *testing.T, provider payment.Provider) (*API, *apiFakeStore) {
	t.Helper()
	catalog, err := payment.CatalogFromEnv("")
	if err != nil {
		t.Fatal(err)
	}
	store := newAPIFakeStore()
	paySvc := payment.New(payment.Config{
		Store: store, Provider: provider, Catalog: catalog,
		OrderTTL: 15 * time.Minute, SweepInterval: time.Hour, HistoryLimit: 50,
		CheckoutPerUser: 100, WebhookPerIP: 1000,
	})
	authMW := auth.Middleware{Verifier: stubVerifier{}, Resolver: stubResolver{}, AuthTimeout: 2 * time.Second}
	cfg := &config.Config{}
	apiObj := New(cfg, nil, authMW, nil, nil, nil, nil, nil, nil, nil, nil, paySvc)
	return apiObj, store
}

func doReq(t *testing.T, h http.Handler, method, path, token string, body any) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	var rdr *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = bytes.NewReader(b)
	} else {
		rdr = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, rdr)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	out := map[string]any{}
	if w.Body.Len() > 0 {
		_ = json.Unmarshal(w.Body.Bytes(), &out)
	}
	return w, out
}

func doReqIdem(t *testing.T, h http.Handler, skuID, key string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest("POST", "/v1/payments/checkout", bytes.NewBufferString(fmt.Sprintf(`{"sku_id":%q}`, skuID)))
	req.Header.Set("Authorization", "Bearer good-token")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", key)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w
}

func postWebhookHeader(t *testing.T, h http.Handler, body []byte, sig, header string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest("POST", "/v1/payments/webhook", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if sig != "" {
		req.Header.Set(header, sig)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w
}

func postWebhook(t *testing.T, h http.Handler, body []byte, sig string) *httptest.ResponseRecorder {
	t.Helper()
	return postWebhookHeader(t, h, body, sig, "X-Razorpay-Signature")
}

// --- scenarios ----------------------------------------------------------------

func TestPaymentsRoutes_CatalogShape(t *testing.T) {
	a, _ := newPaymentsAPI(t, payment.NewMockProvider())
	w, body := doReq(t, a.Router(), "GET", "/v1/payments/catalog", "good-token", nil)
	if w.Code != 200 {
		t.Fatalf("code = %d: %v", w.Code, body)
	}
	skus, ok := body["skus"].([]any)
	if !ok || len(skus) != 2 {
		t.Fatalf("skus = %v", body["skus"])
	}
	first, _ := skus[0].(map[string]any)
	if first["plan_code"] != "pro" || first["period_days"] == nil {
		t.Fatalf("sku shape (plans only): %v", first)
	}
	if _, has := first["credits"]; has {
		t.Fatal("credits leaked into the SKU shape — plans only")
	}
}

func TestPaymentsRoutes_Disabled503AndUnauthenticated401(t *testing.T) {
	a, _ := newPaymentsAPI(t, payment.NewMockProvider())
	router := a.Router()
	// Disabled: a payments-less API on the same paths.
	disabled := New(&config.Config{}, nil,
		auth.Middleware{Verifier: stubVerifier{}, Resolver: stubResolver{}, AuthTimeout: time.Second},
		nil, nil, nil, nil, nil, nil, nil, nil, nil)
	for _, path := range []string{
		"/v1/payments/catalog", "/v1/payments/orders/pay_x", "/v1/payments/history", "/v1/payments/subscription",
	} {
		if w, _ := doReq(t, disabled.Router(), "GET", path, "good-token", nil); w.Code != 503 {
			t.Fatalf("GET %s disabled = %d, want 503", path, w.Code)
		}
	}
	if w, _ := doReq(t, disabled.Router(), "POST", "/v1/payments/checkout", "good-token", map[string]any{"sku_id": "plan_pro_1m"}); w.Code != 503 {
		t.Fatal("checkout disabled != 503")
	}
	// Unauthenticated on every authed route.
	for _, path := range []string{
		"/v1/payments/catalog", "/v1/payments/orders/pay_x", "/v1/payments/history", "/v1/payments/subscription",
	} {
		if w, _ := doReq(t, router, "GET", path, "", nil); w.Code != 401 {
			t.Fatalf("GET %s unauthenticated = %d, want 401", path, w.Code)
		}
	}
	if w, _ := doReq(t, router, "POST", "/v1/payments/checkout", "", map[string]any{"sku_id": "x"}); w.Code != 401 {
		t.Fatal("checkout unauthenticated != 401")
	}
}

func TestPaymentsRoutes_CheckoutLifecycle(t *testing.T) {
	a, _ := newPaymentsAPI(t, payment.NewMockProvider())
	router := a.Router()

	// Validation: empty body field.
	if w, body := doReq(t, router, "POST", "/v1/payments/checkout", "good-token", map[string]any{}); w.Code != 400 {
		t.Fatalf("empty sku_id = %d: %v", w.Code, body)
	}
	// Unknown SKU → 404 SKU_NOT_FOUND.
	if w, body := doReq(t, router, "POST", "/v1/payments/checkout", "good-token", map[string]any{"sku_id": "plan_nope"}); w.Code != 404 {
		t.Fatalf("unknown sku = %d: %v", w.Code, body)
	}
	// Happy path → 201 + order + key_id.
	w := doReqIdem(t, router, "plan_pro_1m", "route-key-1")
	if w.Code != 201 {
		t.Fatalf("checkout = %d: %s", w.Code, w.Body.String())
	}
	var created struct {
		Order struct {
			OrderID  string `json:"order_id"`
			PlanCode string `json:"plan_code"`
			Status   string `json:"status"`
		} `json:"order"`
		KeyID    string `json:"key_id"`
		Provider string `json:"provider"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &created)
	if created.Order.OrderID == "" || created.Order.PlanCode != "pro" || created.KeyID == "" {
		t.Fatalf("checkout response: %+v", created)
	}

	// Idempotent replay: same key → same order id.
	w2 := doReqIdem(t, router, "plan_pro_1m", "route-key-1")
	var replay struct {
		Order struct {
			OrderID string `json:"order_id"`
		} `json:"order"`
	}
	_ = json.Unmarshal(w2.Body.Bytes(), &replay)
	if replay.Order.OrderID != created.Order.OrderID {
		t.Fatalf("idempotent replay forked: %s vs %s", replay.Order.OrderID, created.Order.OrderID)
	}
	// Key reuse with a different sku → 422.
	if w := doReqIdem(t, router, "plan_pro_1y", "route-key-1"); w.Code != 422 {
		t.Fatalf("idem reuse = %d, want 422", w.Code)
	}
}

func TestPaymentsRoutes_SubscriptionAndOrderViews(t *testing.T) {
	a, store := newPaymentsAPI(t, payment.NewMockProvider())
	router := a.Router()
	ctx := context.Background()

	// Fresh tenant: the free default (SubNone).
	if w, body := doReq(t, router, "GET", "/v1/payments/subscription", "good-token", nil); w.Code != 200 || body["status"] != payment.SubNone {
		t.Fatalf("fresh subscription = %d %v", w.Code, body)
	}

	// Checkout + capture through the store → the subscription reads active.
	sku := a.payments.SKUs()[0]
	o, err := a.payments.Checkout(ctx, "ten_1", "usr_1", sku.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.ApplyPaid(ctx, o.ID, "pay_route_1"); err != nil {
		t.Fatal(err)
	}
	w, body := doReq(t, router, "GET", "/v1/payments/subscription", "good-token", nil)
	if w.Code != 200 || body["status"] != payment.SubActive || body["plan_code"] != "pro" {
		t.Fatalf("activated subscription = %d %v", w.Code, body)
	}
	if _, has := body["days_remaining"]; !has {
		t.Fatal("days_remaining missing")
	}

	// Order view: unknown → 404.
	if w, _ := doReq(t, router, "GET", "/v1/payments/orders/pay_ghost", "good-token", nil); w.Code != 404 {
		t.Fatal("unknown order != 404")
	}

	// History: the paid order shows the plan shape.
	w, histBody := doReq(t, router, "GET", "/v1/payments/history?limit=50", "good-token", nil)
	if w.Code != 200 {
		t.Fatalf("history = %d", w.Code)
	}
	orders, _ := histBody["orders"].([]any)
	if len(orders) != 1 {
		t.Fatalf("history orders = %d", len(orders))
	}
	first, _ := orders[0].(map[string]any)
	if first["sku_id"] != sku.ID || first["plan_code"] != "pro" {
		t.Fatalf("history shape (plans only): %v", first)
	}
}

func TestPaymentsRoutes_ConfirmSpellingsAndWebhook(t *testing.T) {
	mock := payment.NewMockProvider()
	a, _ := newPaymentsAPI(t, mock)
	router := a.Router()
	ctx := context.Background()

	sku := a.payments.SKUs()[0]
	o, err := a.payments.Checkout(ctx, "ten_1", "usr_1", sku.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	// Capture at the mock provider, sign the handshake the way razorpay
	// Checkout would.
	payID := mock.Capture(o.ProviderOrderID)
	sig := mock.SignCheckout(o.ProviderOrderID, payID)

	// Generic spelling.
	w, body := doReq(t, router, "POST", "/v1/payments/confirm", "good-token", map[string]any{
		"provider_order_id": o.ProviderOrderID, "provider_payment_id": payID, "provider_signature": sig,
	})
	if w.Code != 200 {
		t.Fatalf("generic confirm = %d: %v", w.Code, body)
	}

	// Second order through the legacy razorpay_* spelling.
	o2, _ := a.payments.Checkout(ctx, "ten_1", "usr_1", sku.ID, "")
	pay2 := mock.Capture(o2.ProviderOrderID)
	sig2 := mock.SignCheckout(o2.ProviderOrderID, pay2)
	w, body = doReq(t, router, "POST", "/v1/payments/confirm", "good-token", map[string]any{
		"razorpay_order_id": o2.ProviderOrderID, "razorpay_payment_id": pay2, "razorpay_signature": sig2,
	})
	if w.Code != 200 {
		t.Fatalf("razorpay confirm = %d: %v", w.Code, body)
	}

	// Forged signature → 400, order stays open.
	o3, _ := a.payments.Checkout(ctx, "ten_1", "usr_1", sku.ID, "")
	pay3 := mock.Capture(o3.ProviderOrderID)
	if w, _ := doReq(t, router, "POST", "/v1/payments/confirm", "good-token", map[string]any{
		"razorpay_order_id": o3.ProviderOrderID, "razorpay_payment_id": pay3, "razorpay_signature": "forged",
	}); w.Code != 400 {
		t.Fatalf("forged confirm = %d, want 400", w.Code)
	}

	// Webhook: unsigned → 401; signed → 200; duplicate → 200 (absorbed).
	body4 := payment.BuildWebhookBody("evt_route_1", payment.EventPaymentCaptured, o3.ProviderOrderID, pay3, sku.AmountPaise)
	if w := postWebhook(t, router, body4, ""); w.Code != 401 {
		t.Fatal("unsigned webhook != 401")
	}
	if w := postWebhook(t, router, body4, mock.SignWebhook(body4)); w.Code != 200 {
		t.Fatal("signed webhook != 200")
	}
	if w := postWebhook(t, router, body4, mock.SignWebhook(body4)); w.Code != 200 {
		t.Fatal("duplicate webhook != 200")
	}
	// A distinct event on the already-paid order: absorbed (no double stack).
	body5 := payment.BuildWebhookBody("evt_route_2", payment.EventPaymentCaptured, o3.ProviderOrderID, pay3, sku.AmountPaise)
	if w := postWebhook(t, router, body5, mock.SignWebhook(body5)); w.Code != 200 {
		t.Fatal("distinct-event webhook != 200")
	}
	w, subBody := doReq(t, router, "GET", "/v1/payments/subscription", "good-token", nil)
	if w.Code != 200 || subBody["status"] != payment.SubActive {
		t.Fatalf("subscription after webhook storm = %d %v", w.Code, subBody)
	}
}

func TestPaymentsRoutes_PhonePeWireShape(t *testing.T) {
	mock := payment.NewMockProvider()
	a, _ := newPaymentsAPI(t, &stubRedirectProvider{inner: mock})
	router := a.Router()
	ctx := context.Background()

	sku := a.payments.SKUs()[0]
	o, err := a.payments.Checkout(ctx, "ten_1", "usr_1", sku.ID, "")
	if err != nil {
		t.Fatal(err)
	}

	// Route-level checkout relay carries the redirect_url (phonepe shape).
	w := doReqIdem(t, router, sku.ID, "")
	var created struct {
		RedirectURL string `json:"redirect_url"`
		Provider    string `json:"provider"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &created)
	if w.Code != 201 || created.RedirectURL == "" || created.Provider != payment.ProviderPhonepe {
		t.Fatalf("phonepe relay = %d %+v", w.Code, created)
	}

	// Confirm with the merchant_transaction_id spelling (no client secret).
	payID := mock.Capture("order_" + strings.TrimPrefix(o.ProviderOrderID, "PAY-"))
	w2, body := doReq(t, router, "POST", "/v1/payments/confirm", "good-token", map[string]any{
		"merchant_transaction_id": o.ProviderOrderID,
	})
	if w2.Code != 200 {
		t.Fatalf("phonepe confirm = %d: %v", w2.Code, body)
	}

	// X-VERIFY callback path: the header is resolved by provider name.
	cb := payment.BuildWebhookBody("evt_pp_route", payment.EventPaymentCaptured, o.ProviderOrderID, payID, sku.AmountPaise)
	sig := payment.SignWebhook(cb, "route_secret")
	if w3 := postWebhookHeader(t, router, cb, sig, "X-VERIFY"); w3.Code != 200 {
		t.Fatal("X-VERIFY callback != 200")
	}
	// Forged X-VERIFY: 401.
	if w4 := postWebhookHeader(t, router, cb, "forged", "X-VERIFY"); w4.Code != 401 {
		t.Fatal("forged X-VERIFY callback != 401")
	}
}

func TestPaymentsRoutes_OrderStatusReadThroughReconcile(t *testing.T) {
	mock := payment.NewMockProvider()
	a, _ := newPaymentsAPI(t, mock)
	router := a.Router()
	ctx := context.Background()

	sku := a.payments.SKUs()[0]
	o, err := a.payments.Checkout(ctx, "ten_1", "usr_1", sku.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	// The provider captured but NO webhook arrived: the GET order view
	// reconciles (read-through).
	mock.Capture(o.ProviderOrderID)
	w, body := doReq(t, router, "GET", "/v1/payments/orders/"+o.ID, "good-token", nil)
	if w.Code != 200 {
		t.Fatalf("order view = %d", w.Code)
	}
	order, _ := body["order"].(map[string]any)
	if order["status"] != payment.StatusPaid {
		t.Fatalf("read-through reconcile missed the capture: %v", order["status"])
	}
	// The plan activated via the reconcile path.
	w, sub := doReq(t, router, "GET", "/v1/payments/subscription", "good-token", nil)
	if sub["status"] != payment.SubActive {
		t.Fatalf("subscription after reconcile = %v", sub)
	}
}
