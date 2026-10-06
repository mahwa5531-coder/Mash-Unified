package api

import (
	"io"
	"net/http"
	"strconv"

	"github.com/nexau-cloud/nexau-api/internal/auth"
	"github.com/nexau-cloud/nexau-api/internal/domain"
	"github.com/nexau-cloud/nexau-api/internal/payment"
)

// Payment handlers (mounted only when the payment service is enabled —
// the router checks a.payments != nil; disabled deployments answer
// 503 PAYMENTS_DISABLED on the same paths, keeping the contract stable).
//
// Surface (design §10):
//
//	GET  /v1/payments/catalog         purchasable packs
//	POST /v1/payments/checkout        create order (Idempotency-Key honored)
//	POST /v1/payments/confirm         Razorpay Checkout handshake
//	GET  /v1/payments/orders/{id}     order status (reconciles if pending)
//	GET  /v1/payments/history         tenant orders, newest first
//	GET  /v1/payments/balance         credit balance + last top-up
//	POST /v1/payments/webhook         provider events (HMAC is the auth)
//
// Handlers stay thin: decode → service → encode. Money decisions never
// live here.

func (a *API) paymentsEnabled() bool {
	return a.payments != nil && a.payments.Enabled()
}

// handlePaymentCatalog: GET /v1/payments/catalog
func (a *API) handlePaymentCatalog(w http.ResponseWriter, r *http.Request) {
	if !a.paymentsEnabled() {
		writeError(w, r, payment.ErrDisabled)
		return
	}
	packs := a.payments.Packs()
	out := make([]payment.Pack, len(packs))
	copy(out, packs)
	writeOK(w, map[string]any{"packs": out})
}

// handlePaymentCheckout: POST /v1/payments/checkout {pack_id}
//
// Idempotency-Key is honored (strongly recommended for every client:
// network retries must never fork orders).
func (a *API) handlePaymentCheckout(w http.ResponseWriter, r *http.Request) {
	if !a.paymentsEnabled() {
		writeError(w, r, payment.ErrDisabled)
		return
	}
	idn := auth.FromIdentity(r.Context())
	if idn == nil {
		writeError(w, r, domain.ErrUnauthorized(nil))
		return
	}
	var req struct {
		PackID string `json:"pack_id"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, domain.ErrValidation("malformed JSON body"))
		return
	}
	if req.PackID == "" {
		writeError(w, r, domain.ErrValidation("pack_id is required"))
		return
	}

	o, err := a.payments.Checkout(r.Context(), idn.Tenant.ID, idn.User.ID,
		req.PackID, r.Header.Get("Idempotency-Key"))
	if err != nil {
		writeError(w, r, domain.AsError(err))
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"order":             o.ClientViewOf(),
		"key_id":            a.payments.PublicKeyID(), // public by design (Checkout.js)
		"provider":          o.Provider,
		"provider_order_id": o.ProviderOrderID,
	})
}

// handlePaymentConfirm: POST /v1/payments/confirm
//
// Body: the three fields Razorpay Checkout.js hands the browser.
func (a *API) handlePaymentConfirm(w http.ResponseWriter, r *http.Request) {
	if !a.paymentsEnabled() {
		writeError(w, r, payment.ErrDisabled)
		return
	}
	idn := auth.FromIdentity(r.Context())
	if idn == nil {
		writeError(w, r, domain.ErrUnauthorized(nil))
		return
	}
	var req struct {
		RazorpayOrderID   string `json:"razorpay_order_id"`
		RazorpayPaymentID string `json:"razorpay_payment_id"`
		RazorpaySignature string `json:"razorpay_signature"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, domain.ErrValidation("malformed JSON body"))
		return
	}
	if req.RazorpayOrderID == "" || req.RazorpayPaymentID == "" || req.RazorpaySignature == "" {
		writeError(w, r, domain.ErrValidation("razorpay_order_id, razorpay_payment_id and razorpay_signature are required"))
		return
	}

	o, err := a.payments.Confirm(r.Context(), idn.Tenant.ID,
		req.RazorpayOrderID, req.RazorpayPaymentID, req.RazorpaySignature)
	if err != nil {
		writeError(w, r, domain.AsError(err))
		return
	}
	writeOK(w, map[string]any{"order": o.ClientViewOf()})
}

// handlePaymentOrder: GET /v1/payments/orders/{order_id}
func (a *API) handlePaymentOrder(w http.ResponseWriter, r *http.Request) {
	if !a.paymentsEnabled() {
		writeError(w, r, payment.ErrDisabled)
		return
	}
	idn := auth.FromIdentity(r.Context())
	if idn == nil {
		writeError(w, r, domain.ErrUnauthorized(nil))
		return
	}
	o, err := a.payments.GetOrder(r.Context(), idn.Tenant.ID, r.PathValue("order_id"))
	if err != nil {
		writeError(w, r, domain.AsError(err))
		return
	}
	writeOK(w, map[string]any{"order": o.ClientViewOf()})
}

// handlePaymentHistory: GET /v1/payments/history?limit=
func (a *API) handlePaymentHistory(w http.ResponseWriter, r *http.Request) {
	if !a.paymentsEnabled() {
		writeError(w, r, payment.ErrDisabled)
		return
	}
	idn := auth.FromIdentity(r.Context())
	if idn == nil {
		writeError(w, r, domain.ErrUnauthorized(nil))
		return
	}
	limit := parseBoundedInt(r.URL.Query().Get("limit"), 1, 100, 50)
	orders, err := a.payments.History(r.Context(), idn.Tenant.ID, limit)
	if err != nil {
		writeError(w, r, domain.AsError(err))
		return
	}
	out := make([]payment.ClientView, 0, len(orders))
	for _, o := range orders {
		out = append(out, o.ClientViewOf())
	}
	writeOK(w, map[string]any{"orders": out})
}

// handlePaymentBalance: GET /v1/payments/balance
func (a *API) handlePaymentBalance(w http.ResponseWriter, r *http.Request) {
	if !a.paymentsEnabled() {
		writeError(w, r, payment.ErrDisabled)
		return
	}
	idn := auth.FromIdentity(r.Context())
	if idn == nil {
		writeError(w, r, domain.ErrUnauthorized(nil))
		return
	}
	b, err := a.payments.Balance(r.Context(), idn.Tenant.ID)
	if err != nil {
		writeError(w, r, domain.AsError(err))
		return
	}
	writeOK(w, b)
}

// handlePaymentWebhook: POST /v1/payments/webhook
//
// Unauthenticated by token BY DESIGN: the HMAC signature over the raw
// body is the route's entire authentication (design §13). The handler
// reads the raw bytes untouched (no decode/re-marshal — that would break
// the MAC), and only then hands off to the service.
func (a *API) handlePaymentWebhook(w http.ResponseWriter, r *http.Request) {
	if !a.paymentsEnabled() {
		writeError(w, r, payment.ErrDisabled)
		return
	}
	// Raw body, hard-capped (defense in depth: the global middleware
	// limit already applies; a provider bug must still not OOM us).
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeError(w, r, domain.ErrValidation("unreadable body"))
		return
	}
	ip := clientIP(r, a.cfg.TrustProxyHeaders)
	headerEventID := r.Header.Get("X-Razorpay-Event-Id")
	if err := a.payments.HandleWebhook(r.Context(), body,
		r.Header.Get("X-Razorpay-Signature"), ip, headerEventID); err != nil {
		writeError(w, r, domain.AsError(err))
		return
	}
	// 200 only after the state change has committed (service contract).
	w.WriteHeader(http.StatusOK)
}

// parseBoundedInt parses a query int clamped to [min, max] with fallback.
func parseBoundedInt(s string, min, max, fallback int) int {
	n := fallback
	if s != "" {
		if v, err := strconv.Atoi(s); err == nil {
			n = v
		}
	}
	if n < min {
		n = min
	}
	if n > max {
		n = max
	}
	return n
}

// handleBillingSubscription: GET /v1/billing/subscription
func (a *API) handleBillingSubscription(w http.ResponseWriter, r *http.Request) {
	idn := auth.FromIdentity(r.Context())
	if idn == nil {
		writeError(w, r, domain.ErrUnauthorized(nil))
		return
	}
	if a.subscriptions == nil {
		writeOK(w, map[string]any{
			"status": idn.SubscriptionStatus,
			"plan":   idn.Limits,
		})
		return
	}
	sub, err := a.subscriptions.Effective(r.Context(), idn.Tenant.ID)
	if err != nil {
		writeError(w, r, domain.AsError(err))
		return
	}
	if sub == nil {
		writeOK(w, map[string]any{
			"status": "none",
			"plan":   nil,
		})
		return
	}
	writeOK(w, map[string]any{
		"subscription_id":      sub.ID,
		"status":               sub.Status,
		"plan_id":              sub.PlanID,
		"plan_code":            sub.Plan.Code,
		"plan_name":            sub.Plan.Name,
		"limits":               sub.Plan.Limits,
		"current_period_start": sub.CurrentPeriodStart,
		"current_period_end":   sub.CurrentPeriodEnd,
	})
}

// handleBillingSubscriptionCancel: POST /v1/billing/subscription/cancel
func (a *API) handleBillingSubscriptionCancel(w http.ResponseWriter, r *http.Request) {
	idn := auth.FromIdentity(r.Context())
	if idn == nil {
		writeError(w, r, domain.ErrUnauthorized(nil))
		return
	}
	if a.subscriptions != nil {
		if err := a.subscriptions.Cancel(r.Context(), idn.Tenant.ID); err != nil {
			writeError(w, r, domain.AsError(err))
			return
		}
	}
	writeOK(w, map[string]any{
		"canceled": true,
		"message":  "Subscription will not renew at the end of the current billing period.",
	})
}
