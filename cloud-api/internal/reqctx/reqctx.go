// Package reqctx carries the canonical per-request correlation keys.
// Exactly one key type per concept: middleware sets, bifrost/agent/api read.
// Duplicated ad-hoc key types would silently never match.
package reqctx

import "context"

type ctxKey int

const (
	keyRequestID ctxKey = iota
	keyRunID
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

// WithRunID attaches the run id for upstream correlation headers.
func WithRunID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, keyRunID, id)
}

// RunID returns the run id ("" when absent).
func RunID(ctx context.Context) string {
	if v, ok := ctx.Value(keyRunID).(string); ok {
		return v
	}
	return ""
}
