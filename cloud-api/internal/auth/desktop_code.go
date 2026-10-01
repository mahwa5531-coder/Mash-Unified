package auth

// Web-to-desktop handshake: the 60-second single-use exchange code.
//
// The web confirmation page (already holding a short web access token) calls
// POST /v1/auth/desktop/code and receives mcode_<64hex>, valid for one
// exchange within DesktopCodeTTL (default 60s). The page delivers it to the
// desktop over TWO channels (either may be blocked by the OS/browser):
//
//   1. deep link  mash://auth/callback?code=mcode_...
//   2. loopback  POST http://localhost:8000/api/auth/login {code}
//
// The desktop (either channel's handler) calls POST /v1/auth/desktop/exchange
// exactly once; the code is consumed atomically (Lua GETDEL), so the losing
// channel's attempt fails with INVALID_OR_EXPIRED_CODE and must be treated by
// the desktop as "the other channel won" (verify via GET /v1/me instead of
// retrying).
//
// CRITICAL: long-lived refresh tokens and access tokens NEVER cross the
// browser — only the single-use short-TTL code does (an intercepted or
// history-leaked code is dead after one use or 60 seconds).

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"

	"github.com/redis/go-redis/v9"

	"github.com/nexau-cloud/nexau-api/internal/domain"
)

// desktopCodeRe pins the wire format: mcode_ + 64 lowercase hex chars.
var desktopCodeRe = regexp.MustCompile(`^mcode_[0-9a-f]{64}$`)

// platformWhitelist bounds the platform field (stored verbatim otherwise).
var platformWhitelist = map[string]bool{
	"windows": true, "macos": true, "linux": true, "android": true, "ios": true, "web": true, "other": true,
}

// desktopCode is the Redis payload of a live code.
type desktopCode struct {
	UserID   string `json:"user_id"`
	TenantID string `json:"tenant_id"`
}

// IssueDesktopCode mints a single-use code bound to the authenticated user.
// The per-user rate limit is enforced by the HTTP layer (it needs the
// resolved identity, not just the store).
func (s *Service) IssueDesktopCode(ctx context.Context, userID, tenantID string) (string, int64, error) {
	if userID == "" {
		return "", 0, domain.ErrUnauthorized(errors.New("no identity"))
	}
	code := "mcode_" + randomHex(32)
	rec, _ := json.Marshal(desktopCode{UserID: userID, TenantID: tenantID})
	if err := s.Redis.Set(ctx, "auth:desktop:code:"+code, rec, s.DesktopCodeTTL).Err(); err != nil {
		return "", 0, domain.ErrDependencyUnavailable("redis")
	}
	return code, int64(s.DesktopCodeTTL.Seconds()), nil
}

// ValidDesktopCodeShape reports whether the string matches the mcode format
// (cheap pre-check before any Redis round trip).
func ValidDesktopCodeShape(code string) bool { return desktopCodeRe.MatchString(code) }

// ExchangeDesktopCode atomically consumes the code, registers the device and
// mints a FULL token pair (access + rotating refresh) for the desktop vault.
func (s *Service) ExchangeDesktopCode(ctx context.Context, rawCode, deviceID, deviceName, platform, userAgent string) (*TokenPair, error) {
	if !ValidDesktopCodeShape(rawCode) {
		return nil, domain.ErrDesktopCode()
	}
	name := strings.TrimSpace(deviceName)
	if name == "" {
		name = "unknown device"
	}
	if len(name) > 128 {
		name = name[:128]
	}
	plat := strings.ToLower(strings.TrimSpace(platform))
	if !platformWhitelist[plat] {
		return nil, domain.ErrValidation("platform must be one of windows|macos|linux|android|ios|web|other")
	}
	if deviceID != "" && len(deviceID) > 64 {
		return nil, domain.ErrValidation("device_id exceeds the allowed length")
	}

	// Atomic single-use consume: exactly one concurrent exchange can win.
	val, ok := consumeOneTime(ctx, s.Redis, "auth:desktop:code:"+rawCode)
	if !ok {
		return nil, domain.ErrDesktopCode()
	}
	var dc desktopCode
	if err := json.Unmarshal([]byte(val), &dc); err != nil || dc.UserID == "" {
		return nil, domain.ErrDesktopCode()
	}

	u, err := s.Users.ByID(ctx, dc.UserID)
	if err != nil {
		return nil, storeMapError(err)
	}
	if u == nil || u.Status != "active" {
		return nil, &domain.Error{Code: "ACCOUNT_INACTIVE", Message: "Account is not active.", HTTP: http.StatusUnauthorized}
	}

	// Tenant: the code's binding if still valid, else the first membership.
	tenantID, role := dc.TenantID, ""
	if tenantID != "" {
		if m, err := s.Tenants.Membership(ctx, tenantID, u.ID); err == nil && m != nil && m.Status == "active" {
			role = m.Role
		}
	}
	if role == "" {
		if tenantID, role, err = s.resolveTenant(ctx, u.ID); err != nil {
			return nil, err
		}
	}

	// Register or refresh the device row (untrusted client-supplied device ids
	// degrade to a fresh row — see DevicesRepo.UpsertDevice).
	if s.Devices != nil {
		devID, err := s.Devices.UpsertDevice(ctx, u.ID, deviceID, name, plat)
		if err != nil {
			return nil, storeMapError(err)
		}
		deviceID = devID
	}

	if err := s.Users.TouchLogin(ctx, u.ID); err != nil {
		// non-fatal: the pair is still valid
		_ = err
	}

	// A fresh family rooted at this exchange (login-equivalent).
	return s.issueTokens(ctx, u, tenantID, role, deviceID, userAgent, "")
}

// ---------------------------------------------------------------------------
// one-time Redis consume
// ---------------------------------------------------------------------------

// luaGetDel atomically reads-and-deletes (cluster-safe single key; works on
// every Redis ≥ 2.6 — no GETDEL command requirement).
const luaGetDel = `local v = redis.call('GET', KEYS[1])
if v then redis.call('DEL', KEYS[1]) end
return v`

// consumeOneTime returns (value, true) for the first caller; every later
// caller (and any caller after TTL expiry) gets ("", false). Redis errors are
// fail-closed: a handshake code must never double-issue tokens.
func consumeOneTime(ctx context.Context, rc redis.UniversalClient, key string) (string, bool) {
	v, err := rc.Eval(ctx, luaGetDel, []string{key}).Result()
	if err != nil {
		return "", false
	}
	s, ok := v.(string)
	if !ok || s == "" {
		return "", false
	}
	return s, true
}
