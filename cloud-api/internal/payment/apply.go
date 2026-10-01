package payment

import (
	"context"

	"github.com/nexau-cloud/nexau-api/internal/observability"
)

// apply.go — the exactly-once core. EVERY money-moving path (client
// confirm, webhook capture, reconciliation sync) funnels into applyPaid;
// every failure path funnels into applyFailed. The store is the arbiter:
// its conditional UPDATE + ledger UNIQUE(order_id, kind) decide the winner
// of any race; the service only interprets the verdict (docs §5).
//
// This file looks deliberately thin. That is the point: there is exactly
// ONE place in the process where an order becomes paid and credits are
// minted, and it has no branching by caller, no caller-specific rules, no
// shortcuts. Adding a second mint path is a design violation, not a
// convenience.

// applyPaid transitions an order to paid and mints the topup credits.
// Returns applied=false when the order was already paid (idempotent no-op —
// duplicate webhooks, confirm-after-webhook, etc. all land here silently).
func (s *Service) applyPaid(ctx context.Context, orderID, providerPaymentID string) (bool, error) {
	applied, order, err := s.store.ApplyPaid(ctx, orderID, providerPaymentID)
	if err != nil {
		return false, err
	}
	if applied {
		s.count("paid", StatusPaid)
		if s.metrics != nil && s.metrics.PaymentCredits != nil {
			s.metrics.PaymentCredits.Add(ctx, order.Credits,
				observability.Attr("provider", order.Provider))
		}
	}
	return applied, nil
}

// applyFailed records a provider-side payment failure. applied=false when
// the order already reached a terminal state (notably: a late
// payment.failed arriving after payment.captured is DROPPED here — paid is
// absorbing and the money is real).
func (s *Service) applyFailed(ctx context.Context, orderID, reason string) (bool, error) {
	applied, err := s.store.ApplyFailed(ctx, orderID, reason)
	if err != nil {
		return false, err
	}
	if applied {
		s.count("failed", StatusFailed)
	}
	return applied, nil
}

// applyExpired expires a stale open order (sweeper / reconcile path).
func (s *Service) applyExpired(ctx context.Context, orderID string) (bool, error) {
	applied, err := s.store.ApplyExpired(ctx, orderID)
	if err != nil {
		return false, err
	}
	if applied {
		s.count("expired", StatusExpired)
	}
	return applied, nil
}
