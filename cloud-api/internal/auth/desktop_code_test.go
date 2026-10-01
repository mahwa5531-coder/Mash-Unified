package auth

// Web-to-desktop handshake: the 60-second single-use exchange code, over the
// REAL Redis semantics (miniredis + the Lua GETDEL consume) and the REAL
// service pipeline (device registration → token family minting). The
// concurrent single-winner test is the load-bearing one: both handshake
// channels (deep link + localhost loopback) race the same code and exactly
// one TokenPair may ever exist per code.

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"github.com/nexau-cloud/nexau-api/internal/domain"
)

type desktopEnv struct {
	svc     *Service
	mr      *miniredis.Miniredis
	rdb     *redis.Client
	users   *memUsers
	tenants *memTenants
	devices *fakeDevices
}

func newDesktopEnv(t *testing.T) *desktopEnv {
	t.Helper()
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	users := newMemUsers()
	tenants := &memTenants{byUser: map[string][]memTenant{}}
	devices := &fakeDevices{}

	u := &domain.User{ID: "usr_handshake", Email: "handshake@example.test", Status: "active", AuthProvider: "local"}
	users.byID[u.ID] = &memUser{u: *u}
	users.byEm[u.Email] = users.byID[u.ID]
	tenants.byUser[u.ID] = []memTenant{{tenantID: "ten_handshake", role: "owner"}}

	svc := &Service{
		Users:       users,
		Tenants:     tenants,
		RefreshRepo: newMemRefresh(),
		Redis:       rdb,
		Signer:      NewLocalSigner(testSecret, testIssuer, testAud, 0, time.Hour),
		AccessTTL:   time.Hour, RefreshTTL: 24 * time.Hour,
		Devices:        devices,
		DesktopCodeTTL: 60 * time.Second,
	}
	return &desktopEnv{svc: svc, mr: mr, rdb: rdb, users: users, tenants: tenants, devices: devices}
}

func TestValidDesktopCodeShape(t *testing.T) {
	if !ValidDesktopCodeShape("mcode_" + strings.Repeat("a", 64)) {
		t.Fatal("valid shape rejected")
	}
	for _, bad := range []string{
		"", "mcode_",
		"mcode_" + strings.Repeat("A", 64), // uppercase
		"mcode_" + strings.Repeat("g", 64), // non-hex
		"mcode_" + strings.Repeat("a", 63), // short
		"mcodes_" + strings.Repeat("a", 62),
		"mcode_" + strings.Repeat("a", 65), // long
	} {
		if ValidDesktopCodeShape(bad) {
			t.Fatalf("invalid shape accepted: %q", bad)
		}
	}
}

func TestIssueDesktopCode(t *testing.T) {
	env := newDesktopEnv(t)
	ctx := context.Background()

	code, ttl, err := env.svc.IssueDesktopCode(ctx, "usr_handshake", "ten_handshake")
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if !ValidDesktopCodeShape(code) {
		t.Fatalf("shape: %q", code)
	}
	if ttl != 60 {
		t.Fatalf("ttl: %d", ttl)
	}
	if !env.mr.Exists("auth:desktop:code:" + code) {
		t.Fatal("redis key missing")
	}
}

func TestExchangeDesktopCodeHappyPath(t *testing.T) {
	env := newDesktopEnv(t)
	ctx := context.Background()

	code, _, err := env.svc.IssueDesktopCode(ctx, "usr_handshake", "ten_handshake")
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	pair, err := env.svc.ExchangeDesktopCode(ctx, code, "", "Rama Windows PC", "windows", "desktop-agent/1.0")
	if err != nil {
		t.Fatalf("exchange: %v", err)
	}
	if pair.AccessToken == "" || pair.RefreshToken == "" || pair.User.ID != "usr_handshake" {
		t.Fatalf("pair: %+v", pair)
	}
	// Access token verifies and is bound to the tenant + the new device.
	claims, err := env.svc.Signer.Verify(ctx, pair.AccessToken)
	if err != nil {
		t.Fatalf("verify access: %v", err)
	}
	if claims.Subject != "usr_handshake" || claims.TenantID != "ten_handshake" || claims.DeviceID == "" {
		t.Fatalf("claims: %+v", claims)
	}
	// The refresh token rotates in a real family.
	rotated, err := env.svc.Refresh(ctx, pair.RefreshToken, "desktop-agent/1.0")
	if err != nil {
		t.Fatalf("rotate: %v", err)
	}
	if rotated.AccessToken == "" {
		t.Fatal("rotation minted no token")
	}
	// Device row was written.
	if len(env.devices.calls) != 1 || !strings.Contains(env.devices.calls[0], "Rama Windows PC/windows") {
		t.Fatalf("device calls: %v", env.devices.calls)
	}
	// Code is gone.
	if env.mr.Exists("auth:desktop:code:" + code) {
		t.Fatal("code survived exchange")
	}
}

func TestExchangeDesktopCodeReplayFails(t *testing.T) {
	env := newDesktopEnv(t)
	ctx := context.Background()

	code, _, _ := env.svc.IssueDesktopCode(ctx, "usr_handshake", "ten_handshake")
	if _, err := env.svc.ExchangeDesktopCode(ctx, code, "", "PC", "windows", ""); err != nil {
		t.Fatalf("first exchange: %v", err)
	}
	if _, err := env.svc.ExchangeDesktopCode(ctx, code, "", "PC", "windows", ""); err == nil {
		t.Fatal("replay accepted")
	}
}

func TestExchangeDesktopCodeConcurrentSingleWinner(t *testing.T) {
	env := newDesktopEnv(t)
	ctx := context.Background()

	code, _, _ := env.svc.IssueDesktopCode(ctx, "usr_handshake", "ten_handshake")

	const n = 8
	var wg sync.WaitGroup
	var mu sync.Mutex
	var wins, fails int
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			pair, err := env.svc.ExchangeDesktopCode(ctx, code, "", "PC", "windows", "")
			mu.Lock()
			defer mu.Unlock()
			if err == nil && pair != nil && pair.AccessToken != "" {
				wins++
			} else {
				de := domain.AsError(err)
				if de != nil && de.Code == "INVALID_OR_EXPIRED_CODE" {
					fails++
				} else {
					t.Errorf("unexpected error class: %v", err)
				}
			}
		}()
	}
	wg.Wait()
	if wins != 1 || fails != n-1 {
		t.Fatalf("wins=%d fails=%d want 1/%d", wins, fails, n-1)
	}
}

func TestExchangeDesktopCodeExpiry(t *testing.T) {
	env := newDesktopEnv(t)
	env.svc.DesktopCodeTTL = 110 * time.Millisecond // test-only shrink
	ctx := context.Background()

	code, _, _ := env.svc.IssueDesktopCode(ctx, "usr_handshake", "ten_handshake")
	env.mr.FastForward(200 * time.Millisecond)
	if _, err := env.svc.ExchangeDesktopCode(ctx, code, "", "PC", "windows", ""); err == nil {
		t.Fatal("expired code accepted")
	}
}

func TestExchangeDesktopCodeValidation(t *testing.T) {
	env := newDesktopEnv(t)
	ctx := context.Background()
	code, _, _ := env.svc.IssueDesktopCode(ctx, "usr_handshake", "ten_handshake")

	for name, tc := range map[string]struct {
		code, dev, plat string
		wantCode        string
	}{
		"bad shape":        {"mcode_nope", "", "windows", "INVALID_OR_EXPIRED_CODE"},
		"bad platform":     {code, "", "templeos", "INVALID_REQUEST"},
		"unknown platform": {code, "", "", "INVALID_REQUEST"},
	} {
		if _, err := env.svc.ExchangeDesktopCode(ctx, tc.code, "", tc.dev, tc.plat, ""); err == nil {
			t.Fatalf("%s: accepted", name)
		} else {
			de := domain.AsError(err)
			if de == nil || de.Code != tc.wantCode {
				t.Fatalf("%s: code=%v want=%s", name, de, tc.wantCode)
			}
		}
	}
	// Validation failures must NOT burn the code.
	if _, err := env.svc.ExchangeDesktopCode(ctx, code, "", "PC", "windows", ""); err != nil {
		t.Fatalf("code burned by validation failures: %v", err)
	}
}

func TestConsumeOneTimeRedisDown(t *testing.T) {
	// Fail-closed posture: when Redis errors, a code must never issue tokens.
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	mr.SetError("boom")

	if _, ok := consumeOneTime(context.Background(), rdb, "auth:desktop:code:x"); ok {
		t.Fatal("consume succeeded on a broken redis")
	}
}
