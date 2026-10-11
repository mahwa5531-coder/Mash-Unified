package stripe

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"

	"github.com/mash-cloud/mash-api/internal/payment"
)

// paymentintents.go — the payment.Provider surface over Stripe
// PaymentIntents.
//
// Model mapping (one PaymentIntent plays both provider roles):
//
//      provider order   = PaymentIntent id (pi_…) — minted by us, and
//      provider payment = the SAME PaymentIntent id — the intent IS the
//                         payment attempt in Stripe's model; the underlying
//                         charge (ch_…) arrives in payloads but is not needed
//                         to resolve or move money (it stays in the audit
//                         trail via FetchOrderPayments).

// CreateOrder implements payment.Provider — POST /payment_intents,
// single-shot (NO automatic retry), with the Stripe idempotency key set
// to the local order id:
//
// a timed-out create may have succeeded upstream; Stripe's
// Idempotency-Key would collapse a SAME-key retry safely, but a rebuilt
// request with a NEW key would mint a second intent for the same local
// order. The discipline here is stronger and simpler: never automatically
// retry a write — the caller surfaces the error and the user retries
// checkout explicitly (an uncaptured intent costs nothing).
func (c *Client) CreateOrder(ctx context.Context, req payment.CreateOrderRequest) (*payment.ProviderOrder, error) {
	form := url.Values{}
	form.Set("amount", strconv.FormatInt(req.AmountPaise, 10))
	form.Set("currency", "inr")
	form.Set("automatic_payment_methods[enabled]", "true")
	form.Set("metadata[order_id]", req.Receipt)
	for k, v := range req.Notes {
		form.Set("metadata["+k+"]", v)
	}
	// Stripe Idempotency-Key = the local order id: a SAME-request retry
	// (network replay, proxy re-send) collapses upstream instead of
	// double-charging. Automatic retries still never happen (single-shot
	// below) — this is the belt to that suspenders.
	headers := map[string]string{"Stripe-Idempotency-Key": req.Receipt}
	data, err := c.doRequestHeaders(ctx, http.MethodPost, "/payment_intents", form, headers, false /* single-shot */)
	if err != nil {
		return nil, err
	}
	var pi paymentIntentDTO
	if err := json.Unmarshal(data, &pi); err != nil || pi.ID == "" {
		return nil, &payment.ProviderError{Kind: payment.ProviderErrRequest, Detail: "unparseable payment_intent response", Err: err}
	}
	return &payment.ProviderOrder{
		ID: pi.ID, Status: mapIntentStatus(pi.Status),
		AmountPaise: pi.Amount, Currency: pi.Currency,
		ClientSecret: pi.ClientSecret, // public-by-design browser handle
	}, nil
}

// FetchOrder implements payment.Provider — GET /payment_intents/{id}
// (retryable read).
func (c *Client) FetchOrder(ctx context.Context, providerOrderID string) (*payment.ProviderOrder, error) {
	data, err := c.doRequest(ctx, http.MethodGet, "/payment_intents/"+providerOrderID, nil, true)
	if err != nil {
		return nil, err
	}
	var pi paymentIntentDTO
	if err := json.Unmarshal(data, &pi); err != nil || pi.ID == "" {
		return nil, &payment.ProviderError{Kind: payment.ProviderErrRequest, Detail: "unparseable payment_intent response", Err: err}
	}
	return &payment.ProviderOrder{
		ID: pi.ID, Status: mapIntentStatus(pi.Status),
		AmountPaise: pi.Amount, Currency: pi.Currency,
		ClientSecret: pi.ClientSecret,
	}, nil
}

// FetchPayment implements payment.Provider — GET /payment_intents/{id}.
// The intent doubles as the payment: status succeeded + amount is the
// captured truth (the service's confirm path cross-checks amount +
// linkage exactly as with razorpay payments).
func (c *Client) FetchPayment(ctx context.Context, providerPaymentID string) (*payment.ProviderPayment, error) {
	data, err := c.doRequest(ctx, http.MethodGet, "/payment_intents/"+providerPaymentID, nil, true)
	if err != nil {
		return nil, err
	}
	var pi paymentIntentDTO
	if err := json.Unmarshal(data, &pi); err != nil || pi.ID == "" {
		return nil, &payment.ProviderError{Kind: payment.ProviderErrRequest, Detail: "unparseable payment_intent response", Err: err}
	}
	captured := pi.Status == "succeeded"
	method := ""
	if pi.LastPaymentErr != nil {
		method = "card_error:" + pi.LastPaymentErr.Code
	}
	return &payment.ProviderPayment{
		ID: pi.ID, OrderID: pi.ID, // intent is both roles
		Status:      mapChargeStatus(pi.Status),
		AmountPaise: pi.Amount, Currency: pi.Currency,
		Captured: captured, Method: method,
	}, nil
}

// FetchOrderPayments implements payment.Provider — GET /charges?…
// (retryable read). Used by reconciliation to recover the charge ids for
// an intent whose success event was missed.
func (c *Client) FetchOrderPayments(ctx context.Context, providerOrderID string) ([]*payment.ProviderPayment, error) {
	form := url.Values{}
	form.Set("payment_intent", providerOrderID)
	form.Set("limit", "10")
	data, err := c.doRequest(ctx, http.MethodGet, "/charges?"+form.Encode(), nil, true)
	if err != nil {
		return nil, err
	}
	var list chargesListDTO
	if err := json.Unmarshal(data, &list); err != nil {
		return nil, &payment.ProviderError{Kind: payment.ProviderErrRequest, Detail: "unparseable charges response", Err: err}
	}
	out := make([]*payment.ProviderPayment, 0, len(list.Data))
	for _, ch := range list.Data {
		out = append(out, &payment.ProviderPayment{
			ID: ch.ID, OrderID: ch.IntentID,
			Status:      mapChargeStatus(ch.Status),
			AmountPaise: ch.Amount, Currency: ch.Currency,
			Captured: ch.Captured, Method: ch.Method,
		})
	}
	return out, nil
}
