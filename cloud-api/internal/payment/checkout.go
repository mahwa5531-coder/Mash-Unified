package payment

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/mash-cloud/mash-api/internal/ids"
	"github.com/mash-cloud/mash-api/internal/observability"
)

// Checkout starts a purchase: resolves the pack, creates the provider
// order, and persists the local pending order. Idempotent by Idempotency-Key
// (unique (tenant_id, idempotency_key)); replay returns the original order.
//
// Concurrency: two racing checkouts with the same key both reach the
// provider (orphan provider orders are free — an unpaid order costs
// nothing), but only one local row can win the unique insert; the loser
// re-reads by key and replays the winner's order. Net: exactly one local
// order per idempotency key, ever.
func (s *Service) Checkout(ctx context.Context, tenantID, userID, packID, idempotencyKey string) (*Order, error) {
	if !s.Enabled() {
		return nil, ErrDisabled
	}
	pack, ok := s.catalog.Get(packID)
	if !ok {
		return nil, ErrPackNotFound(packID)
	}

	// Per-user budget: a stuck client retry-storming checkout must not fan
	// out provider orders (each costs a network call + a row).
	if s.lim != nil && s.cfg.CheckoutPerUser > 0 {
		if !s.lim.Admit(ctx, checkoutBudgetKey(userID), time.Hour, s.cfg.CheckoutPerUser,
			fmt.Sprintf("co-%d", time.Now().UnixNano())) {
			return nil, errCheckoutBudget
		}
	}

	// Idempotent replay: same key + same pack → same order. Different pack
	// with the same key is a client bug (reuse) — surfaced as 422 exactly
	// like the runs idempotency contract.
	if idempotencyKey != "" {
		if existing, err := s.store.OrderByIdempotencyKey(ctx, tenantID, idempotencyKey); err == nil && existing != nil {
			if existing.RequestHash != checkoutRequestHash(packID) {
				return nil, errIdemReuse
			}
			s.count("idem_replay", existing.Status)
			return existing, nil
		} else if err != nil && !errors.Is(err, ErrNotFound) {
			return nil, err
		}
	}

	// Local id first: the provider order references it (receipt + notes),
	// giving support a one-hop correlation in both directions.
	orderID := ids.New("pay")

	po, err := s.provider.CreateOrder(ctx, CreateOrderRequest{
		AmountPaise: pack.AmountPaise,
		Currency:    "INR",
		Receipt:     orderID,
		Notes: map[string]string{
			"order_id":  orderID,
			"tenant_id": tenantID,
			"pack_id":   pack.ID,
		},
	})
	if err != nil {
		return nil, mapProviderError(err)
	}
	if po.AmountPaise != pack.AmountPaise {
		// Provider echoed a different amount than requested — contract
		// drift or a proxy misbehaving. Nothing charged (nothing created
		// locally); fail loudly, never mint credits on an unknown amount.
		return nil, ErrProviderRequest(fmt.Errorf("provider echoed amount %d, want %d", po.AmountPaise, pack.AmountPaise))
	}

	now := time.Now().UTC()
	o := &Order{
		ID: orderID, TenantID: tenantID, UserID: userID,
		Provider: s.provider.Name(), ProviderOrderID: po.ID,
		PackID: pack.ID, Currency: "INR",
		AmountPaise: pack.AmountPaise, Credits: pack.Credits, // snapshot
		Status:         StatusPending,
		IdempotencyKey: idempotencyKey,
		RequestHash:    checkoutRequestHash(packID),
		CreatedAt:      now, UpdatedAt: now,
		ExpiresAt: now.Add(s.cfg.OrderTTL),
	}
	if err := s.store.CreateOrder(ctx, o); err != nil {
		if errors.Is(err, ErrOrderExistsIdem) || errors.Is(err, ErrOrderExistsProvider) {
			// Lost the unique race: replay the winner's order instead of
			// surfacing a conflict (the client asked once; the network
			// duplicated it — Stripe/Razorpay-grade idempotency semantics).
			if idempotencyKey != "" {
				if existing, err2 := s.store.OrderByIdempotencyKey(ctx, tenantID, idempotencyKey); err2 == nil && existing != nil {
					if existing.RequestHash != checkoutRequestHash(packID) {
						return nil, errIdemReuse
					}
					return existing, nil
				}
			}
			if existing, err2 := s.store.OrderByProviderID(ctx, s.provider.Name(), po.ID); err2 == nil && existing != nil {
				return existing, nil
			}
			return nil, errIdemRace
		}
		return nil, err
	}

	s.count("created", StatusPending)
	return o, nil
}

// checkoutRequestHash binds the idempotency key to the request content.
// v1 content = pack id (the only client-chosen field; tenant/user come from
// the verified identity, so they cannot drift between retries).
func checkoutRequestHash(packID string) string {
	h := sha256.Sum256([]byte("checkout|" + packID))
	return hex.EncodeToString(h[:])
}

// mapProviderError normalizes provider failures to client-safe domain
// errors. Provider detail never leaks past this boundary (except into the
// server-side cause for operators).
func mapProviderError(err error) error {
	if err == nil {
		return nil
	}
	var pe *ProviderError
	if !errors.As(err, &pe) {
		return ErrProviderUnavailable(err)
	}
	switch pe.Kind {
	case ProviderErrAuth:
		return ErrProviderAuth()
	case ProviderErrRequest:
		return ErrProviderRequest(pe)
	case ProviderErrUnavailable:
		return ErrProviderUnavailable(pe)
	default:
		return ErrProviderUnavailable(pe)
	}
}

func (s *Service) count(event, status string) {
	if s.metrics == nil || s.metrics.PaymentOrders == nil {
		return
	}
	s.metrics.PaymentOrders.Add(context.Background(), 1,
		observability.Attr("provider", s.provider.Name()),
		observability.Attr("event", event),
		observability.Attr("status", status))
}
