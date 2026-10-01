package razorpay

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/nexau-cloud/nexau-api/internal/payment"
)

// CreateOrder implements payment.Provider — POST /orders, single-shot
// (NO automatic retry, by deliberate design):
//
// a timed-out create may have succeeded upstream; a blind retry would
// mint a SECOND provider order for the same local receipt. The local row
// is only written after the provider responds, so a failed create leaves
// nothing behind — the caller surfaces the error and the user retries
// checkout explicitly (an unpaid Razorpay order costs nothing; orphan
// provider orders are GC'd by Razorpay after their own expiry).
func (c *Client) CreateOrder(ctx context.Context, req payment.CreateOrderRequest) (*payment.ProviderOrder, error) {
	body, err := json.Marshal(createOrderRequest{
		Amount: req.AmountPaise, Currency: req.Currency,
		Receipt: req.Receipt, Notes: req.Notes,
	})
	if err != nil {
		return nil, &payment.ProviderError{Kind: payment.ProviderErrRequest, Err: err}
	}
	data, err := c.doRequest(ctx, http.MethodPost, "/orders", body, false /* no retry */)
	if err != nil {
		return nil, err
	}
	var o orderDTO
	if err := json.Unmarshal(data, &o); err != nil || o.ID == "" {
		return nil, &payment.ProviderError{Kind: payment.ProviderErrRequest, Detail: "unparseable order response", Err: err}
	}
	return &payment.ProviderOrder{
		ID: o.ID, Status: o.Status, AmountPaise: o.Amount, Currency: o.Currency,
	}, nil
}

// FetchOrder implements payment.Provider — GET /orders/{id} (retryable:
// reads are always safe to repeat).
func (c *Client) FetchOrder(ctx context.Context, providerOrderID string) (*payment.ProviderOrder, error) {
	data, err := c.doRequest(ctx, http.MethodGet, "/orders/"+providerOrderID, nil, true)
	if err != nil {
		return nil, err
	}
	var o orderDTO
	if err := json.Unmarshal(data, &o); err != nil || o.ID == "" {
		return nil, &payment.ProviderError{Kind: payment.ProviderErrRequest, Detail: "unparseable order response", Err: err}
	}
	return &payment.ProviderOrder{
		ID: o.ID, Status: o.Status, AmountPaise: o.Amount, Currency: o.Currency,
	}, nil
}

// FetchPayment implements payment.Provider — GET /payments/{id}
// (retryable read).
func (c *Client) FetchPayment(ctx context.Context, providerPaymentID string) (*payment.ProviderPayment, error) {
	data, err := c.doRequest(ctx, http.MethodGet, "/payments/"+providerPaymentID, nil, true)
	if err != nil {
		return nil, err
	}
	var p paymentDTO
	if err := json.Unmarshal(data, &p); err != nil || p.ID == "" {
		return nil, &payment.ProviderError{Kind: payment.ProviderErrRequest, Detail: "unparseable payment response", Err: err}
	}
	return &payment.ProviderPayment{
		ID: p.ID, OrderID: p.OrderID, Status: p.Status,
		AmountPaise: p.Amount, Currency: p.Currency,
		Captured: p.Captured, Method: p.Method,
	}, nil
}

// FetchOrderPayments implements payment.Provider —
// GET /orders/{id}/payments (retryable read; envelope {items:[...]}).
func (c *Client) FetchOrderPayments(ctx context.Context, providerOrderID string) ([]*payment.ProviderPayment, error) {
	data, err := c.doRequest(ctx, http.MethodGet, "/orders/"+providerOrderID+"/payments", nil, true)
	if err != nil {
		return nil, err
	}
	var resp struct {
		Items []paymentDTO `json:"items"`
	}
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, &payment.ProviderError{Kind: payment.ProviderErrRequest, Detail: "unparseable payments response", Err: err}
	}
	out := make([]*payment.ProviderPayment, 0, len(resp.Items))
	for i := range resp.Items {
		p := resp.Items[i]
		out = append(out, &payment.ProviderPayment{
			ID: p.ID, OrderID: p.OrderID, Status: p.Status,
			AmountPaise: p.Amount, Currency: p.Currency,
			Captured: p.Captured, Method: p.Method,
		})
	}
	return out, nil
}

// ParseWebhook implements payment.Provider. The envelope parse lives in
// the payment package (shared with MockProvider so both providers accept
// byte-identical payloads); this wrapper adds the provider stamp.
func (c *Client) ParseWebhook(body []byte) (*payment.WebhookEvent, error) {
	ev, err := payment.ParseWebhookEnvelope(body)
	if err != nil {
		return nil, fmt.Errorf("razorpay: %w", err)
	}
	ev.Provider = c.Name()
	return ev, nil
}

// Compile-time contract check.
var _ payment.Provider = (*Client)(nil)
