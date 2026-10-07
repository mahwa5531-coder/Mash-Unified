package llm

import (
	"context"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/mash-cloud/mash-api/internal/domain"
	"github.com/mash-cloud/mash-api/internal/observability"
)

// RuleSource loads the full active normalization table (implemented by
// repos.NormalizationRepo).
type RuleSource interface {
	All(ctx context.Context) ([]domain.NormRule, error)
}

// RuleCache resolves model → NormRule with a short TTL, so token accounting
// is operator-controlled at runtime: UPDATE token_normalization ... takes
// effect within the TTL without a restart or redeploy.
//
// Failure posture: stale-on-error. A failed reload keeps the last good rules
// serving (accounting continuity beats freshness); the very first load has
// nothing to serve, so it degrades to the built-in identity rule rather than
// blocking or failing the call.
type RuleCache struct {
	src RuleSource
	ttl time.Duration

	mu      sync.RWMutex
	rules   []domain.NormRule
	expires time.Time
	loaded  bool
	retryAt time.Time // failed-refresh backoff: don't hammer a down DB per call

	refreshing atomic.Bool // at most one background reload in flight
}

func NewRuleCache(src RuleSource, ttl time.Duration) *RuleCache {
	if ttl <= 0 {
		ttl = 30 * time.Second
	}
	return &RuleCache{src: src, ttl: ttl}
}

// Rule resolves the accounting rule for one model:
//
//	exact "provider/model" key  →  longest "provider/*" pattern  →  '*' default  →  built-in identity
//
// A nil cache (tests, signer-only deployments) always yields the identity rule.
func (c *RuleCache) Rule(ctx context.Context, model string) domain.NormRule {
	if c == nil || c.src == nil {
		return domain.DefaultNormRule
	}
	now := time.Now()
	c.mu.RLock()
	rules := c.rules
	fresh := c.loaded && now.Before(c.expires)
	backoff := c.loaded && now.Before(c.retryAt) // serve stale, don't retry yet
	c.mu.RUnlock()
	switch {
	case fresh:
		return resolveRule(rules, model)
	case !c.loaded:
		// Cold start: block once — a handful of rows, a few milliseconds.
		c.refresh(ctx)
		return c.cached(model)
	case backoff:
		return resolveRule(rules, model)
	}
	// Warm and stale: serve the (slightly stale) rules and refresh in the
	// background; the streaming hot path never waits on PostgreSQL here.
	if c.refreshing.CompareAndSwap(false, true) {
		go func() {
			defer c.refreshing.Store(false)
			bg, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
			defer cancel()
			c.refresh(bg)
		}()
	}
	return resolveRule(rules, model)
}

// cached reads the post-refresh state (cold-start path).
func (c *RuleCache) cached(model string) domain.NormRule {
	c.mu.RLock()
	rules := c.rules
	c.mu.RUnlock()
	return resolveRule(rules, model)
}

// refresh loads the active rules and swaps them in atomically. A failed load
// leaves the previous rules serving and backs off briefly (bounded by the
// TTL) so a down database is not queried on every call.
func (c *RuleCache) refresh(ctx context.Context) {
	rules, err := c.src.All(ctx)
	c.mu.Lock()
	defer c.mu.Unlock()
	if err != nil {
		backoff := c.ttl
		if backoff > 2*time.Second {
			backoff = 2 * time.Second
		}
		c.retryAt = time.Now().Add(backoff)
		observability.LogWarn("normalization: rule reload failed, serving last known rules",
			"error", err, "retry_in", backoff.String())
		return
	}
	c.rules = rules
	c.expires = time.Now().Add(c.ttl)
	c.loaded = true
}

// resolveRule picks the best match: exact key, then the longest provider
// pattern, then '*', then the built-in identity rule.
func resolveRule(rules []domain.NormRule, model string) domain.NormRule {
	var star, best *domain.NormRule
	bestLen := -1
	for i := range rules {
		r := &rules[i]
		switch {
		case r.Model == model:
			return *r
		case r.Model == "*":
			star = r
		case len(r.Model) > 2 && strings.HasSuffix(r.Model, "/*"):
			prefix := r.Model[:len(r.Model)-2]
			if len(model) > len(prefix) && strings.HasPrefix(model, prefix+"/") && len(prefix) > bestLen {
				best, bestLen = r, len(prefix)
			}
		}
	}
	switch {
	case best != nil:
		return *best
	case star != nil:
		return *star
	}
	return domain.DefaultNormRule
}
