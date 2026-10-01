package auth

import (
	"net/http"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func newReqWithAuth(header string) *http.Request {
	r, _ := http.NewRequest(http.MethodGet, "/", nil)
	if header != "" {
		r.Header.Set("Authorization", header)
	}
	return r
}

// signRaw mints a token without a `sub` claim (contract violation probe).
func signRaw(t *testing.T, s *LocalSigner) string {
	t.Helper()
	claims := jwt.MapClaims{
		"iss": testIssuer, "aud": testAud,
		"iat": time.Now().Unix(), "exp": time.Now().Add(time.Minute).Unix(),
		"jti": "jti_x", "tid": "ten_1",
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	out, err := tok.SignedString([]byte(testSecret))
	if err != nil {
		t.Fatalf("signRaw: %v", err)
	}
	return out
}
