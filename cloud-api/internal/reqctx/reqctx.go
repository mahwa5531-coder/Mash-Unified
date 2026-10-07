// Package reqctx carries the canonical per-request correlation keys.
// Exactly one key type per concept: middleware sets, bifrost/agent/api read.
// Duplicated ad-hoc key types would silently never match.
package reqctx

import "context"

type ctxKey int

const (
	keyRequestID ctxKey = iota
	keyCallID
)

// WithRequestID attaches the HTTP correlation id (x-request-id upstream).
func WithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, keyRequestID, id)
}

// RequestID returns the correlation id ("" when absent).
func RequestID(ctx context.Context) string {
	if v, ok := ctx.Value(keyRequestID).(string); ok {
		return v
	}
	return ""
}

// WithCallID attaches the LLM call id for upstream correlation headers.
func WithCallID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, keyCallID, id)
}

// CallID returns the LLM call id ("" when absent).
func CallID(ctx context.Context) string {
	if v, ok := ctx.Value(keyCallID).(string); ok {
		return v
	}
	return ""
}
