package auth

import (
	"context"
	"testing"
	"time"
)

const (
	testSecret = "0123456789abcdef0123456789abcdef0123456789abcdef"
	testIssuer = "https://auth.nexau.test"
	testAud    = "nexau-cloud-api-test"
)

func newTestSigner(ttl time.Duration) *LocalSigner {
	return NewLocalSigner(testSecret, testIssuer, testAud, 0, ttl)
}

func TestLocalSignerRoundTrip(t *testing.T) {
	s := newTestSigner(15 * time.Minute)
	tok, err := s.Sign("usr_1", "ten_1", "member", "", "jti_1", time.Now())
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}
	claims, err := s.Verify(context.Background(), tok)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if claims.Subject != "usr_1" || claims.TenantID != "ten_1" || claims.Role != "member" {
		t.Fatalf("claims mismatch: %+v", claims)
	}
	if claims.TokenID != "jti_1" {
		t.Fatalf("jti mismatch: %q", claims.TokenID)
	}
	if claims.Method != "local" {
		t.Fatalf("method: %q", claims.Method)
	}
}

func TestLocalSignerExpired(t *testing.T) {
	s := newTestSigner(-time.Minute) // already expired
	tok, _ := s.Sign("usr_1", "ten_1", "member", "", "jti_1", time.Now())
	_, err := s.Verify(context.Background(), tok)
	if err == nil {
		t.Fatal("expired token must fail")
	}
	if tc, ok := err.(ErrTokenClass); !ok || tc.Kind != "expired" {
		t.Fatalf("expected expired classification, got %v", err)
	}
}

func TestLocalSignerWrongSecret(t *testing.T) {
	s := newTestSigner(15 * time.Minute)
	tok, _ := s.Sign("usr_1", "ten_1", "member", "", "jti_1", time.Now())
	other := NewLocalSigner("another-secret-32-bytes-long-xxxxxxxxx", testIssuer, testAud, 0, time.Minute)
	if _, err := other.Verify(context.Background(), tok); err == nil {
		t.Fatal("wrong-secret token must fail")
	}
}

func TestLocalSignerWrongAudience(t *testing.T) {
	s := newTestSigner(15 * time.Minute)
	tok, _ := s.Sign("usr_1", "ten_1", "member", "", "jti_1", time.Now())
	other := NewLocalSigner(testSecret, testIssuer, "other-audience", 0, time.Minute)
	if _, err := other.Verify(context.Background(), tok); err == nil {
		t.Fatal("wrong-audience token must fail")
	}
}

func TestLocalSignerGarbage(t *testing.T) {
	s := newTestSigner(time.Minute)
	for _, tok := range []string{"", "garbage", "a.b", "a.b.c.d", "eyJhbGciOiJIUzI1NiJ9.e30.nothing"} {
		if _, err := s.Verify(context.Background(), tok); err == nil {
			t.Fatalf("garbage token %q must fail", tok)
		}
	}
}

func TestClaimsMissingSubject(t *testing.T) {
	// A token with no sub: signed correctly but invalid for our contract.
	s := newTestSigner(time.Minute)
	// Sign manually to omit sub.
	tok := signRaw(t, s)
	if _, err := s.Verify(context.Background(), tok); err == nil {
		t.Fatal("missing sub must fail")
	}
}

func TestHashTokenStable(t *testing.T) {
	a, b := HashToken("secret-1"), HashToken("secret-1")
	if a != b {
		t.Fatal("hash must be deterministic")
	}
	if HashToken("secret-1") == HashToken("secret-2") {
		t.Fatal("hash must differ per input")
	}
	if len(a) != 64 {
		t.Fatalf("sha256 hex length: %d", len(a))
	}
}

func TestBearerTokenExtraction(t *testing.T) {
	cases := []struct {
		header string
		want   string
	}{
		{"", ""},
		{"Bearer abc", "abc"},
		{"bearer abc", "abc"},
		{"BEARER abc", "abc"},
		{"Bearer  spaced  ", "spaced"}, // TrimSpace applied
		{"Basic abc", ""},
		{"Bearer", ""},
		{"Bearer " + string(make([]byte, 9000)), ""}, // oversize
	}
	for _, c := range cases {
		r := newReqWithAuth(c.header)
		if got := bearerToken(r); got != c.want {
			t.Errorf("bearerToken(%q) = %q, want %q", c.header, got, c.want)
		}
	}
}

func TestIdentityCanRun(t *testing.T) {
	base := func() *Identity {
		return &Identity{
			User:               UserInfo{Status: "active"},
			Tenant:             TenantInfo{Status: "active"},
			Membership:         MembershipInfo{Status: "active"},
			SubscriptionStatus: "active",
		}
	}
	if base().CanRun() != "" {
		t.Fatal("healthy identity must pass")
	}
	id := base()
	id.User.Status = "suspended"
	if id.CanRun() != "ACCOUNT_SUSPENDED" {
		t.Fatalf("suspended user: %q", id.CanRun())
	}
	id = base()
	id.Tenant.Status = "suspended"
	if id.CanRun() != "TENANT_SUSPENDED" {
		t.Fatalf("suspended tenant: %q", id.CanRun())
	}
	id = base()
	id.Membership.Status = "suspended"
	if id.CanRun() != "MEMBERSHIP_SUSPENDED" {
		t.Fatalf("suspended membership: %q", id.CanRun())
	}
	id = base()
	id.SubscriptionStatus = "canceled"
	if id.CanRun() != "SUBSCRIPTION_INACTIVE" {
		t.Fatalf("inactive subscription: %q", id.CanRun())
	}
	// past_due keeps grace access.
	id = base()
	id.SubscriptionStatus = "past_due"
	if id.CanRun() != "" {
		t.Fatalf("past_due should be effective: %q", id.CanRun())
	}
}
