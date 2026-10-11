package payment

import (
	"context"
	"time"

	"github.com/mash-cloud/mash-api/internal/observability"
)

// Admitter is the narrow rate-limit seam (satisfied by *ratelimit.Limiter).
// Checkout and webhook budgets flow through it; keeping the interface here
// means the payment package never imports the limiter implementation.
type Admitter interface {
	Admit(ctx context.Context, key string, window time.Duration, limit int, id string) bool
}

// Config wires the service. Every field is a collaborator or a tunable —
// no behavior flags: behavior derives from the provider implementation.
type Config struct {
	Store    Store
	Provider Provider
	Catalog  *Catalog
	Limiter  Admitter // nil = no checkout/webhook budgets (tests)

	OrderTTL        time.Duration // pending order lifetime (sweeper expiry)
	SweepInterval   time.Duration // background sweeper cadence
	HistoryLimit    int           // default/cap for history pages
	CheckoutPerUser int           // checkout requests / user / hour (0 = off)
	WebhookPerIP    int           // webhook posts / IP / minute (0 = off)

	Metrics *observability.Metrics
}

// Service orchestrates the money flows. All mutations funnel through the
// apply* core (apply.go) — the store arbitrates exactly-once.
type Service struct {
	cfg      Config
	store    Store
	provider Provider
	catalog  *Catalog
	lim      Admitter
	metrics  *observability.Metrics
}

// New assembles the service. Nil-safe throughout: a nil Service means
// "payments disabled" and the API layer answers 503 PAYMENTS_DISABLED.
func New(cfg Config) *Service {
	if cfg.OrderTTL <= 0 {
		cfg.OrderTTL = 15 * time.Minute
	}
	if cfg.SweepInterval <= 0 {
		cfg.SweepInterval = time.Minute
	}
	if cfg.HistoryLimit <= 0 {
		cfg.HistoryLimit = 50
	}
	return &Service{
		cfg: cfg, store: cfg.Store, provider: cfg.Provider,
		catalog: cfg.Catalog, lim: cfg.Limiter, metrics: cfg.Metrics,
	}
}

// Enabled reports whether this service is live (false for nil — the
// disabled mode is a nil service, so every handler can ask uniformly).
func (s *Service) Enabled() bool { return s != nil && s.provider != nil && s.store != nil }

// SKUs lists the purchasable plan catalog (display order).
func (s *Service) SKUs() []PlanSKU { return s.catalog.SKUs() }

// ProviderName exposes the active provider (the API layer maps it to the
// right webhook signature header: X-Razorpay-Signature | Stripe-Signature
// | X-VERIFY).
func (s *Service) ProviderName() string { return s.provider.Name() }

// PublicKeyID exposes the browser-safe provider key id (razorpay
// Checkout.js; empty for providers without one).
func (s *Service) PublicKeyID() string { return s.provider.PublicKeyID() }

// Subscription returns the tenant's entitlement position (what a purchase
// buys, what expiry means; SubNone = the free default).
func (s *Service) Subscription(ctx context.Context, tenantID string) (*SubscriptionState, error) {
	return s.store.Subscription(ctx, tenantID)
}

// History returns the tenant's orders newest-first.
func (s *Service) History(ctx context.Context, tenantID string, limit int) ([]*Order, error) {
	if limit <= 0 || limit > s.cfg.HistoryLimit {
		limit = s.cfg.HistoryLimit
	}
	return s.store.ListOrders(ctx, tenantID, limit)
}

// checkoutBudgetKey is the per-user checkout throttle (Redis-backed when a
// limiter is wired; per-hour window by design — checkout is rare, a burst
// means a stuck client or scripted abuse).
func checkoutBudgetKey(userID string) string { return "pay:checkout:user:" + userID }

// webhookBudgetKey is the per-IP webhook throttle. Providers retry only
// on non-2xx; healthy traffic is well under any sane budget.
func webhookBudgetKey(ip string) string { return "pay:webhook:ip:" + ip }
