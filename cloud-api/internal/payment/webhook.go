package payment

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/mash-cloud/mash-api/internal/observability"
	"go.opentelemetry.io/otel/attribute"
)

// HandleWebhook processes a provider webhook end-to-end:
//
//	per-IP budget → HMAC over RAW bytes → parse → resolve order →
//	dedupe by event id → amount cross-check → state-machine apply → 200
//
// Delivery contract is at-least-once: duplicates are acknowledged and
// ignored. Ordering is NOT guaranteed by providers: a payment.failed may
// land after payment.captured — the state machine drops it (paid is
// absorbing), which is exactly why ordering must never matter here.
//
// The caller (api layer) answers 200 on nil error only — i.e. after the
// state change has COMMITTED. Anything else (5xx) makes the provider
// retry, which is the desired behavior for transient storage failures.
func (s *Service) HandleWebhook(ctx context.Context, raw []byte, signature, clientIP string) error {
	if !s.Enabled() {
		return ErrDisabled
	}

	// Budget first (cheap): a webhook flood must not reach HMAC+DB.
	if s.lim != nil && s.cfg.WebhookPerIP > 0 {
		if !s.lim.Admit(ctx, webhookBudgetKey(clientIP), time.Minute, s.cfg.WebhookPerIP,
			fmt.Sprintf("wh-%d", time.Now().UnixNano())) {
			return errWebhookBudget
		}
	}

	// Signature over the exact raw bytes. Never a re-marshal: Go map
	// iteration order would change the payload and break the MAC. This is
	// the route's ONLY authentication — fail closed, before any parse or
	// store access.
	if !s.provider.VerifyWebhookSignature(raw, signature) {
		s.webhookMetric("rejected")
		return ErrWebhookSignature()
	}

	ev, err := s.provider.ParseWebhook(raw)
	if err != nil || ev == nil || ev.EventID == "" {
		// Correctly signed garbage: a provider bug or a versioned envelope
		// we do not understand. Acknowledge (stop retries) and count it —
		// silent drops would hide provider-side drift.
		s.webhookMetric("unparsed")
		return nil
	}

	// Resolve the local order BEFORE recording (read-only; the resolved
	// id feeds the event's FK and the amount cross-check below).
	var o *Order
	if ev.ProviderOrderID != "" {
		resolved, rerr := s.store.OrderByProviderID(ctx, ev.Provider, ev.ProviderOrderID)
		if rerr == nil {
			o, ev.LocalOrderID = resolved, resolved.ID
		} else if !errors.Is(rerr, ErrNotFound) {
			return rerr // storage failure: 5xx → provider retries → correct
		}
	}

	// Dedupe: the event id is globally unique at the provider. The
	// INSERT ... ON CONFLICT DO NOTHING verdict IS the dedupe — atomic
	// even under concurrent duplicate deliveries on different instances.
	duplicate, err := s.store.RecordWebhookEvent(ctx, ev)
	if err != nil {
		return err // 5xx → provider retries → correct (not yet recorded)
	}
	if duplicate {
		s.webhookMetric("duplicate", observability.Attr("event", ev.Type))
		return nil
	}

	if !ev.Handled() {
		// Recorded for audit, acted on never (refund reversal is v2 — the
		// ledger kind enum already reserves it).
		s.webhookMetric("ignored", observability.Attr("event", ev.Type))
		return nil
	}

	if o == nil {
		// Unknown order: not ours (another product on the same webhook
		// URL?) or pre-dating a data migration. The event is recorded;
		// acknowledging stops retry storms. Ops can replay from the
		// recorded payload.
		s.webhookMetric("orphan", observability.Attr("event", ev.Type))
		return nil
	}

	// Amount cross-check (tamper alarm): a correctly-signed event carrying
	// the wrong amount for the order it references is a red flag — the
	// event is recorded, the order stays untouched, the 409-class error
	// surfaces for ops. (Applies to handled events only; recorded-only
	// events keep their own amounts.)
	if ev.AmountPaise > 0 && ev.AmountPaise != o.AmountPaise {
		s.webhookMetric("amount_mismatch", observability.Attr("event", ev.Type))
		return ErrAmountMismatch(o.AmountPaise, ev.AmountPaise)
	}

	switch ev.Type {
	case EventPaymentCaptured, EventOrderPaid:
		if _, err := s.applyPaid(ctx, o.ID, ev.ProviderPaymentID); err != nil {
			return err
		}
		s.webhookMetric("applied", observability.Attr("event", ev.Type))
	case EventPaymentFailed:
		if _, err := s.applyFailed(ctx, o.ID, "payment.failed"); err != nil {
			return err
		}
		s.webhookMetric("applied", observability.Attr("event", ev.Type))
	}
	return nil
}

func (s *Service) webhookMetric(outcome string, attrs ...attribute.KeyValue) {
	if s.metrics == nil || s.metrics.PaymentWebhooks == nil {
		return
	}
	all := append([]attribute.KeyValue{observability.Attr("outcome", outcome)}, attrs...)
	s.metrics.PaymentWebhooks.Add(context.Background(), 1, all...)
}
