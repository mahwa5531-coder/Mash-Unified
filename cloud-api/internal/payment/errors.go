package payment

import (
	"errors"
	"net/http"

	"github.com/mash-cloud/mash-api/internal/domain"
)

// Typed sentinel errors. The service never returns raw strings: every
// failure that can reach a client maps onto a domain.Error exactly once,
// here (server-internal failures stay opaque INTERNAL by design — no
// provider details, no stack, no amounts).

var (
	// ErrDisabled — payments not configured on this deployment (503).
	ErrDisabled = func() *domain.Error {
		return &domain.Error{Code: "PAYMENTS_DISABLED", Message: "Payments are not enabled on this deployment.", HTTP: http.StatusServiceUnavailable}
	}()

	// ErrPackNotFound — catalog miss (404).
	ErrPackNotFound = func(packID string) *domain.Error {
		return &domain.Error{Code: "PACK_NOT_FOUND", Message: "The requested credit pack is not available.", HTTP: http.StatusNotFound, Details: map[string]any{"pack_id": packID}}
	}

	// ErrOrderNotFound — unknown or cross-tenant order (404; identical body
	// for both — no existence oracle across tenants).
	ErrOrderNotFound = func() *domain.Error {
		return domain.ErrNotFound("payment order")
	}

	// ErrOrderNotOpen — confirm/reconcile on a terminal order (409).
	ErrOrderNotOpen = func(status string) *domain.Error {
		return &domain.Error{Code: "ORDER_NOT_OPEN", Message: "This payment order is no longer open.", HTTP: http.StatusConflict, Details: map[string]any{"status": status}}
	}

	// ErrBadSignature — checkout handshake signature mismatch (400; generic
	// message: never reveal WHICH check failed).
	ErrBadSignature = func() *domain.Error {
		return &domain.Error{Code: "PAYMENT_SIGNATURE_INVALID", Message: "The payment confirmation could not be verified.", HTTP: http.StatusBadRequest}
	}

	// ErrWebhookSignature — webhook HMAC failure (401). Fail-closed.
	ErrWebhookSignature = func() *domain.Error {
		return &domain.Error{Code: "WEBHOOK_SIGNATURE_INVALID", Message: "Invalid webhook signature.", HTTP: http.StatusUnauthorized}
	}

	// ErrAmountMismatch — provider-reported amount ≠ order amount (409 +
	// order stays pending; this is a tamper/alarm signal, logged loudly).
	ErrAmountMismatch = func(expected, got int64) *domain.Error {
		return &domain.Error{Code: "PAYMENT_AMOUNT_MISMATCH", Message: "The payment amount does not match the order.", HTTP: http.StatusConflict, Details: map[string]any{"expected_paise": expected, "received_paise": got}}
	}

	// ErrProviderUnavailable — upstream 5xx/network (503 DEPENDENCY_UNAVAILABLE).
	ErrProviderUnavailable = func(cause error) *domain.Error {
		return domain.ErrDependencyUnavailable("payment_provider")
	}

	// ErrProviderAuth — bad key id/secret (502; operator problem, the client
	// cannot fix it, but retrying later is pointless until keys change).
	ErrProviderAuth = func() *domain.Error {
		return &domain.Error{Code: "PAYMENT_PROVIDER_AUTH", Message: "The payment provider rejected this deployment's credentials.", HTTP: http.StatusBadGateway}
	}

	// ErrProviderRequest — 4xx from provider, request-side problem (502
	// opaque; the API layer already validated inputs, so this is a contract
	// drift or account-state issue worth paging an operator).
	ErrProviderRequest = func(cause error) *domain.Error {
		return &domain.Error{Code: "PAYMENT_PROVIDER_ERROR", Message: "The payment provider rejected the request.", HTTP: http.StatusBadGateway, Cause: cause}
	}

	// errCheckoutBudget — per-user checkout budget exhausted (429).
	errCheckoutBudget = func() *domain.Error {
		return &domain.Error{Code: "RATE_LIMITED", Message: "Too many checkout requests. Please wait and retry.", HTTP: http.StatusTooManyRequests, Details: map[string]any{"scope": "checkout_user"}}
	}()

	// errIdemReuse — same Idempotency-Key, different pack (422; mirrors the
	// runs idempotency contract exactly).
	errIdemReuse = func() *domain.Error {
		return &domain.Error{Code: "IDEMPOTENCY_KEY_REUSE", Message: "The Idempotency-Key was reused with a different request body.", HTTP: http.StatusUnprocessableEntity}
	}()

	// errIdemRace — lost the insert race AND could not replay the winner:
	// a transient read failure immediately after the unique-violation. The
	// client retry (same key) will replay cleanly.
	errIdemRace = func() *domain.Error {
		return &domain.Error{Code: "DUPLICATE_IN_PROGRESS", Message: "An identical checkout is being processed. Retry with the same Idempotency-Key.", HTTP: http.StatusConflict}
	}()

	// errWebhookBudget — webhook budget per IP exhausted (429). The
	// provider will retry; an operator should already be looking.
	errWebhookBudget = func() *domain.Error {
		return &domain.Error{Code: "RATE_LIMITED", Message: "Webhook budget exceeded.", HTTP: http.StatusTooManyRequests, Details: map[string]any{"scope": "webhook_ip"}}
	}()
)

// Storage-layer sentinels that the PG repo returns for constraint races.
// They are internal (never client-visible as-is): the service translates.
var (
	// ErrOrderExistsIdem — (tenant_id, idempotency_key) unique hit.
	ErrOrderExistsIdem = errors.New("payment: idempotent order already exists")
	// ErrOrderExistsProvider — (provider, provider_order_id) unique hit.
	ErrOrderExistsProvider = errors.New("payment: provider order already mapped")
	// ErrNotFound — storage miss.
	ErrNotFound = errors.New("payment: not found")
)
