package phonepe

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/mash-cloud/mash-api/internal/payment"
)

// orders.go — the payment.Provider surface over PhonePe PG v1.
//
// Model mapping (one PhonePe "transaction" plays both provider roles):
//
//	provider order   = merchantTransactionId ("PAY-<ulid>") — minted by us,
//	                   queryable on every PhonePe surface
//	provider payment = the same merchantTransactionId — the Standard
//	                   Checkout flow runs exactly one payment per
//	                   transaction; PhonePe's internal transactionId (T…)
//	                   arrives in payloads but is not needed to resolve or
//	                   move money (it stays in the raw audit trail)

// CreateOrder implements payment.Provider — POST /pg/v1/pay, single-shot
// (NO automatic retry: a timed-out create may have succeeded upstream; a
// blind retry would open a second transaction for the same order —
// there is no idempotency key on this endpoint, so the discipline is on us).
//
// The local order id becomes the merchantTransactionId (deterministic,
// reversible — signature.go §id translation). The redirectUrl is the
// deployment's configured frontend return page with order_id appended, so
// the SPA landing page knows exactly which order to settle/poll without
// any client-side state surviving the redirect.
func (c *Client) CreateOrder(ctx context.Context, req payment.CreateOrderRequest) (*payment.ProviderOrder, error) {
	if req.AmountPaise <= 0 {
		return nil, &payment.ProviderError{Kind: payment.ProviderErrRequest, Detail: "phonepe: amount must be positive minor units"}
	}
	mTxn, err := toMerchantTxn(req.Receipt)
	if err != nil {
		return nil, err
	}
	payload := payRequest{
		MerchantID:          c.merchantID,
		MerchantTransaction: mTxn,
		MerchantUserID:      sanitizeUserRef(req.Notes["tenant_id"]),
		Amount:              req.AmountPaise,
		RedirectURL:         withOrderIDQuery(c.redirectURL, req.Receipt),
		RedirectMode:        c.redirectMode,
		CallbackURL:         c.callbackURL,
		PaymentInstrument:   payInstrument{Type: "PAY_PAGE"},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, &payment.ProviderError{Kind: payment.ProviderErrRequest, Err: err}
	}
	data, err := c.doRequest(ctx, http.MethodPost, pathPay, body, false /* single-shot */)
	if err != nil {
		return nil, err
	}
	var resp pgResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, &payment.ProviderError{Kind: payment.ProviderErrRequest, Detail: "unparseable pay response", Err: err}
	}
	if !resp.Success {
		return nil, &payment.ProviderError{Kind: payment.ProviderErrRequest, Detail: "phonepe: pay rejected: " + resp.Code + " " + resp.Message}
	}
	var pd payResponseData
	if err := json.Unmarshal(resp.Data, &pd); err != nil {
		return nil, &payment.ProviderError{Kind: payment.ProviderErrRequest, Detail: "unparseable pay response data", Err: err}
	}
	return &payment.ProviderOrder{
		ID:          mTxn,
		Status:      mapCodeToOrderStatus(resp.Code), // PAYMENT_INITIATED → attempted
		AmountPaise: req.AmountPaise, Currency: req.Currency,
		CheckoutURL: pd.InstrumentResponse.RedirectInfo.URL, // hosted PAY_PAGE
	}, nil
}

// FetchOrder implements payment.Provider — GET /pg/v1/status/{mId}/{mTxn}
// (retryable read). The status API is the truth source for reconcile.
func (c *Client) FetchOrder(ctx context.Context, providerOrderID string) (*payment.ProviderOrder, error) {
	sd, err := c.fetchStatus(ctx, providerOrderID)
	if err != nil {
		return nil, err
	}
	return &payment.ProviderOrder{
		ID: sd.MerchantTransaction, Status: mapCodeToOrderStatus(sd.code),
		AmountPaise: sd.Amount, Currency: "INR",
	}, nil
}

// FetchPayment implements payment.Provider — same status call (one
// payment per transaction; the transaction doubles as the payment).
func (c *Client) FetchPayment(ctx context.Context, providerPaymentID string) (*payment.ProviderPayment, error) {
	sd, err := c.fetchStatus(ctx, providerPaymentID)
	if err != nil {
		return nil, err
	}
	return &payment.ProviderPayment{
		ID: sd.MerchantTransaction, OrderID: sd.MerchantTransaction,
		Status:      mapCodeToPaymentStatus(sd.code),
		AmountPaise: sd.Amount, Currency: "INR",
		Captured: sd.code == "PAYMENT_SUCCESS", Method: sd.State,
	}, nil
}

// FetchOrderPayments implements payment.Provider — the single payment
// view of the transaction (retryable read; reconcile uses it).
func (c *Client) FetchOrderPayments(ctx context.Context, providerOrderID string) ([]*payment.ProviderPayment, error) {
	p, err := c.FetchPayment(ctx, providerOrderID)
	if err != nil {
		return nil, err
	}
	return []*payment.ProviderPayment{p}, nil
}

// statusData is the decoded status response (+ the top-level code, which
// the data block does not repeat).
type statusData struct {
	code string
	statusResponseData
}

func (c *Client) fetchStatus(ctx context.Context, mTxn string) (*statusData, error) {
	if mTxn == "" {
		return nil, &payment.ProviderError{Kind: payment.ProviderErrRequest, Detail: "phonepe: empty merchantTransactionId"}
	}
	path := fmt.Sprintf("%s%s/%s", pathStatus, c.merchantID, mTxn)
	data, err := c.doRequest(ctx, http.MethodGet, path, nil, true /* retryable */)
	if err != nil {
		return nil, err
	}
	var resp pgResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return nil, &payment.ProviderError{Kind: payment.ProviderErrRequest, Detail: "unparseable status response", Err: err}
	}
	var sd statusData
	sd.code = resp.Code
	if len(resp.Data) > 0 {
		if err := json.Unmarshal(resp.Data, &sd.statusResponseData); err != nil {
			return nil, &payment.ProviderError{Kind: payment.ProviderErrRequest, Detail: "unparseable status data", Err: err}
		}
	}
	if sd.MerchantTransaction == "" {
		// Some error codes carry no data block; echo the queried id so the
		// caller's provider-order linkage still resolves.
		sd.MerchantTransaction = mTxn
	}
	return &sd, nil
}
