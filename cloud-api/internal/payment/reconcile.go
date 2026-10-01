package payment

import (
	"context"
	"errors"
	"time"
)

// reconcile.go — the truth-recovery path. Webhooks can be missed (outage,
// misconfigured URL, dropped event). Reconciliation makes the system
// eventually-consistent WITHOUT trusting the client:
//
//   - GetOrder: read-through reconcile — a pending order view triggers one
//     bounded upstream fetch (polling clients get convergence for free).
//   - StartSweeper: background loop — expires stale open orders past
//     their TTL and re-checks still-open ones for missed captures.

// maxSyncPerSweep bounds the sweeper's upstream fan-out per tick: the
// open-order set is small by construction (orders live minutes), but a
// bug or a marketing burst must never turn the sweep into a provider
// stampede.
const maxSyncPerSweep = 128

// GetOrder returns the tenant-scoped order, reconciling non-terminal
// orders against the provider first. Provider errors during reconcile are
// swallowed (the cached state is served — a status view must not fail
// because the provider is down; the next poll retries).
func (s *Service) GetOrder(ctx context.Context, tenantID, orderID string) (*Order, error) {
	if !s.Enabled() {
		return nil, ErrDisabled
	}
	o, err := s.store.OrderByID(ctx, orderID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, ErrOrderNotFound()
		}
		return nil, err
	}
	if o.TenantID != tenantID {
		return nil, ErrOrderNotFound()
	}
	if o.Status == StatusPending || o.Status == StatusAttempted {
		if synced, err := s.syncOrder(ctx, o); err == nil {
			return synced, nil
		}
		// fall through: serve the stored (possibly stale) order
	}
	return o, nil
}

// syncOrder fetches the provider-side order and applies the outcome
// through the same exactly-once core as confirm/webhook. A provider-side
// `paid` is authoritative even after local expiry: money moved, credits
// must mint (paid beats expired — design §4).
func (s *Service) syncOrder(ctx context.Context, o *Order) (*Order, error) {
	po, err := s.provider.FetchOrder(ctx, o.ProviderOrderID)
	if err != nil {
		return nil, mapProviderError(err)
	}
	switch NormalizeOrderStatus(po.Status) {
	case StatusPaid:
		// The provider order row does not carry the payment id; fetch the
		// order's payments so the audit trail is complete. The store keeps
		// any previously-recorded one when this lookup fails (COALESCE
		// semantics in ApplyPaid) — a missing payment id must never block
		// crediting.
		payID := ""
		if pays, err := s.provider.FetchOrderPayments(ctx, o.ProviderOrderID); err == nil {
			for _, p := range pays {
				if NormalizePaymentStatus(p.Status) == StatusPaid && p.AmountPaise == o.AmountPaise {
					payID = p.ID
					break
				}
			}
		}
		if _, err := s.applyPaid(ctx, o.ID, payID); err != nil {
			return nil, err
		}
		return s.store.OrderByID(ctx, o.ID)
	case StatusAttempted:
		// A payment attempt exists; its fate arrives via webhook
		// (payment.captured/failed). Visibility only:
		_ = s.store.MarkAttempted(ctx, o.ID, "")
		return s.store.OrderByID(ctx, o.ID)
	default:
		return o, nil // still created/pending provider-side
	}
}

// StartSweeper runs until ctx is cancelled (main wires the root context;
// graceful shutdown stops it). Per tick:
//
//  1. ExpireStale — open orders past expires_at flip to expired.
//  2. re-sync still-open orders — catches missed payment.captured events
//     while the order was in flight (bounded, back-off by interval).
//
// The sweeper never mints on its own authority: it applies provider truth
// through applyPaid, same as every other path.
func (s *Service) StartSweeper(ctx context.Context) {
	if !s.Enabled() {
		return
	}
	go func() {
		t := time.NewTicker(s.cfg.SweepInterval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				s.sweepOnce(ctx)
			}
		}
	}()
}

func (s *Service) sweepOnce(ctx context.Context) {
	sweepCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	if n, err := s.store.ExpireStale(sweepCtx, time.Now().UTC()); err == nil && n > 0 {
		s.count("sweep_expired", StatusExpired)
	}

	// Re-check still-open orders (post-expiry filter already applied):
	// each gets at most one provider fetch per sweep tick.
	if open, err := s.store.ListOpenOrders(sweepCtx, maxSyncPerSweep); err == nil {
		for _, o := range open {
			if err := sweepCtx.Err(); err != nil {
				return
			}
			// Errors swallowed deliberately: one bad order (provider 404
			// for a hand-deleted test order, etc.) must not block the rest.
			_, _ = s.syncOrder(sweepCtx, o)
		}
	}
}
