// Package phonepe implements payment.Provider against the PhonePe Payment
// Gateway PG v1 "Standard Checkout" API. It owns exactly the wire
// concerns: the X-VERIFY salt-index checksum scheme, the base64-bodied
// request/response envelopes, GET-only retries, error classification and
// the hosted PAY_PAGE redirect model. Domain logic never lives here —
// the payment package owns all money decisions.
package phonepe

import "encoding/json"

// DefaultBaseURL is the production PG cluster. Preprod (test) accounts
// override via NEXAU_PHONEPE_API_BASE=https://api-preprod.phonepe.com/apis/pg
const DefaultBaseURL = "https://api.phonepe.com/apis/pg"

// payRequest is the /pg/v1/pay payload (sent base64-encoded with an
// X-VERIFY checksum over base64(payload) + path + saltKey).
type payRequest struct {
	MerchantID          string        `json:"merchantId"`
	MerchantTransaction string        `json:"merchantTransactionId"` // PAY-<ulid>
	MerchantUserID      string        `json:"merchantUserId,omitempty"`
	Amount              int64         `json:"amount"`       // paise
	RedirectURL         string        `json:"redirectUrl"`  // frontend return page (+?order_id=)
	RedirectMode        string        `json:"redirectMode"` // POST | REDIRECT
	CallbackURL         string        `json:"callbackUrl"`
	PaymentInstrument   payInstrument `json:"paymentInstrument"`
}

type payInstrument struct {
	Type string `json:"type"` // PAY_PAGE (hosted checkout)
}

// pgResponse is the shared PG v1 response envelope (decoded from JSON —
// the API responses are plain JSON; only the /pay REQUEST body and the
// callback body are base64-wrapped).
type pgResponse struct {
	Success bool            `json:"success"`
	Code    string          `json:"code"` // PAYMENT_INITIATED | PAYMENT_SUCCESS | ERROR | DECLINED | PENDING | ...
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data"`
}

// payResponseData is /pg/v1/pay's data block: the hosted PAY_PAGE url.
type payResponseData struct {
	MerchantID          string `json:"merchantId"`
	MerchantTransaction string `json:"merchantTransactionId"`
	InstrumentResponse  struct {
		RedirectInfo struct {
			URL    string `json:"url"`
			Method string `json:"method"` // GET | POST
		} `json:"redirectInfo"`
	} `json:"instrumentResponse"`
}

// statusResponseData is /pg/v1/status/{merchantId}/{mTxn}'s data block.
type statusResponseData struct {
	MerchantID          string `json:"merchantId"`
	MerchantTransaction string `json:"merchantTransactionId"`
	TransactionID       string `json:"transactionId"` // PhonePe's T… id (audit only)
	Amount              int64  `json:"amount"`
	State               string `json:"state"` // COMPLETED | FAILED | PENDING
	ResponseCode        string `json:"responseCode"`
}

// callbackBody is the base64-decoded webhook envelope.
type callbackBody struct {
	Response string `json:"response"` // base64 of callbackInner
}

// callbackInner is the decoded response block.
type callbackInner struct {
	Code    string `json:"code"` // PAYMENT_SUCCESS | PAYMENT_ERROR | PAYMENT_DECLINED | PAYMENT_PENDING
	Message string `json:"message"`
	Data    struct {
		MerchantID          string `json:"merchantId"`
		MerchantTransaction string `json:"merchantTransactionId"`
		TransactionID       string `json:"transactionId"`
		Amount              int64  `json:"amount"`
		State               string `json:"state"`
	} `json:"data"`
}

// mapCodeToOrderStatus maps PG v1 codes onto the shared provider order
// vocabulary (payment.NormalizeOrderStatus consumes it).
func mapCodeToOrderStatus(code string) string {
	switch code {
	case "PAYMENT_SUCCESS":
		return "paid"
	case "PAYMENT_ERROR", "PAYMENT_DECLINED", "TRANSACTION_NOT_FOUND":
		return "failed"
	case "PAYMENT_PENDING", "PAYMENT_INITIATED":
		return "attempted"
	default:
		return "created"
	}
}

// mapCodeToPaymentStatus maps PG v1 codes onto the shared payment
// vocabulary.
func mapCodeToPaymentStatus(code string) string {
	switch code {
	case "PAYMENT_SUCCESS":
		return "captured"
	case "PAYMENT_ERROR", "PAYMENT_DECLINED":
		return "failed"
	default:
		return "pending"
	}
}

// errorDTO is a non-2xx PG v1 error envelope (same shape as pgResponse —
// code/message carry the diagnostic).
type errorDTO = pgResponse
