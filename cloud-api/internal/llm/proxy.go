package llm

import (
	"context"
	"encoding/json"
	"math"
	"strings"
	"sync/atomic"
	"time"

	"github.com/mash-cloud/mash-api/internal/auth"
	"github.com/mash-cloud/mash-api/internal/bifrost"
	"github.com/mash-cloud/mash-api/internal/domain"
	"github.com/mash-cloud/mash-api/internal/ids"
	"github.com/mash-cloud/mash-api/internal/observability"
	"github.com/mash-cloud/mash-api/internal/ratelimit"
	"github.com/mash-cloud/mash-api/internal/reqctx"
)

// BifrostClient is the upstream seam (implemented by bifrost.Client).
type BifrostClient interface {
	Completion(ctx context.Context, req *bifrost.ChatRequest) (*bifrost.ChatResponse, error)
	CompletionStream(ctx context.Context, req *bifrost.ChatRequest) (*bifrost.StreamReader, error)
}

// UsageQuery reads the authoritative rolling-window token position
// (implemented by repos.LLMCallsRepo).
type UsageQuery interface {
	WindowUsage(ctx context.Context, tenantID string) (*domain.WindowUsage, error)
	WindowRecovery(ctx context.Context, tenantID string, window time.Duration, quota, used int64) (*time.Time, error)
}

// CallRecorder persists metering facts asynchronously (implemented by
// metering.Recorder).
type CallRecorder interface {
	Record(call domain.LLMCall)
}

// RateRules are the deployment-level defaults; plan limits override any
// non-zero dimension per identity.
type RateRules struct {
	RPMUser    int64
	RPMTenant  int64
	ConcUser   int64
	ConcTenant int64
}

// Timing bounds one call's lifetimes.
type Timing struct {
	IdleTimeout      time.Duration // no upstream chunk → abort (Bifrost parity: 300s)
	MaxDuration      time.Duration // hard cap of one stream
	NonStreamTimeout time.Duration // full budget of a non-streaming call
}

// ReserveConfig bounds the in-flight token reservation — the fix for the
// concurrent-overshoot race in the rolling windows. Usage becomes visible to
// the window gate only when the llm_calls row lands (async, post-completion);
// without a reservation, N admits that pass the check in parallel each see
// the same DB position and collectively overshoot the window. Every admitted
// call therefore claims an ESTIMATE of its cost against the window's
// remaining budget, atomically in Redis, and settles the claim when its usage
// row is about to land.
type ReserveConfig struct {
	Enabled     bool
	MinTokens   int64         // per-call floor (default 1024)
	MaxTokens   int64         // per-call ceiling (default 32768): one huge request must not starve the tenant window
	DefaultOut  int64         // output budget when the request declares none (default 4096)
	TTL         time.Duration // crash backstop — must exceed Timing.MaxDuration
	SettleDelay time.Duration // release delay covering the metering flush lag
}

// Proxy is the LLM tunnel service. It is safe for concurrent use.
type Proxy struct {
	Bifrost BifrostClient
	Meter   CallRecorder
	Limiter *ratelimit.Limiter
	Usage   UsageQuery
	Metrics *observability.Metrics
	// Norm resolves the per-model token-accounting rule (dynamic via the
	// token_normalization table; nil = built-in identity accounting).
	Norm *RuleCache

	Limits  Limits
	Rate    RateRules
	Timing  Timing
	SlotTTL time.Duration // concurrency-slot TTL backstop (crash recovery)
	Reserve ReserveConfig // in-flight window reservation (see ReserveConfig)

	active atomic.Int64 // live in-flight calls (metrics gauge source)
}

// ActiveCount reports in-flight calls.
func (p *Proxy) ActiveCount() int64 { return p.active.Load() }

// Redis key vocabulary for the proxy's limiter dimensions.
func rpmUserKey(uid string) string    { return "rl:rpm:user:" + uid }
func rpmTenantKey(tid string) string  { return "rl:rpm:tenant:" + tid }
func concUserKey(uid string) string   { return "rl:conc:user:" + uid }
func concTenantKey(tid string) string { return "rl:conc:tenant:" + tid }

// Sink forwards upstream SSE payloads verbatim to the client. One method per
// frame class; implemented by the HTTP transport (api/llm.go).
type Sink interface {
	// SendChunk forwards one SSE data payload (without the data:/[DONE]
	// framing — the transport writes framing).
	SendChunk(raw []byte) error
	// SendError delivers an in-band OpenAI-style error object once the
	// response has started streaming: standard OpenAI SDKs surface it as a
	// failure instead of a silent empty completion.
	SendError(errType, code, message string) error
	// Started reports whether any byte has been forwarded to the client.
	Started() bool
}

// Complete runs one non-streaming call end to end: gates → Bifrost → raw
// completion body + metering. The returned bytes are the verbatim upstream
// JSON body (OpenAI-compatible contract: the client gets the completion
// object or an HTTP error, never a wrapper).
func (p *Proxy) Complete(ctx context.Context, idn *auth.Identity, req *Request) ([]byte, *domain.Error) {
	release, res, de := p.admit(ctx, idn, req)
	if de != nil {
		return nil, de
	}
	defer release()

	callID := ids.CallID()
	started := time.Now().UTC()
	cctx, cancel := context.WithTimeout(reqctx.WithCallID(ctx, callID), p.Timing.NonStreamTimeout)
	defer cancel()

	resp, err := p.Bifrost.Completion(cctx, req.ToBifrost())
	if err != nil {
		de := domain.AsError(err)
		p.record(ctx, idn, req, callID, callMeta{status: domain.CallFailed, errCode: de.Code, started: started}, res)
		return nil, de
	}

	model, provider := "", ""
	if resp.ExtraFields != nil {
		model, provider = resp.ExtraFields.ResolvedModel(), resp.ExtraFields.Provider
	}
	if resp.Model != "" && model == "" {
		model = resp.Model
	}
	meta := callMeta{
		status:      domain.CallCompleted,
		usage:       NormalizeUsage(resp.Usage, p.normRule(ctx, model)),
		latency:     int(time.Since(started).Milliseconds()),
		resolved:    model,
		provider:    provider,
		started:     started,
		completedAt: time.Now().UTC(),
	}
	p.record(ctx, idn, req, callID, meta, res)
	// OpenAI-compatible contract: the verbatim completion object (re-marshaled
	// from the decoded response — the Extras map carries unknown fields).
	blob, err := json.Marshal(resp)
	if err != nil {
		return nil, domain.ErrInternal(err)
	}
	return blob, nil
}

// Stream runs one streaming call end to end: gates → Bifrost → verbatim SSE
// passthrough via sink → metering.
//
// Error contract: a non-nil return means the UPSTREAM failed. Callers use
// sink.Started() to pick the response shape — nothing flowed yet → real HTTP
// error; bytes already flowed → the in-band error event was emitted here and
// the caller closes the stream. Client disconnects (ctx cancelled / sink
// write failure) abort the upstream and return nil: there is nobody left to
// report to, but the usage seen so far is still metered.
func (p *Proxy) Stream(ctx context.Context, idn *auth.Identity, req *Request, sink Sink) *domain.Error {
	release, res, de := p.admit(ctx, idn, req)
	if de != nil {
		return de
	}
	defer release()

	callID := ids.CallID()
	started := time.Now().UTC()

	bctx := bifrost.WithIdleTimeout(ctx, p.Timing.IdleTimeout)
	bctx, durCancel := context.WithTimeout(reqctx.WithCallID(bctx, callID), p.Timing.MaxDuration)
	defer durCancel()

	p.active.Add(1)
	defer p.active.Add(-1)

	reader, err := p.Bifrost.CompletionStream(bctx, req.ToBifrost())
	if err != nil {
		de := domain.AsError(err)
		p.record(ctx, idn, req, callID, callMeta{status: domain.CallFailed, errCode: de.Code, started: started}, res)
		return de // pre-stream: caller answers with a real HTTP error
	}
	defer reader.Close()

	var usage *domain.TokenUsage
	var model, provider string
	forwarded := false

	for {
		chunk, raw, done, err := reader.Next()
		if err != nil {
			if ctx.Err() != nil || isClientGone(err) {
				// Client disconnected: abort upstream, meter what was seen.
				p.record(context.WithoutCancel(ctx), idn, req, callID, callMeta{
					status: domain.CallCancelled, errCode: "CLIENT_DISCONNECTED",
					usage: usage, latency: int(time.Since(started).Milliseconds()),
					resolved: model, provider: provider, started: started,
				}, res)
				return nil
			}
			de := domain.AsError(err)
			if forwarded && sink != nil {
				// Mid-stream failure: 200 + stream headers are already on the
				// wire and cannot be taken back. Emit the in-band OpenAI-style
				// error event so SDKs observe the failure instead of parsing
				// an empty successful completion.
				_ = sink.SendError(de.Code, de.Code, safeMessage(de))
			}
			p.record(context.WithoutCancel(ctx), idn, req, callID, callMeta{
				status: domain.CallFailed, errCode: de.Code,
				usage: usage, latency: int(time.Since(started).Milliseconds()),
				resolved: model, provider: provider, started: started,
			}, res)
			return de
		}
		if done {
			p.record(context.WithoutCancel(ctx), idn, req, callID, callMeta{
				status: domain.CallCompleted,
				usage:  usage, latency: int(time.Since(started).Milliseconds()),
				resolved: model, provider: provider, started: started,
			}, res)
			return nil
		}
		if chunk != nil {
			if chunk.Usage != nil {
				usage = NormalizeUsage(chunk.Usage, p.normRule(ctx, model))
			}
			if chunk.Model != "" {
				model = chunk.Model
			}
			if chunk.ExtraFields != nil {
				if chunk.ExtraFields.Provider != "" {
					provider = chunk.ExtraFields.Provider
				}
				if chunk.ExtraFields.ModelDeployment != "" {
					model = chunk.ExtraFields.ModelDeployment
				} else if chunk.ExtraFields.ResolvedModelUsed != "" {
					model = chunk.ExtraFields.ResolvedModelUsed
				}
				if chunk.ExtraFields.Latency > 0 {
				}
			}
		}
		if len(raw) > 0 {
			if err := sink.SendChunk(raw); err != nil {
				// Client gone: abort upstream, meter as cancelled.
				_ = reader.Close()
				p.record(context.WithoutCancel(ctx), idn, req, callID, callMeta{
					status: domain.CallCancelled, errCode: "CLIENT_DISCONNECTED",
					usage: usage, latency: int(time.Since(started).Milliseconds()),
					resolved: model, provider: provider, started: started,
				}, res)
				return nil
			}
			forwarded = true
			if p.Metrics != nil {
				p.Metrics.EventsForwarded.Add(ctx, 1, observability.Attr("type", "raw_chunk"))
			}
		}
	}
}

// callMeta is the metering payload accumulated during a call.
type callMeta struct {
	status      string
	errCode     string
	usage       *domain.TokenUsage
	latency     int
	resolved    string
	provider    string
	started     time.Time
	completedAt time.Time
}

func (p *Proxy) record(ctx context.Context, idn *auth.Identity, req *Request, callID string, m callMeta, res *reservation) {
	// Settle the window reservation first — even when no meter is wired
	// (tests), a claimed budget must go back to the pool.
	p.settleReservation(res, m.usage != nil)
	if p.Meter == nil {
		return
	}
	call := domain.LLMCall{
		CallID:         callID,
		TenantID:       idn.Tenant.ID,
		UserID:         idn.User.ID,
		RequestID:      reqctx.RequestID(ctx),
		RequestedModel: req.Model,
		ResolvedModel:  m.resolved,
		Provider:       m.provider,
		Stream:         req.Stream,
		Status:         m.status,
		ErrorCode:      m.errCode,
		LatencyMS:      m.latency,
		StartedAt:      m.started,
	}
	if !m.completedAt.IsZero() {
		t := m.completedAt
		call.CompletedAt = &t
	} else {
		t := time.Now().UTC()
		call.CompletedAt = &t
	}
	if m.usage != nil {
		call.Usage = *m.usage
	}
	p.Meter.Record(call)
}

// admit runs every pre-flight gate in order and returns the slot-release
// function plus the window reservation on success:
//
//	account/tenant/subscription state → payload validation → model
//	entitlement (primary + fallbacks) → rolling token windows (5h + weekly)
//	→ RPM sliding window (user + tenant) → concurrency slots (user + tenant)
//	→ in-flight token reservation (5h + weekly, atomic).
//
// The reservation is LAST so a denial never orphans an RPM event or a slot.
func (p *Proxy) admit(ctx context.Context, idn *auth.Identity, req *Request) (func(), *reservation, *domain.Error) {
	// Account/tenant/subscription state (the auth middleware admits
	// SUBSCRIPTION_INACTIVE identities so /v1/me can render state; the LLM
	// path is where it becomes binding).
	if reason := idn.CanRun(); reason != "" {
		if reason == "SUBSCRIPTION_INACTIVE" {
			return nil, nil, domain.ErrSubscriptionInactive()
		}
		return nil, nil, domain.ErrForbidden("Account state does not permit this request.")
	}

	// Payload validation.
	if de := req.Validate(p.Limits); de != nil {
		return nil, nil, de
	}

	// Model entitlement (allowlist with patterns). Every fallback must be
	// inside the allowlist too — listing an off-allowlist model as a fallback
	// must not bypass the primary check.
	if idn.Restricted {
		if !modelAllowed(idn.Models, req.Model) {
			return nil, nil, domain.ErrModelNotEntitled(req.Model)
		}
		for _, fb := range req.Fallbacks {
			if !modelAllowed(idn.Models, fb) {
				return nil, nil, domain.ErrModelNotEntitled(fb)
			}
		}
	}

	// Rolling token windows (plan-level, normalized tokens): a 5-hour burst
	// budget and a 7-day weekly budget — either can bind. Enforced at the
	// point of consumption. Query failure fails OPEN (availability posture;
	// the quota gate is a plan-abuse bound, not a security boundary).
	// Under-metering is the visible, correctable failure mode — and skips
	// the reservation too (no authoritative position to reserve against).
	var pos *domain.WindowUsage
	if (idn.Limits.Window5hTokens > 0 || idn.Limits.WindowWeeklyTokens > 0) && p.Usage != nil {
		var err error
		pos, err = p.Usage.WindowUsage(ctx, idn.Tenant.ID)
		if err != nil {
			pos = nil
		} else if de := p.checkWindows(ctx, idn, pos); de != nil {
			return nil, nil, de
		}
	}

	// Plan limits override deployment defaults per dimension.
	rpmUser, rpmTenant := p.Rate.RPMUser, p.Rate.RPMTenant
	concUser, concTenant := p.Rate.ConcUser, p.Rate.ConcTenant
	if idn.Limits.RequestsPerMinuteUser > 0 {
		rpmUser = idn.Limits.RequestsPerMinuteUser
	}
	if idn.Limits.RequestsPerMinuteTenant > 0 {
		rpmTenant = idn.Limits.RequestsPerMinuteTenant
	}
	if idn.Limits.ConcurrentRequestsUser > 0 {
		concUser = idn.Limits.ConcurrentRequestsUser
	}
	if idn.Limits.ConcurrentRequestsTenant > 0 {
		concTenant = idn.Limits.ConcurrentRequestsTenant
	}

	// RPM sliding window (one pipelined Redis round trip, both scopes).
	// ZSET member: SERVER-GENERATED and unique per admission — the inbound
	// X-Request-Id is client-controlled and reusing one fixed value would
	// dedupe every ZADD onto a single member, pinning the window count at 1.
	member := ids.New("adm")
	if v := p.Limiter.AllowAll(ctx, member,
		ratelimit.Scope{Key: rpmUserKey(idn.User.ID), Limit: rpmUser, Window: time.Minute},
		ratelimit.Scope{Key: rpmTenantKey(idn.Tenant.ID), Limit: rpmTenant, Window: time.Minute},
	); !v.Allowed {
		retry := v.RetryAfter
		if retry <= 0 {
			retry = time.Second
		}
		return nil, nil, domain.ErrRateLimited(retry.Milliseconds(), "llm_rpm")
	}

	// Concurrency slots (Redis counters, TTL backstop for crashed holders).
	var held []string
	if concUser > 0 && p.Limiter.Acquire(ctx, concUserKey(idn.User.ID), concUser, p.SlotTTL) {
		held = append(held, concUserKey(idn.User.ID))
	} else if concUser > 0 {
		return nil, nil, domain.ErrConcurrencyLimited("user")
	}
	if concTenant > 0 && p.Limiter.Acquire(ctx, concTenantKey(idn.Tenant.ID), concTenant, p.SlotTTL) {
		held = append(held, concTenantKey(idn.Tenant.ID))
	} else if concTenant > 0 {
		for _, k := range held {
			p.Limiter.Release(ctx, k, p.SlotTTL)
		}
		return nil, nil, domain.ErrConcurrencyLimited("tenant")
	}

	// In-flight token reservation — the LAST gate. Atomically claims an
	// estimate of this call's cost against each window's REMAINING budget
	// (quota − used − already-reserved): concurrent admits can no longer
	// double-spend the same remaining budget. Skipped when the window
	// position query failed (fail-open posture) or the feature is off.
	var res *reservation
	if pos != nil && p.Reserve.Enabled && p.Limiter != nil {
		var de *domain.Error
		res, de = p.reserveWindows(ctx, idn, req, pos)
		if de != nil {
			for _, k := range held {
				p.Limiter.Release(context.WithoutCancel(ctx), k, p.SlotTTL)
			}
			return nil, nil, de
		}
	}

	var released bool
	return func() {
		if released {
			return
		}
		released = true
		for _, k := range held {
			p.Limiter.Release(context.WithoutCancel(ctx), k, p.SlotTTL)
		}
	}, res, nil
}

// windowBlocked renders the quota rejection with the exact recovery instant
// (rejection path only — one extra indexed query, never on the happy path).
func (p *Proxy) windowBlocked(ctx context.Context, idn *auth.Identity, window string, d time.Duration, quota, used int64) *domain.Error {
	var resetsAt *time.Time
	if p.Usage != nil {
		if t, err := p.Usage.WindowRecovery(ctx, idn.Tenant.ID, d, quota, used); err == nil {
			resetsAt = t
		}
	}
	return domain.ErrWindowQuotaExceeded(window, quota, used, resetsAt)
}

// normRule resolves the accounting rule for the model actually served (the
// resolved model, falling back to the requested one).
func (p *Proxy) normRule(ctx context.Context, model string) domain.NormRule {
	if p.Norm == nil {
		return domain.DefaultNormRule
	}
	return p.Norm.Rule(ctx, model)
}

// modelAllowed matches "openai/gpt-4o" exactly or "anthropic/*" patterns.
func modelAllowed(allowlist []string, model string) bool {
	if len(allowlist) == 0 {
		return true
	}
	for _, pattern := range allowlist {
		if pattern == model {
			return true
		}
		if strings.HasSuffix(pattern, "/*") {
			if prefix := strings.TrimSuffix(pattern, "/*"); strings.HasPrefix(model, prefix+"/") {
				return true
			}
		}
	}
	return false
}

// NormalizeUsage converts raw Bifrost usage into the canonical metering shape
// using the model's accounting rule. The result is the quota currency:
//
//	normalized_input  = max(0, round(prompt·iw) − round(cache_read·crw) − round(cache_write·cww))
//	normalized_output = round(completion·ow)
//	normalized_total  = normalized_input + normalized_output
//
// Raw provider numbers are preserved alongside (RawPromptTokens /
// RawCompletionTokens) so per-row accounting stays reconstructible whatever
// the weights were at record time. With the default rule (all weights 1) this
// is the classic accounting: cache hits/writes are free, everything else
// counts 1:1, total = input + output.
func NormalizeUsage(u *bifrost.Usage, rule domain.NormRule) *domain.TokenUsage {
	if u == nil {
		return nil
	}
	t := &domain.TokenUsage{
		RawPromptTokens:     u.PromptTokens,
		RawCompletionTokens: u.CompletionTokens,
		InputTokens:         applyWeight(u.PromptTokens, rule.InputWeight),
		OutputTokens:        applyWeight(u.CompletionTokens, rule.OutputWeight),
		ReasoningTokens:     0,
		CacheReadTokens:     0,
	}
	if u.PromptTokensDetails != nil {
		t.CacheReadTokens = u.PromptTokensDetails.CachedReadTokens
		t.CacheWriteTokens = u.PromptTokensDetails.CachedWriteTokens
	}
	if u.CompletionDetails != nil {
		t.ReasoningTokens = u.CompletionDetails.ReasoningTokens
	}
	// Cache hits/writes are discounted from the input, floored at zero — a
	// provider reporting more cached tokens than prompt tokens must never go
	// negative (and must never make the call free below zero).
	t.InputTokens -= applyWeight(t.CacheReadTokens, rule.CachedReadWeight)
	t.InputTokens -= applyWeight(t.CacheWriteTokens, rule.CachedWriteWeight)
	if t.InputTokens < 0 {
		t.InputTokens = 0
	}
	t.TotalTokens = t.InputTokens + t.OutputTokens
	if u.Cost != nil {
		t.InputCost = u.Cost.InputTokensCost + u.Cost.RequestCost
		t.OutputCost = u.Cost.OutputTokensCost
		t.TotalCost = u.Cost.TotalCost
		if t.TotalCost == 0 {
			t.TotalCost = t.InputCost + t.OutputCost
		}
	}
	return t
}

// applyWeight scales a token count, with an exact fast path for weight 1.
func applyWeight(n int64, w float64) int64 {
	if n <= 0 {
		return 0
	}
	if w == 1 {
		return n
	}
	return int64(math.Round(float64(n) * w))
}

// isClientGone reports whether the error is a client-side disconnect rather
// than an upstream fault.
func isClientGone(err error) bool {
	if err == nil {
		return false
	}
	s := err.Error()
	return strings.Contains(s, "broken pipe") ||
		strings.Contains(s, "connection reset by peer") ||
		strings.Contains(s, "client disconnected")
}

// safeMessage renders a client-safe message for in-band error events.
func safeMessage(de *domain.Error) string {
	if de == nil {
		return "upstream error"
	}
	return de.Message
}
