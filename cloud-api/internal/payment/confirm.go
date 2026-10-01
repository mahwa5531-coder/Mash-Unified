package payment

import (
	"context"
	"errors"
)

// Confirm verifies the Razorpay Checkout handshake and applies credits.
//
// The browser posts {razorpay_order_id, razorpay_payment_id,
// razorpay_signature}; the widget computed the signature as
// HMAC_SHA256(order_id + "|" + payment_id, key_secret). Verification is
// three-legged — NONE of the three client fields is trusted alone:
//
//  1. signature: proves the widget (holder of key_secret) produced this
//     pair — unforgeable by the page or a MITM.
//  2. provider fetch: proves the payment exists, belongs to THIS order,
//     is captured, and the amount matches the order row — the client
//     cannot lie about any of it.
//  3. store transaction: proves credits mint exactly once regardless of
//     confirm/webhook/reconcile racing (apply.go).
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
		// Tamper alarm: the signature is valid but the payment amount does
		// not match the order (e.g. a hand-crafted tiny payment signed with
		// a leaked key id). Never mint, never fail the order — leave it
		// pending for the webhook/reconcile to resolve truthfully.
		return nil, ErrAmountMismatch(o.AmountPaise, p.AmountPaise)
	}

	if _, err := s.applyPaid(ctx, o.ID, providerPaymentID); err != nil {
		return nil, err
	}
	return s.store.OrderByID(ctx, o.ID)
}
