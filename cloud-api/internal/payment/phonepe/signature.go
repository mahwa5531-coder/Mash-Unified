package phonepe

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/mash-cloud/mash-api/internal/payment"
)

// signature.go — the X-VERIFY scheme: every request/response kind has its
// own checksum BASE; the header is always
//
//      X-VERIFY = hex(sha256(base)) + "###" + saltIndex
//
// Three bases (PG v1 spec):
//
//      pay request:  base64(payloadJSON) + "/pg/v1/pay" + saltKey
//      status fetch: "/pg/v1/status/{merchantId}/{merchantTransactionId}" + saltKey
//      callback:     rawBody + saltKey
//
// The salt KEY is the server secret; the salt INDEX ("1") just selects the
// active key in the dashboard. Verification is fail-closed: an unset key
// never verifies; comparison is constant-time.

const (
	pathPay    = "/pg/v1/pay"
	pathStatus = "/pg/v1/status/" // + {merchantId}/{mTxn}
)

// payChecksum computes the X-VERIFY for a /pg/v1/pay request payload.
func payChecksum(payloadJSON []byte, saltKey string) string {
	base := base64.StdEncoding.EncodeToString(payloadJSON) + pathPay + saltKey
	return sha256Hex(base)
}

// statusChecksum computes the X-VERIFY for a status fetch (apiPath is the
// full request path: /pg/v1/status/{merchantId}/{mTxn}).
func statusChecksum(apiPath, saltKey string) string {
	return sha256Hex(apiPath + saltKey)
}

// callbackChecksum computes the X-VERIFY for an inbound callback (over
// the EXACT raw body bytes).
func callbackChecksum(rawBody []byte, saltKey string) string {
	return sha256Hex(string(rawBody) + saltKey)
}

// verifyHeader checks a presented X-VERIFY value (checksum###index form)
// against a computed checksum — constant time.
func verifyHeader(expectedChecksum, presented string) bool {
	return hmac.Equal([]byte(expectedChecksum), []byte(presented))
}

func sha256Hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

// VerifyCheckoutSignature implements payment.Provider — PhonePe Standard
// Checkout has NO client-side HMAC (the browser never holds a secret; it
// is redirected to the hosted PAY_PAGE wholesale). The server-side status
// fetch in the confirm path is the authority, so this is a deliberate
// passthrough: "no client signature scheme exists".
func (c *Client) VerifyCheckoutSignature(orderID, paymentID, signature string) bool {
	_ = orderID
	_ = paymentID
	_ = signature
	return true
}

// VerifyWebhookSignature implements payment.Provider — X-VERIFY over the
// raw callback body (base = rawBody + saltKey), presented as
// checksum + "###" + saltIndex.
func (c *Client) VerifyWebhookSignature(body []byte, header string) bool {
	if c.saltKey == "" || header == "" {
		return false
	}
	checksum, _, ok := splitVerifyHeader(header)
	if !ok {
		return false
	}
	return verifyHeader(callbackChecksum(body, c.saltKey), checksum)
}

// splitVerifyHeader splits "checksum###saltIndex".
func splitVerifyHeader(header string) (checksum, index string, ok bool) {
	checksum, index, ok = strings.Cut(strings.TrimSpace(header), "###")
	if !ok || checksum == "" || index == "" {
		return "", "", false
	}
	return checksum, index, true
}

// --- merchantTransactionId translation ----------------------------------------
//
// The local order id (pay_01JD…) is deterministic, reversible translated
// to PhonePe's merchantTransactionId (PAY-01JD…): the provider requires
// uppercase alphanumerics, and a deterministic mapping keeps support
// one-hop in both directions (no lookup table, no drift).

const (
	merchantTxnPrefix = "PAY-"
	localOrderPrefix  = "pay_"
	maxMerchantTxnLen = 35
)

// toMerchantTxn translates a local order id (pay_01JD…) to PhonePe's
// merchantTransactionId (PAY-01JD…).
func toMerchantTxn(localOrderID string) (string, error) {
	suffix, ok := strings.CutPrefix(localOrderID, localOrderPrefix)
	if !ok || suffix == "" {
		return "", &payment.ProviderError{
			Kind:   payment.ProviderErrRequest,
			Detail: fmt.Sprintf("phonepe: local order id %q must have the %q prefix", localOrderID, localOrderPrefix),
		}
	}
	mTxn := merchantTxnPrefix + suffix
	if err := validateMerchantTxn(mTxn); err != nil {
		return "", err
	}
	return mTxn, nil
}

// fromMerchantTxn translates back (PAY-01JD… → pay_01JD…).
func fromMerchantTxn(mTxn string) (string, error) {
	suffix, ok := strings.CutPrefix(mTxn, merchantTxnPrefix)
	if !ok || suffix == "" {
		return "", fmt.Errorf("phonepe: merchantTransactionId %q missing %q prefix", mTxn, merchantTxnPrefix)
	}
	local := localOrderPrefix + suffix
	if err := validateMerchantTxn(mTxn); err != nil {
		return "", err
	}
	return local, nil
}

// validateMerchantTxn enforces the PG v1 constraints: ≤35 chars,
// alphanumeric + - . _ (our ULID suffixes are lowercase Crockford base32,
// which PhonePe accepts — the guard is charset hygiene, not casing).
func validateMerchantTxn(mTxn string) error {
	if len(mTxn) > maxMerchantTxnLen {
		return &payment.ProviderError{
			Kind:   payment.ProviderErrRequest,
			Detail: fmt.Sprintf("phonepe: merchantTransactionId %q exceeds %d chars", mTxn, maxMerchantTxnLen),
		}
	}
	for _, r := range mTxn {
		switch {
		case r >= '0' && r <= '9':
		case r >= 'A' && r <= 'Z', r >= 'a' && r <= 'z':
		case r == '-', r == '.', r == '_':
		default:
			return &payment.ProviderError{
				Kind:   payment.ProviderErrRequest,
				Detail: fmt.Sprintf("phonepe: merchantTransactionId %q has invalid character %q", mTxn, r),
			}
		}
	}
	return nil
}

// withOrderIDQuery appends the local order id to the configured frontend
// return URL so the landing page knows which order to settle/poll without
// any client-side state surviving the redirect.
func withOrderIDQuery(redirectURL, orderID string) string {
	sep := "?"
	if strings.Contains(redirectURL, "?") {
		sep = "&"
	}
	return redirectURL + sep + "order_id=" + orderID
}

// sanitizeUserRef narrows a tenant id to the PG v1 charset (lowercase
// alphanumerics + . _ - @): a ten_… id passes through untouched.
func sanitizeUserRef(tenantID string) string {
	var b strings.Builder
	for _, r := range tenantID {
		switch {
		case r >= '0' && r <= '9', r >= 'a' && r <= 'z',
			r == '.', r == '_', r == '-', r == '@':
			b.WriteRune(r)
		case r >= 'A' && r <= 'Z':
			b.WriteRune(r + ('a' - 'A'))
		default:
			b.WriteByte('_')
		}
	}
	return b.String()
}
