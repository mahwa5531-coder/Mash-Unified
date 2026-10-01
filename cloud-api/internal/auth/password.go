package auth

import (
	"strings"
	"unicode/utf8"

	"github.com/nexau-cloud/nexau-api/internal/domain"
)

// Password policy per NIST SP 800-63B:
//   - minimum length 8 (configurable), maximum 128 (DoS bound on bcrypt);
//   - NO composition rules (no forced classes — they reduce entropy in
//     practice; NIST explicitly discourages them);
//   - screening against a common-password denylist (embedded top list;
//     the full breached-password corpus check is a deployment-side
//     integration, documented in docs/AUTH-SIGNUP-RESEARCH.md);
//   - leading/trailing whitespace rejected (copy-paste accidents).
//
// Bcrypt itself enforces a 72-byte input limit; we bound at 128 UTF-8 RUNES
// so multi-byte passphrases are measured fairly, then bcrypt truncation is
// avoided by rejecting >72 BYTES outright (silent truncation would let two
// different passwords collide on the same hash).

const (
	PasswordMinLength = 8
	PasswordMaxRunes  = 128
	PasswordMaxBytes  = 72 // bcrypt input limit
)

// ValidatePassword applies the policy; violations return PASSWORD_WEAK with a
// machine-readable reason (never a reflection of the password itself).
func ValidatePassword(pw string, minLen int) *domain.Error {
	if minLen < PasswordMinLength {
		minLen = PasswordMinLength
	}
	if pw == "" {
		return domain.ErrPasswordWeak("password is required")
	}
	if strings.TrimSpace(pw) != pw {
		return domain.ErrPasswordWeak("password must not begin or end with whitespace")
	}
	if n := utf8.RuneCountInString(pw); n < minLen {
		return domain.ErrPasswordWeak("password is shorter than the minimum length")
	} else if n > PasswordMaxRunes {
		return domain.ErrPasswordWeak("password exceeds the maximum length")
	}
	if len(pw) > PasswordMaxBytes {
		return domain.ErrPasswordWeak("password is longer than 72 bytes (bcrypt limit); use a shorter passphrase")
	}
	if _, common := commonPasswords[strings.ToLower(pw)]; common {
		return domain.ErrPasswordWeak("password appears on the common-password denylist")
	}
	return nil
}

// commonPasswords is the embedded denylist: the most-abused passwords from
// the public "100,000 worst passwords" / annual top-100 lists. Exact match,
// lowercase. (Full k-anonymity breached-password checking against the
// haveibeenpwned corpus is a production deployment integration.)
var commonPasswords = map[string]struct{}{}

func init() {
	for _, p := range []string{
		"123456", "password", "123456789", "12345678", "12345", "qwerty",
		"1234567890", "1234", "111111", "1234567", "dragon", "123123",
		"abc123", "iloveyou", "sunshine", "princess", "admin", "welcome",
		"monkey", "login", "football", "letmein", "passw0rd", "master",
		"hello", "freedom", "whatever", "qazwsx", "trustno1", "batman",
		"pass123", "pass1234", "password1", "password12", "password123",
		"password1234", "p@ssw0rd", "p@ssword", "abcd1234", "a123456",
		"123qwe", "qwe123", "1q2w3e4r", "1qaz2wsx", "zaq12wsx", "qwerty123",
		"qwertyuiop", "asdfghjkl", "zxcvbnm", "1q2w3e", "112233", "123321",
		"654321", "666666", "888888", "159753", "121212", "123abc",
		"nicole", "jordan", "jennifer", "hunter", "buster", "soccer",
		"harley", "ranger", "hunter2", "tigger", "robert", "thomas",
		"hockey", "killer", "george", "asshole", "computer", "michelle",
		"jessica", "pepper", "1111", "zxcvbn", "asdfgh", "iloveyou1",
		"loveme", "summer", "ashley", "bailey", "passwourd", "matrix",
		"secret", "ninja", "azerty", "solo", "loveme1", "starwars",
		"internet", "samsung", "google", "liverpool", "chelsea", "arsenal",
		"manchester", "pokemon", "minecraft", "superman", "test123",
		"test1234", "temp123", "welcome1", "welcome123", "letmein123",
		"changeit", "changeme", "default", "root123", "toor", "qwertz",
		"ncc1701", "nothing", "gandalf", "scooby", "michael", "shadow",
		"baseball", "young", "tester", "guest", "oracle", "access12",
	} {
		commonPasswords[p] = struct{}{}
	}
}
