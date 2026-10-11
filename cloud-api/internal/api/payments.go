package api

import (
	"io"
	"net/http"
	"strconv"

	"github.com/mash-cloud/mash-api/internal/auth"
	"github.com/mash-cloud/mash-api/internal/domain"
	"github.com/mash-cloud/mash-api/internal/payment"
)

// Payment handlers (mounted only when the payment service is enabled —
// the router checks a.payments != nil; disabled deployments answer
// 503 PAYMENTS_DISABLED on the same paths, keeping the contract stable).
//
// Surface (docs/FRONTEND-PAYMENTS.md):
//
//	GET  /v1/payments/catalog         purchasable plan SKUs (plans only)
//	POST /v1/payments/checkout        create order (Idempotency-Key honored)
//	POST /v1/payments/confirm         settle after paying (provider handshake)
//	GET  /v1/payments/orders/{id}     order status (reconciles if pending)
//	GET  /v1/payments/history         tenant orders, newest first
//	GET  /v1/payments/subscription    entitlement position (plan + paid-through)
//	POST /v1/payments/webhook         provider events (signature is the auth)
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
	skus := a.payments.SKUs()
	out := make([]payment.PlanSKU, len(skus))
	copy(out, skus)
	writeOK(w, map[string]any{"skus": out})
}

// handlePaymentCheckout: POST /v1/payments/checkout {sku_id}
//
// Idempotency-Key is honored (strongly recommended for every client:
// network retries must never fork orders).
//
// The response relays the provider's browser handles: key_id (razorpay
// Checkout.js), client_secret (stripe), redirect_url (phonepe hosted
// PAY_PAGE — send the browser there wholesale).
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
		SKUID string `json:"sku_id"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, domain.ErrValidation("malformed JSON body"))
		return
	}
	if req.SKUID == "" {
		writeError(w, r, domain.ErrValidation("sku_id is required"))
		return
	}

	o, err := a.payments.Checkout(r.Context(), idn.Tenant.ID, idn.User.ID,
		req.SKUID, r.Header.Get("Idempotency-Key"))
	if err != nil {
		writeError(w, r, domain.AsError(err))
		return
	}

	resp := map[string]any{
		"order":             o.ClientViewOf(),
		"key_id":            a.payments.PublicKeyID(), // public by design
		"provider":          o.Provider,
		"provider_order_id": o.ProviderOrderID,
	}
	if o.ProviderCheckoutURL != "" { // phonepe: hosted payment page
		resp["redirect_url"] = o.ProviderCheckoutURL
	}
	if o.ProviderClientSecret != "" { // stripe: Stripe.js handle
		resp["client_secret"] = o.ProviderClientSecret
	}
	writeJSON(w, http.StatusCreated, resp)
}

// handlePaymentConfirm: POST /v1/payments/confirm
//
// Body is provider-shaped with a generic core. firstNonEmpty resolution
// order: generic fields → legacy razorpay_* spellings → stripe / phonepe
// variants. The service verifies whatever the active provider defines
// (razorpay: HMAC triple; stripe/phonepe: server-side fetch is the
// authority — no client secret exists).
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
		// Generic core.
		ProviderOrderID   string `json:"provider_order_id"`
		ProviderPaymentID string `json:"provider_payment_id"`
		ProviderSignature string `json:"provider_signature"`

		// Legacy razorpay spellings (Checkout.js posts these verbatim).
		RazorpayOrderID   string `json:"razorpay_order_id"`
		RazorpayPaymentID string `json:"razorpay_payment_id"`
		RazorpaySignature string `json:"razorpay_signature"`

		// Stripe: the PaymentIntent id (client_secret optional — the
		// server-side fetch is the authority, it is never trusted).
		PaymentIntentID string `json:"payment_intent_id"`
		ClientSecret    string `json:"client_secret"`

		// PhonePe: the merchantTransactionId (= PAY-<our order suffix>).
		MerchantTransactionID string `json:"merchant_transaction_id"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, domain.ErrValidation("malformed JSON body"))
		return
	}

	orderID := firstNonEmpty(req.ProviderOrderID, req.RazorpayOrderID, req.PaymentIntentID, req.MerchantTransactionID)
	paymentID := firstNonEmpty(req.ProviderPaymentID, req.RazorpayPaymentID, req.PaymentIntentID, req.MerchantTransactionID)
	signature := firstNonEmpty(req.ProviderSignature, req.RazorpaySignature)

	if orderID == "" || paymentID == "" {
		writeError(w, r, domain.ErrValidation("provider_order_id and provider_payment_id are required"))
		return
	}

	o, err := a.payments.Confirm(r.Context(), idn.Tenant.ID, orderID, paymentID, signature)
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

// handlePaymentSubscription: GET /v1/payments/subscription
//
// Plans only: there is no credit balance — the subscription IS the
// wallet. Returns the effective plan (SubNone = the free default), the
// paid-through date, and days remaining.
func (a *API) handlePaymentSubscription(w http.ResponseWriter, r *http.Request) {
	if !a.paymentsEnabled() {
		writeError(w, r, payment.ErrDisabled)
		return
	}
	idn := auth.FromIdentity(r.Context())
	if idn == nil {
		writeError(w, r, domain.ErrUnauthorized(nil))
		return
	}
	st, err := a.payments.Subscription(r.Context(), idn.Tenant.ID)
	if err != nil {
		writeError(w, r, domain.AsError(err))
		return
	}
	writeOK(w, st)
}

// handlePaymentWebhook: POST /v1/payments/webhook
//
// Unauthenticated by token BY DESIGN: the provider signature over the raw
// body is the route's entire authentication (design §13). The handler
// reads the raw bytes untouched (no decode/re-marshal — that would break
// the MAC), resolves the active provider's signature header, and hands
// off to the service.
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
	// The signature header is provider-specific: razorpay
	// X-Razorpay-Signature, stripe Stripe-Signature, phonepe X-VERIFY.
	sig := r.Header.Get("X-Razorpay-Signature")
	switch a.payments.ProviderName() {
	case payment.ProviderStripe:
		sig = r.Header.Get("Stripe-Signature")
	case payment.ProviderPhonepe:
		sig = r.Header.Get("X-VERIFY")
	}
	ip := clientIP(r, a.cfg.TrustProxyHeaders)
	if err := a.payments.HandleWebhook(r.Context(), body, sig, ip); err != nil {
		writeError(w, r, domain.AsError(err))
		return
	}
	// 200 only after the state change has committed (service contract).
	w.WriteHeader(http.StatusOK)
}

// firstNonEmpty returns the first non-empty argument ("" when all empty).
func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
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
