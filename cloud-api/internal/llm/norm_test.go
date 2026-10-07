package llm

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/mash-cloud/mash-api/internal/domain"
)

// staticRules is a fixed RuleSource (no DB).
type staticRules []domain.NormRule

func (s staticRules) All(context.Context) ([]domain.NormRule, error) { return s, nil }

// TestRuleCacheResolution: exact key > longest provider pattern > '*' default
// > built-in identity rule.
func TestRuleCacheResolution(t *testing.T) {
	src := staticRules{
		{Model: "*", InputWeight: 1, CachedReadWeight: 1, CachedWriteWeight: 1, OutputWeight: 1},
		{Model: "anthropic/*", InputWeight: 1, CachedReadWeight: 0.1, CachedWriteWeight: 0.5, OutputWeight: 1},
		{Model: "anthropic/claude-sonnet-4", InputWeight: 2, CachedReadWeight: 1, CachedWriteWeight: 1, OutputWeight: 2},
		{Model: "openai/gpt-4o", InputWeight: 0.5, CachedReadWeight: 1, CachedWriteWeight: 1, OutputWeight: 1},
	}
	c := NewRuleCache(src, time.Hour)

	if got := c.Rule(context.Background(), "anthropic/claude-sonnet-4"); got.InputWeight != 2 {
		t.Fatalf("exact key must win: %+v", got)
	}
	// Pattern catches a sibling model.
	got := c.Rule(context.Background(), "anthropic/claude-opus-4")
	if got.CachedReadWeight != 0.1 || got.CachedWriteWeight != 0.5 {
		t.Fatalf("pattern must catch siblings: %+v", got)
	}
	if got2 := c.Rule(context.Background(), "openai/gpt-4o"); got2.InputWeight != 0.5 {
		t.Fatalf("other exact: %+v", got2)
	}
	// Unknown provider falls to '*'.
	if got3 := c.Rule(context.Background(), "grok/xai-1"); got3.Model != "*" {
		t.Fatalf("unknown must fall to default row: %+v", got3)
	}
}

// TestRuleCachePatternMatching: "provider/*" matches exactly its own
// provider segment — a provider whose name shares leading letters ("an" vs
// "anthropic") is a DIFFERENT provider and does not match. Unknown providers
// fall through to the '*' default row.
func TestRuleCachePatternMatching(t *testing.T) {
	src := staticRules{
		{Model: "*", OutputWeight: 1},
		{Model: "an/*", OutputWeight: 2},
		{Model: "anthropic/*", OutputWeight: 3},
	}
	c := NewRuleCache(src, time.Hour)
	if got := c.Rule(context.Background(), "anthropic/claude"); got.OutputWeight != 3 {
		t.Fatalf("provider pattern must match its models: %+v", got)
	}
	if got := c.Rule(context.Background(), "an/legacy"); got.OutputWeight != 2 {
		t.Fatalf("own prefix must match: %+v", got)
	}
	if got := c.Rule(context.Background(), "android/thing"); got.OutputWeight != 1 {
		t.Fatalf("different provider falls to default: %+v", got)
	}
}

// countingSource counts loads and can be made to fail — for TTL + staleness.
type countingSource struct {
	mu    sync.Mutex
	rules []domain.NormRule
	loads int
	fail  bool
}

func (s *countingSource) All(context.Context) ([]domain.NormRule, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.loads++
	if s.fail {
		return nil, errors.New("db down")
	}
	return s.rules, nil
}

func (s *countingSource) loadCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.loads
}

// TestRuleCacheTTLAndStaleOnError: rules reload after the TTL; a failed
// reload keeps the last good rules serving (accounting continuity).
func TestRuleCacheTTLAndStaleOnError(t *testing.T) {
	src := &countingSource{rules: []domain.NormRule{{Model: "*", OutputWeight: 1}}}
	c := NewRuleCache(src, 25*time.Millisecond)

	if got := c.Rule(context.Background(), "openai/gpt-4o"); got.OutputWeight != 1 {
		t.Fatalf("cold start: %+v", got)
	}
	if src.loadCount() != 1 {
		t.Fatalf("loads = %d, want 1", src.loadCount())
	}

	// Within the TTL: no reload.
	_ = c.Rule(context.Background(), "openai/gpt-4o")
	if src.loadCount() != 1 {
		t.Fatalf("TTL must suppress reloads, loads = %d", src.loadCount())
	}

	// After the TTL: reload picks up the new value. Poll Rule() — that is what
	// drives the (async) refresh.
	src.mu.Lock()
	src.rules = []domain.NormRule{{Model: "*", OutputWeight: 9}}
	src.mu.Unlock()
	waitFor(t, func() bool {
		return c.Rule(context.Background(), "openai/gpt-4o").OutputWeight == 9
	}, time.Second)
	if src.loadCount() < 2 {
		t.Fatalf("reloads = %d, want >= 2", src.loadCount())
	}

	// DB breaks: stale rules keep serving, never an error, never a block.
	src.mu.Lock()
	src.rules = nil
	src.fail = true
	src.mu.Unlock()
	waitCtx := context.Background()
	waitFor(t, func() bool {
		c.Rule(waitCtx, "openai/gpt-4o") // stale → async retry (bounded by backoff)
		return src.loadCount() >= 3
	}, 2*time.Second)
	if got := c.Rule(context.Background(), "openai/gpt-4o"); got.OutputWeight != 9 {
		t.Fatalf("stale-on-error must serve last good rules: %+v", got)
	}
}

// TestRuleCacheEmptyTableAndNilCache: an empty table degrades to the built-in
// identity rule; a nil cache does the same (signer-only deployments).
func TestRuleCacheEmptyTableAndNilCache(t *testing.T) {
	c := NewRuleCache(staticRules{}, time.Hour)
	if got := c.Rule(context.Background(), "openai/gpt-4o"); got != domain.DefaultNormRule {
		t.Fatalf("empty table must yield the identity rule: %+v", got)
	}
	var nilCache *RuleCache
	if got := nilCache.Rule(context.Background(), "openai/gpt-4o"); got != domain.DefaultNormRule {
		t.Fatalf("nil cache must yield the identity rule: %+v", got)
	}
}

func waitFor(t *testing.T, cond func() bool, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatal("condition not met before timeout")
}
