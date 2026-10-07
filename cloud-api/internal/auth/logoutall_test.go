package auth

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/mash-cloud/mash-api/internal/store/repos"
)

// TestLogoutAllRevokesEveryFamily: logout-all must revoke every live
// refresh-token family for the user (sign-out-everywhere), including families
// minted by OTHER devices, while leaving a different user's sessions alone.
func TestLogoutAllRevokesEveryFamily(t *testing.T) {
	users := newMemUsers()
	tenants := &memTenants{byUser: map[string][]memTenant{}}
	refresh := newMemRefresh()
	svc := &Service{
		Users:       users,
		Tenants:     tenants,
		RefreshRepo: refresh,
		Signer:      NewLocalSigner("x"+strings.Repeat("0", 31), "test-iss", "test-aud", 0, 15*time.Minute),
		AccessTTL:   15 * time.Minute,
		RefreshTTL:  24 * time.Hour,
	}

	// Two independent login families for usr_victim + one for usr_other.
	issue := func(userID string) string {
		t.Helper()
		rt := &repos.RefreshToken{
			ID:     "rt_" + userID + "_" + time.Now().Format("150405.000000000"),
			UserID: userID, TenantID: "ten_1", FamilyID: "fam_" + userID +
				"_" + time.Now().Format("150405.000000000"),
			TokenHash: HashToken("secret-" + userID + "-" + time.Now().String()),
			ExpiresAt: time.Now().Add(time.Hour),
		}
		if err := refresh.Issue(context.Background(), rt); err != nil {
			t.Fatalf("issue: %v", err)
		}
		return rt.TokenHash
	}
	victim1 := issue("usr_victim")
	victim2 := issue("usr_victim")
	other := issue("usr_other")

	n, err := svc.LogoutAll(context.Background(), "usr_victim", "", 0)
	if err != nil {
		t.Fatalf("LogoutAll: %v", err)
	}
	if n != 2 {
		t.Fatalf("LogoutAll must revoke exactly the victim's 2 live tokens, got %d", n)
	}

	// Every victim token is now dead: consumption reports the reuse/revoked
	// signal. The other user's token still works.
	if _, claimed, err := refresh.Consume(context.Background(), victim1); err == nil || claimed {
		t.Fatal("victim family 1 must be revoked")
	}
	if _, claimed, err := refresh.Consume(context.Background(), victim2); err == nil || claimed {
		t.Fatal("victim family 2 must be revoked")
	}
	if _, claimed, err := refresh.Consume(context.Background(), other); err != nil || !claimed {
		t.Fatalf("other user's session must survive: claimed=%v err=%v", claimed, err)
	}

	// Idempotent: a second LogoutAll finds nothing left to revoke.
	n, err = svc.LogoutAll(context.Background(), "usr_victim", "", 0)
	if err != nil || n != 0 {
		t.Fatalf("second LogoutAll must be a no-op, got n=%d err=%v", n, err)
	}
}
