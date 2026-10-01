package payment

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
)

// hmac.go — the ONE HMAC-SHA256 implementation in the module (both Razorpay
// schemes, hex-encoded, constant-time comparison). The razorpay client and
// the mock provider both call these; the math must never be re-typed.
//
//	Checkout handshake: HMAC(order_id + "|" + payment_id, key_secret)
//	Webhook:             HMAC(raw_request_body, webhook_secret)

// SignCheckout returns the hex HMAC for a checkout handshake pair.
func SignCheckout(orderID, paymentID, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(orderID + "|" + paymentID))
	return hex.EncodeToString(mac.Sum(nil))
}

// SignWebhook returns the hex HMAC over the exact raw body bytes.
func SignWebhook(body []byte, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

// VerifySignedHex compares a computed signature against the presented one
// in constant time — timing-leak safety is non-negotiable on money paths.
func VerifySignedHex(expected, presented string) bool {
	return hmac.Equal([]byte(expected), []byte(presented))
}
