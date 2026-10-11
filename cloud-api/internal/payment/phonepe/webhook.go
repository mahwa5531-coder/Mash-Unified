package phonepe

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"

	"github.com/mash-cloud/mash-api/internal/payment"
)

// webhook.go — the PhonePe server-to-server callback. PhonePe POSTs to
// the deployment's callbackUrl with:
//
//	Body:    base64( {"response": base64(inner JSON)} )
//	Header:  X-VERIFY = sha256hex(rawBody + saltKey) + "###" + saltIndex
//
// The inner payload carries a code vocabulary (PAYMENT_SUCCESS /
// PAYMENT_ERROR / PAYMENT_DECLINED / PAYMENT_PENDING) and the
// merchantTransactionId. PhonePe does NOT send a delivery-scoped event
// id, so a deterministic id is synthesized from the raw body
// (pp_<sha256[:40]>) — at-least-once deliveries of the same payload
// dedupe; genuinely different payloads never collide.

// ParseWebhook implements payment.Provider.
func (c *Client) ParseWebhook(body []byte) (*payment.WebhookEvent, error) {
	// Outer decode: body = base64({response: base64(inner)}).
	outerJSON, err := base64.StdEncoding.DecodeString(string(body))
	if err != nil {
		return nil, fmt.Errorf("phonepe: callback body is not base64: %w", err)
	}
	var cb callbackBody
	if err := json.Unmarshal(outerJSON, &cb); err != nil {
		return nil, fmt.Errorf("phonepe: callback envelope unparseable: %w", err)
	}
	if cb.Response == "" {
		return nil, fmt.Errorf("phonepe: callback envelope missing response block")
	}
	// Inner decode: response = base64(inner payload).
	innerJSON, err := base64.StdEncoding.DecodeString(cb.Response)
	if err != nil {
		return nil, fmt.Errorf("phonepe: callback response not base64: %w", err)
	}
	var inner callbackInner
	if err := json.Unmarshal(innerJSON, &inner); err != nil {
		return nil, fmt.Errorf("phonepe: callback payload unparseable: %w", err)
	}
	if inner.Code == "" {
		return nil, fmt.Errorf("phonepe: callback payload missing code")
	}

	// Synthesized event id: deterministic over the raw body (dedupe).
	h := sha256.Sum256(body)
	ev := &payment.WebhookEvent{
		EventID:  "pp_" + hex.EncodeToString(h[:20]),
		Provider: c.Name(),
		Raw:      body,
	}

	switch inner.Code {
	case "PAYMENT_SUCCESS":
		ev.Type = payment.EventPaymentCaptured
	case "PAYMENT_ERROR", "PAYMENT_DECLINED":
		ev.Type = payment.EventPaymentFailed
	default: // PAYMENT_PENDING and anything unknown: record-only.
		ev.Type = "phonepe." + inner.Code
	}

	if ev.Handled() {
		ev.ProviderOrderID = inner.Data.MerchantTransaction
		ev.ProviderPaymentID = inner.Data.MerchantTransaction // transaction plays both roles
		ev.Status = mapCodeToPaymentStatus(inner.Code)
		ev.AmountPaise = inner.Data.Amount
		ev.Captured = inner.Code == "PAYMENT_SUCCESS"
	}
	return ev, nil
}

// BuildCallbackBody — dev/test helper: renders the wire-format callback
// body for a (code, merchantTransactionId, amount) triple.
func BuildCallbackBody(code, mTxn string, amountPaise int64) []byte {
	inner := callbackInner{Code: code}
	inner.Data.MerchantTransaction = mTxn
	inner.Data.Amount = amountPaise
	innerJSON, _ := json.Marshal(inner)
	cb := callbackBody{Response: base64.StdEncoding.EncodeToString(innerJSON)}
	outerJSON, _ := json.Marshal(cb)
	return []byte(base64.StdEncoding.EncodeToString(outerJSON))
}

// SignCallback — dev/test helper: the X-VERIFY for a callback body.
func (c *Client) SignCallback(body []byte) string {
	return callbackChecksum(body, c.saltKey) + "###" + c.saltIndex
}
