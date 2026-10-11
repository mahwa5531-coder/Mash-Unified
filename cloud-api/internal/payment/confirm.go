package payment

import (
	"context"
	"errors"
)

// Confirm verifies the client checkout handshake and activates the plan.
//
// The browser posts the provider's completion fields — the exact shape is
// provider-specific (razorpay: order/payment/signature triple with
// HMAC_SHA256(order|payment, key_secret); stripe: {payment_intent_id[,
// client_secret]} — NO client-side HMAC, the server-side intent fetch is the
// authority; phonepe: {merchant_transaction_id} — no client secret either,
// the signed status API is the authority). Verification is three-legged —
// NONE of the client fields is trusted alone:
//
//  1. signature (where the provider defines one): proves the provider-side
//     widget produced this pair — unforgeable by the page or a MITM.
//  2. provider fetch: proves the payment exists, belongs to THIS order,
//     is captured, and the amount matches the order row — the client
//     cannot lie about any of it.
//  3. store transaction: proves the subscription activates exactly once
//     regardless of confirm/webhook/reconcile racing (apply.go).
//
// The order must belong to the caller's tenant; a foreign order id is a
// 404 identical to an unknown id (no cross-tenant existence oracle).
func (s *Service) Confirm(ctx context.Context, tenantID, providerOrderID, providerPaymentID, signature string) (*Order, error) {
	if !s.Enabled() {
		return nil, ErrDisabled
	}
	o, err := s.store.OrderByProviderID(ctx, s.provider.Name(), providerOrderID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, ErrOrderNotFound()
		}
		return nil, err
	}
	if o.TenantID != tenantID {
		return nil, ErrOrderNotFound()
	}

	// Already paid (webhook won the race): return the paid order — the
	// client treats confirm as settled success, not conflict.
	if o.Status == StatusPaid {
		return o, nil
	}
	if Terminal(o.Status) {
		// failed/expired: a capture would have arrived via webhook; do not
		// resurrect from a stale client handshake alone — reconcile path
		// owns late captures (it fetches authoritative state).
		return nil, ErrOrderNotOpen(o.Status)
	}

	if !s.provider.VerifyCheckoutSignature(providerOrderID, providerPaymentID, signature) {
		return nil, ErrBadSignature()
	}

	p, err := s.provider.FetchPayment(ctx, providerPaymentID)
	if err != nil {
		return nil, mapProviderError(err)
	}
	if p.OrderID != providerOrderID {
		return nil, ErrBadSignature()
	}
	if NormalizePaymentStatus(p.Status) != StatusPaid || !p.Captured {
		// authorized-but-not-captured, failed, pending: not money yet.
		// The webhook owns the captured transition.
		return nil, ErrOrderNotOpen(StatusAttempted)
	}
	if p.AmountPaise != o.AmountPaise {
		// Tamper alarm: the handshake is valid but the payment amount does
		// not match the order (e.g. a hand-crafted tiny payment). Never
		// activate, never fail the order — leave it pending for the
		// webhook/reconcile to resolve truthfully.
		return nil, ErrAmountMismatch(o.AmountPaise, p.AmountPaise)
	}

	if _, err := s.applyPaid(ctx, o.ID, providerPaymentID); err != nil {
		return nil, err
	}
	return s.store.OrderByID(ctx, o.ID)
}
