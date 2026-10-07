package payment

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"
)

// MockProvider — a Provider with no network, no keys, no cost. Two uses:
//
//  1. NEXAU_PAYMENT_PROVIDER=mock — a fully working dev mode: checkout,
//     confirm, webhook, reconcile all run against in-memory state, with
//     REAL HMAC signatures (fixed dev secrets) so the security path is
//     exercised identically to production.
//  2. Tests — deterministic lifecycle control via Capture/Fail/Expire.
//
// It speaks the razorpay webhook envelope (mock.ParseWebhook), so webhook
// handling code is identical in mock and razorpay modes.
type MockProvider struct {
	mu       sync.Mutex
	seq      int
	orders   map[string]*mockOrder
	payments map[string]*ProviderPayment

	// KeySecret signs checkout handshakes; WebhookSecret signs webhooks.
	// Defaults are fixed DEV VALUES — never secrets in any real sense,
	// but the HMAC code paths run for real.
	KeySecret     string
	WebhookSecret string

	// AutoCapture: when > 0, every created order captures itself after the
	// delay (dev mode: watch the order flip to paid without any client).
	AutoCapture time.Duration
}

type mockOrder struct {
	id          string
	amountPaise int64
	status      string // created | paid | attempted
	paymentID   string
	createdAt   time.Time
}

// NewMockProvider builds the mock with standard dev secrets.
func NewMockProvider() *MockProvider {
	return &MockProvider{
		orders:        map[string]*mockOrder{},
		payments:      map[string]*ProviderPayment{},
		KeySecret:     "mock_key_secret_dev",
		WebhookSecret: "mock_webhook_secret_dev",
	}
}

// Name implements Provider.
func (m *MockProvider) Name() string { return ProviderMock }

// PublicKeyID implements Provider — a visibly-fake test-mode key.
func (m *MockProvider) PublicKeyID() string { return "rzp_test_mock_dev" }

// CreateOrder implements Provider (single-shot, like the real client).
func (m *MockProvider) CreateOrder(_ context.Context, req CreateOrderRequest) (*ProviderOrder, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.seq++
	id := fmt.Sprintf("order_mock_%08d", m.seq)
	m.orders[id] = &mockOrder{id: id, amountPaise: req.AmountPaise, status: "created", createdAt: time.Now().UTC()}
	if m.AutoCapture > 0 {
		time.AfterFunc(m.AutoCapture, func() { m.Capture(id) })
	}
	return &ProviderOrder{ID: id, Status: "created", AmountPaise: req.AmountPaise, Currency: req.Currency}, nil
}

// FetchOrder implements Provider.
func (m *MockProvider) FetchOrder(_ context.Context, providerOrderID string) (*ProviderOrder, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	o, ok := m.orders[providerOrderID]
	if !ok {
		return nil, &ProviderError{Kind: ProviderErrRequest, Detail: "order not found: " + providerOrderID}
	}
	return &ProviderOrder{ID: o.id, Status: o.status, AmountPaise: o.amountPaise, Currency: "INR"}, nil
}

// FetchOrderPayments implements Provider — the captured payment when the
// mock order is paid, else none.
func (m *MockProvider) FetchOrderPayments(_ context.Context, providerOrderID string) ([]*ProviderPayment, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	o, ok := m.orders[providerOrderID]
	if !ok || o.status != "paid" || o.paymentID == "" {
		return nil, nil
	}
	p := *m.payments[o.paymentID]
	return []*ProviderPayment{&p}, nil
}

// FetchPayment implements Provider.
func (m *MockProvider) FetchPayment(_ context.Context, providerPaymentID string) (*ProviderPayment, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	p, ok := m.payments[providerPaymentID]
	if !ok {
		return nil, &ProviderError{Kind: ProviderErrRequest, Detail: "payment not found: " + providerPaymentID}
	}
	cp := *p
	return &cp, nil
}

// VerifyCheckoutSignature implements Provider — REAL HMAC (shared
// implementation, payment/hmac.go) over the same string razorpay uses.
func (m *MockProvider) VerifyCheckoutSignature(orderID, paymentID, signature string) bool {
	return VerifySignedHex(SignCheckout(orderID, paymentID, m.KeySecret), signature)
}

// VerifyWebhookSignature implements Provider — REAL HMAC(raw, secret).
func (m *MockProvider) VerifyWebhookSignature(body []byte, signature string) bool {
	return VerifySignedHex(SignWebhook(body, m.WebhookSecret), signature)
}

// ParseWebhook implements Provider — parses the razorpay-shaped envelope
// (mock mode speaks the same wire format so webhook code paths are shared).
func (m *MockProvider) ParseWebhook(body []byte) (*WebhookEvent, error) {
	ev, err := ParseWebhookEnvelope(body)
	if ev != nil {
		ev.Provider = m.Name()
	}
	return ev, err
}

// --- deterministic lifecycle control (tests + dev) --------------------------

// Capture marks the provider order paid and mints the payment record.
// Returns the payment id — tests sign it into confirm handshakes and
// webhook payloads. Idempotent: capturing a paid order returns the same
// payment id (mirrors the provider's at-least-once reality).
func (m *MockProvider) Capture(providerOrderID string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	o, ok := m.orders[providerOrderID]
	if !ok {
		return ""
	}
	if o.status == "paid" {
		return o.paymentID
	}
	m.seq++
	payID := fmt.Sprintf("pay_mock_%08d", m.seq)
	o.status = "paid"
	o.paymentID = payID
	m.payments[payID] = &ProviderPayment{
		ID: payID, OrderID: o.id, Status: "captured",
		AmountPaise: o.amountPaise, Currency: "INR", Captured: true,
		Method: "mock", CreatedAt: time.Now().UTC(),
	}
	return payID
}

// Fail marks the provider order attempted (payment failed) — the order
// stays resolvable; only webhook payment.failed flips local state.
func (m *MockProvider) Fail(providerOrderID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if o, ok := m.orders[providerOrderID]; ok && o.status != "paid" {
		o.status = "attempted"
	}
}

// SignCheckout produces the HMAC the client WOULD have produced — for
// confirm-path tests.
func (m *MockProvider) SignCheckout(orderID, paymentID string) string {
	return SignCheckout(orderID, paymentID, m.KeySecret)
}

// SignWebhook produces a valid webhook signature for a raw body — tests
// POST to the real endpoint with this.
func (m *MockProvider) SignWebhook(body []byte) string {
	return SignWebhook(body, m.WebhookSecret)
}

// webhookEnvelope is the razorpay-shaped webhook wire format (mock mode
// speaks it so webhook code paths are shared end-to-end).
type webhookEnvelope struct {
	Event     string         `json:"event"`
	ID        string         `json:"id"`
	CreatedAt int64          `json:"created_at"`
	Payload   webhookPayload `json:"payload"`
}

type webhookPayload struct {
	Payment *entityRef[webhookPayment] `json:"payment"`
	Order   *entityRef[webhookOrder]   `json:"order"`
}

type entityRef[T any] struct {
	Entity T `json:"entity"`
}

type webhookPayment struct {
	ID      string `json:"id"`
	OrderID string `json:"order_id"`
	Status  string `json:"status"`
	Amount  int64  `json:"amount"`
}

type webhookOrder struct {
	ID     string `json:"id"`
	Amount int64  `json:"amount"`
	Status string `json:"status"`
}

// BuildWebhookBody renders a webhook payload ready for signing (tests POST
// this to /v1/payments/webhook with a signature from SignWebhook).
func BuildWebhookBody(eventID, eventType, orderID, paymentID string, amountPaise int64) []byte {
	env := webhookEnvelope{Event: eventType, ID: eventID, CreatedAt: time.Now().Unix()}
	switch eventType {
	case EventPaymentCaptured, EventPaymentFailed:
		env.Payload.Payment = &entityRef[webhookPayment]{Entity: webhookPayment{
			ID: paymentID, OrderID: orderID, Status: statusForEvent(eventType), Amount: amountPaise,
		}}
	case EventOrderPaid:
		env.Payload.Order = &entityRef[webhookOrder]{Entity: webhookOrder{
			ID: orderID, Amount: amountPaise, Status: "paid",
		}}
	}
	b, _ := json.Marshal(env)
	return b
}

func statusForEvent(eventType string) string {
	if eventType == EventPaymentCaptured {
		return "captured"
	}
	return "failed"
}

// ParseWebhookEnvelope normalizes the razorpay-shaped webhook envelope.
// Shared by MockProvider and razorpay.Provider so both accept byte-
// identical payloads — webhook handling code paths cannot drift.
func ParseWebhookEnvelope(body []byte) (*WebhookEvent, error) {
	var env webhookEnvelope
	if err := json.Unmarshal(body, &env); err != nil {
		return nil, err
	}
	if env.ID == "" || env.Event == "" {
		return nil, fmt.Errorf("payment: webhook envelope missing id/event")
	}
	ev := &WebhookEvent{
		EventID:  env.ID,
		Provider: "",
		Type:     env.Event,
		Raw:      body,
	}
	if p := env.Payload.Payment; p != nil {
		ev.ProviderPaymentID = p.Entity.ID
		ev.ProviderOrderID = p.Entity.OrderID
		ev.Status = p.Entity.Status
		ev.AmountPaise = p.Entity.Amount
		ev.Captured = p.Entity.Status == "captured"
	}
	if o := env.Payload.Order; o != nil && ev.ProviderOrderID == "" {
		ev.ProviderOrderID = o.Entity.ID
		ev.AmountPaise = o.Entity.Amount
		ev.Captured = o.Entity.Status == "paid"
	}
	return ev, nil
}

// Compile-time interface check.
var _ Provider = (*MockProvider)(nil)
