// 2026-09-19 security audit, finding 4 — the mechanism behind the RPM bypass.
//
// The sliding window's ZSET member must be unique per admitted request: ZADD
// with an identical member REPLACES the existing entry instead of appending,
// so a client-pinned member (the inbound X-Request-Id) pins the window count
// at 1 and every quota becomes unenforceable (the audit admitted 20/20
// billable runs under a 5/min plan). These tests pin BOTH halves of that
// statement: the dedupe mechanism (why a client-controlled member is fatal)
// and the enforcement with unique members (what the server-generated member
// guarantees).
package ratelimit

import (
	"context"
	"testing"
	"time"
)

// TestAudit_PinnedMemberDefeatsWindowCount documents the failure mechanism:
// one fixed member keeps the ZSET at a single entry no matter how many
// requests are admitted. This is exactly why internal/agent now passes a
// freshly generated id per admission (ids.RequestID()), never the inbound
// X-Request-Id.
func TestAudit_PinnedMemberDefeatsWindowCount(t *testing.T) {
	l, _ := newTestLimiter(t, true)
	ctx := context.Background()

	const limit = 5
	for i := 0; i < 20; i++ {
		v := l.Allow(ctx, "rl:rpm:user:t:u", limit, time.Minute, "client-pinned-id")
		if !v.Allowed {
			t.Fatalf("request %d: pinned member must keep the window pinned at 1 (mechanism documentation)", i)
		}
	}
	// The window count stays at 1: every ZADD overwrote the same member.
	if n := l.Count(ctx, "rl:rpm:user:t:u", time.Minute); n != 1 {
		t.Fatalf("window count = %d, want 1 (ZADD dedupe on the pinned member)", n)
	}
}

// TestAudit_UniqueMembersEnforceLimit: with per-admission unique members the
// quota is enforced exactly — the 6th request under a 5/min limit is denied
// with a retry hint, and the rejected request does not consume budget.
func TestAudit_UniqueMembersEnforceLimit(t *testing.T) {
	l, _ := newTestLimiter(t, true)
	ctx := context.Background()

	const limit = 5
	for i := 0; i < limit; i++ {
		v := l.Allow(ctx, "rl:rpm:user:t:u2", limit, time.Minute, member(i))
		if !v.Allowed {
			t.Fatalf("request %d must be allowed under a fresh window", i)
		}
	}
	denied := l.Allow(ctx, "rl:rpm:user:t:u2", limit, time.Minute, member(99))
	if denied.Allowed {
		t.Fatal("request 6 must be denied under a 5/min limit")
	}
	if denied.RetryAfter <= 0 || denied.RetryAfter > time.Minute {
		t.Fatalf("retry hint out of window bounds: %v", denied.RetryAfter)
	}
	// The denial must not have consumed budget: count still equals limit.
	if n := l.Count(ctx, "rl:rpm:user:t:u2", time.Minute); n != limit {
		t.Fatalf("denied request consumed budget: count=%d want %d", n, limit)
	}
}
