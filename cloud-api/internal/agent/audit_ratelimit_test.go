// 2026-09-19 security audit, finding 4 — RPM bypass via client-pinned
// X-Request-Id, as a permanent regression test at the service seam.
//
// The audit reproduced: 20/20 billable runs admitted under a 5/min plan by
// sending one fixed X-Request-Id header on every request — the header value
// became the limiter's ZSET member, and ZADD with an identical member
// overwrites instead of appending, pinning the window count at 1.
//
// The fix: internal/agent passes a freshly generated id per admission
// (ids.RequestID()), never the inbound request id. This test injects the
// attack's exact precondition — a request context carrying a PINNED request
// id (as the RequestID middleware would produce from the client's header)
// — and asserts the quota still binds: 5 admitted, 6th rejected, no run
// created for the rejected call.
package agent

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/auth"
	"github.com/nexau-cloud/nexau-api/internal/domain"
	"github.com/nexau-cloud/nexau-api/internal/reqctx"
)

// TestAudit_PinnedRequestIDCannotBypassRPM: the audit's exact attack shape.
func TestAudit_PinnedRequestIDCannotBypassRPM(t *testing.T) {
	svc, runs := newIdemTestService(t)
	idn := idemTestIdentity()
	idn.Limits.RequestsPerMinuteUser = 5 // the "5/min plan" from the audit

	// The attack: one fixed X-Request-Id header on every call.
	const pinned = "attacker-pinned-req-id"
	ctx := reqctx.WithRequestID(context.Background(), pinned)

	var admitted, rejected int
	for i := 0; i < 8; i++ {
		req := idemTestRequest("rpm-" + time.Now().Format("150405.000000000") + "-" + strings.Repeat(string(rune('a'+i)), 2))
		_, _, derr := svc.CreateRun(ctx, idn, "sess_1", req)
		if derr == nil {
			admitted++
		} else {
			rejected++
			if derr.Code != "RATE_LIMITED" {
				t.Fatalf("call %d: want RATE_LIMITED, got %s (%s)", i+1, derr.Code, derr.Message)
			}
		}
	}
	if admitted != 5 || rejected != 3 {
		t.Fatalf("pinned X-Request-Id still bypasses the quota: admitted=%d rejected=%d, want 5/3", admitted, rejected)
	}

	// The rejected calls must not have created runs (no billing impact).
	runs.mu.Lock()
	n := len(runs.runs)
	runs.mu.Unlock()
	if n != 5 {
		t.Fatalf("created %d runs, want exactly 5 (rejected calls must not create billable work)", n)
	}
}

// TestAudit_UniqueRequestIDsAlsoEnforced: the honest client (fresh ids) sees
// the same quota — the fix did not overcorrect into per-request laxity.
func TestAudit_UniqueRequestIDsAlsoEnforced(t *testing.T) {
	svc, _ := newIdemTestService(t)
	idn := idemTestIdentity()
	idn.Limits.RequestsPerMinuteUser = 5

	var admitted, rejected int
	for i := 0; i < 7; i++ {
		ctx := reqctx.WithRequestID(context.Background(), "fresh-id-"+strings.Repeat(string(rune('a'+i)), 3))
		req := idemTestRequest("rpmu-" + time.Now().Format("150405.000000000") + "-" + strings.Repeat(string(rune('m'+i)), 2))
		_, _, derr := svc.CreateRun(ctx, idn, "sess_1", req)
		if derr == nil {
			admitted++
		} else {
			rejected++
		}
	}
	if admitted != 5 || rejected != 2 {
		t.Fatalf("honest client quota wrong: admitted=%d rejected=%d, want 5/2", admitted, rejected)
	}
}

var _ = domain.RunRunning // keep the domain import honest for future edits
var _ = auth.Identity{}   // keep the auth import honest for future edits
