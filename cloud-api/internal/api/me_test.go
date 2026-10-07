package api

import (
	"testing"
	"time"

	"github.com/mash-cloud/mash-api/internal/auth"
)

// TestWindowViewMath: the desktop usage bar derives from the gate's own math —
// percent floors at the same boundary enforcement uses (100% exactly when the
// next run is rejected), never exceeds 100, and resets_at appears only when
// the window is binding (used >= quota), carrying the exact earliest instant
// usage drops back below quota.
func TestWindowViewMath(t *testing.T) {
	a := &API{} // usage repo nil: recovery lookup degrades to omitted
	idn := &auth.Identity{Tenant: auth.TenantInfo{ID: "ten_t"}}

	v := a.windowView(nil, idn, "5h", 1000, 0, 0, 5*time.Hour)
	if v["used_percent"] != int64(0) || v["window"] != "5h" {
		t.Fatalf("empty window: %+v", v)
	}
	if v["quota_tokens"] != int64(1000) || v["used_tokens"] != int64(0) {
		t.Fatalf("token fields: %+v", v)
	}
	if v["reserved_tokens"] != int64(0) {
		t.Fatalf("reserved defaults to 0: %+v", v)
	}
	if _, has := v["resets_at"]; !has || v["resets_at"] != nil {
		t.Fatalf("under-quota resets_at must be present-and-nil: %+v", v)
	}

	// 999/1000 → 99% (admitted); 1000/1000 → 100% (rejected: used >= quota).
	if got := a.windowView(nil, idn, "5h", 1000, 999, 0, 5*time.Hour)["used_percent"]; got != int64(99) {
		t.Fatalf("999/1000 = %v, want 99", got)
	}
	if got := a.windowView(nil, idn, "5h", 1000, 1000, 0, 5*time.Hour)["used_percent"]; got != int64(100) {
		t.Fatalf("1000/1000 = %v, want 100", got)
	}
	// Over-quota clamps at 100 for display (rejection is the gate's job).
	if got := a.windowView(nil, idn, "weekly", 1000, 5000, 0, 7*24*time.Hour)["used_percent"]; got != int64(100) {
		t.Fatalf("5000/1000 = %v, want clamped 100", got)
	}
	// Rounding floors: 1/3 of quota → 33%.
	if got := a.windowView(nil, idn, "5h", 3, 1, 0, 5*time.Hour)["used_percent"]; got != int64(33) {
		t.Fatalf("1/3 = %v, want 33", got)
	}
	// The bar uses the EFFECTIVE position (used+reserved): the gate rejects
	// at effective >= quota, and the bar shows 100% exactly then.
	if got := a.windowView(nil, idn, "5h", 1000, 600, 400, 5*time.Hour)["used_percent"]; got != int64(100) {
		t.Fatalf("600 used + 400 reserved = %v, want 100 (reservation pressure)", got)
	}
	if got := a.windowView(nil, idn, "5h", 1000, 599, 400, 5*time.Hour)["used_percent"]; got != int64(99) {
		t.Fatalf("599 used + 400 reserved = %v, want 99", got)
	}
}

// TestMeViewPlanBlock: the plan identity (id/code/name) is surfaced for the
// desktop's "Free"/"Pro" label, and the quota block is omitted entirely for
// unlimited plans (both windows 0) — no misleading 0% bar.
func TestMeViewPlanBlock(t *testing.T) {
	a := &API{} // usage repo nil: quota block omitted (degraded, not wrong)
	idn := &auth.Identity{
		Plan: auth.PlanInfo{ID: "pln_pro", Code: "pro", Name: "Pro"},
		Limits: auth.Limits{
			Window5hTokens:     2_000_000,
			WindowWeeklyTokens: 10_000_000,
		},
	}
	view := a.meView(nil, idn)
	plan, ok := view["plan"].(map[string]any)
	if !ok || plan["code"] != "pro" || plan["name"] != "Pro" || plan["id"] != "pln_pro" {
		t.Fatalf("plan block: %+v", view["plan"])
	}
	// Without a usage repo the quota block is omitted entirely rather than
	// rendered wrong — enforcement math and display math must be the same
	// query or not shown at all.
	if _, has := view["quota"]; has {
		t.Fatalf("quota block must be omitted when usage repo is nil: %+v", view["quota"])
	}
	// The limits block carries the window keys verbatim.
	limits, _ := view["limits"].(map[string]any)
	if limits["window_5h_tokens"] != int64(2_000_000) || limits["window_weekly_tokens"] != int64(10_000_000) {
		t.Fatalf("limits block: %+v", limits)
	}

	// Unlimited plan: no quota block, plan still renders (zero value) so the
	// desktop can label state.
	idnUnlimited := &auth.Identity{}
	view2 := a.meView(nil, idnUnlimited)
	if _, has := view2["quota"]; has {
		t.Fatal("unlimited plan must not render a quota block")
	}
	if _, ok := view2["plan"].(map[string]any); !ok {
		t.Fatal("plan block must always render")
	}
}
