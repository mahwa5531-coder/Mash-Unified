// Package razorpay implements payment.Provider against the Razorpay
// REST API (https://api.razorpay.com/v1). It owns exactly the wire
// concerns: authentication, request/response DTOs, retries, error
// classification and both HMAC signature schemes. Domain logic never
// lives here — the payment package owns all money decisions.
package razorpay

// DefaultBaseURL — override (NEXAU_RAZORPAY_API_BASE) exists for tests
// and proxied deployments only.
const DefaultBaseURL = "https://api.razorpay.com/v1"

// orderDTO is the /orders wire shape (create response + fetch response).
type orderDTO struct {
	ID       string `json:"id"`
	Amount   int64  `json:"amount"` // paise
	Currency string `json:"currency"`
	Receipt  string `json:"receipt"`
	Status   string `json:"status"` // created | paid | attempted
}

// createOrderRequest is the POST /orders body.
type createOrderRequest struct {
	Amount   int64             `json:"amount"` // paise
	Currency string            `json:"currency"`
	Receipt  string            `json:"receipt,omitempty"`
	Notes    map[string]string `json:"notes,omitempty"`
}

// paymentDTO is the /payments/{id} wire shape.
type paymentDTO struct {
	ID       string `json:"id"`
	OrderID  string `json:"order_id"`
	Amount   int64  `json:"amount"`
	Currency string `json:"currency"`
	Status   string `json:"status"` // captured | failed | refunded | ...
	Method   string `json:"method"`
	Captured bool   `json:"captured"`
}

// errorDTO is Razorpay's error envelope:
//
//	{"error":{"code":"BAD_REQUEST","description":"...","field":"amount"}}
type errorDTO struct {
	Error struct {
		Code        string `json:"code"`
		Description string `json:"description"`
		Field       string `json:"field"`
	} `json:"error"`
}
