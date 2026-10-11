package stripe

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// signature.go — the Stripe-Signature webhook scheme:
//
//      Stripe-Signature: t=<unix_ts>,v1=<hex hmac>[,v1=<rotated hex hmac>…]
//      signed payload  = "<t>." + raw_request_body
//      signature       = HMAC_SHA256(signed_payload, whsec_…)
//
// Verification is fail-closed: an unset secret never verifies, a
// malformed header never verifies, a timestamp outside the tolerance
// window (replay defense) never verifies. Multiple v1 entries support
// secret rotation: ANY match is accepted while old webhooks drain.

// defaultTolerance is the allowed clock skew / replay window, applied in
// BOTH directions (a future timestamp is as suspect as a stale one).
const defaultTolerance = 5 * time.Minute

// VerifyCheckoutSignature implements payment.Provider — Stripe has NO
// client-side checkout HMAC (Stripe.js handles completion entirely; the
// client_secret is the browser handle, not an authenticator). The
// server-side intent fetch in the confirm path is the authority, so this
// is a deliberate passthrough: "no client signature scheme exists".
func (c *Client) VerifyCheckoutSignature(orderID, paymentID, signature string) bool {
	_ = orderID
	_ = paymentID
	_ = signature
	return true
}

// VerifyWebhookSignature implements payment.Provider — t/v1 scheme with
// tolerance + rotation, constant-time compares, fail-closed.
func (c *Client) VerifyWebhookSignature(body []byte, header string) bool {
	if c.webhookSecret == "" || header == "" {
		return false
	}
	ts, sigs, ok := parseSignatureHeader(header)
	if !ok || len(sigs) == 0 {
		return false
	}
	// Replay defense: the timestamp must be inside the tolerance window.
	signedAt := time.Unix(ts, 0)
	now := time.Now()
	if now.Sub(signedAt) > defaultTolerance || signedAt.Sub(now) > defaultTolerance {
		return false
	}
	signedPayload := fmt.Sprintf("%d.", ts) + string(body)
	for _, want := range sigs {
		mac := hmac.New(sha256.New, []byte(c.webhookSecret))
		mac.Write([]byte(signedPayload))
		if hmac.Equal([]byte(hex.EncodeToString(mac.Sum(nil))), []byte(want)) {
			return true
		}
	}
	return false
}

// parseSignatureHeader extracts the timestamp and all v1 signatures.
func parseSignatureHeader(header string) (int64, []string, bool) {
	var ts int64
	var sigs []string
	for _, part := range strings.Split(header, ",") {
		k, v, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok {
			return 0, nil, false
		}
		switch k {
		case "t":
			t, err := strconv.ParseInt(v, 10, 64)
			if err != nil {
				return 0, nil, false
			}
			ts = t
		case "v1":
			sigs = append(sigs, v)
		}
	}
	if ts == 0 || len(sigs) == 0 {
		return 0, nil, false
	}
	return ts, sigs, true
}

// SignWebhookBody — dev/test helper producing a valid Stripe-Signature
// header value for a raw body at a given timestamp.
func (c *Client) SignWebhookBody(body []byte, at time.Time) string {
	ts := at.Unix()
	mac := hmac.New(sha256.New, []byte(c.webhookSecret))
	mac.Write([]byte(fmt.Sprintf("%d.", ts) + string(body)))
	return fmt.Sprintf("t=%d,v1=%s", ts, hex.EncodeToString(mac.Sum(nil)))
}
