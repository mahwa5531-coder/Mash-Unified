package razorpay

import (
	"github.com/mash-cloud/mash-api/internal/payment"
)

// signature.go — fail-closed wrappers around the module's single HMAC
// implementation (payment/hmac.go). An unset secret must NEVER verify.

// VerifyCheckoutSignature implements payment.Provider.
func (c *Client) VerifyCheckoutSignature(orderID, paymentID, signature string) bool {
	if c.keySecret == "" {
		return false
	}
	return payment.VerifySignedHex(payment.SignCheckout(orderID, paymentID, c.keySecret), signature)
}

// VerifyWebhookSignature implements payment.Provider. The signature is over
// the EXACT raw bytes received — the api layer passes the untouched body.
func (c *Client) VerifyWebhookSignature(body []byte, signature string) bool {
	if c.webhookSecret == "" {
		return false
	}
	return payment.VerifySignedHex(payment.SignWebhook(body, c.webhookSecret), signature)
}

// SignCheckoutPair — dev/test helper producing a valid handshake signature.
func (c *Client) SignCheckoutPair(orderID, paymentID string) string {
	return payment.SignCheckout(orderID, paymentID, c.keySecret)
}

// SignWebhookBody — dev/test helper producing a valid webhook signature.
func (c *Client) SignWebhookBody(body []byte) string {
	return payment.SignWebhook(body, c.webhookSecret)
}
