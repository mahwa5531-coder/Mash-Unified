// Package agent implements the model-request pipeline: session ownership,
// entitlement enforcement, distributed rate limits, idempotency, payload
// validation, Bifrost forwarding, event mapping, cancellation and usage
// attribution (spec §7 pipeline, in order, with no per-event database calls).
package agent

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/nexau-cloud/nexau-api/internal/bifrost"
	"github.com/nexau-cloud/nexau-api/internal/domain"
	"github.com/nexau-cloud/nexau-api/internal/idempotency"
	"github.com/nexau-cloud/nexau-api/internal/ids"
)

// Limits carries the validation bounds (from config, plan-enforced).
type Limits struct {
	MaxMessages int
	MaxTools    int
	MaxModelLen int
}

// RunRequest is the client-facing run creation body: the canonical OpenAI
// Chat Completions request the NexAU desktop already produces (ARCHITECTURE
// §4.1), plus correlation fields.
type RunRequest struct {
	Model    string            `json:"model"`
	Messages []bifrost.Message `json:"messages"`

	Stream         bool   `json:"stream,omitempty"`
	TurnID         string `json:"turn_id,omitempty"`
	IdempotencyKey string `json:"idempotency_key,omitempty"`

	// Tools.
	Tools      []bifrost.Tool  `json:"tools,omitempty"`
	ToolChoice json.RawMessage `json:"tool_choice,omitempty"`

	// Generation parameters (validated subset, forwarded).
	Temperature         *float64           `json:"temperature,omitempty"`
	TopP                *float64           `json:"top_p,omitempty"`
	MaxCompletionTokens *int64             `json:"max_completion_tokens,omitempty"`
	MaxTokens           *int64             `json:"max_tokens,omitempty"`
	Stop                json.RawMessage    `json:"stop,omitempty"`
	Seed                *int64             `json:"seed,omitempty"`
	FrequencyPenalty    *float64           `json:"frequency_penalty,omitempty"`
	PresencePenalty     *float64           `json:"presence_penalty,omitempty"`
	LogitBias           map[string]float64 `json:"logit_bias,omitempty"`
	Logprobs            *bool              `json:"logprobs,omitempty"`
	TopLogprobs         *int               `json:"top_logprobs,omitempty"`
	ParallelToolCalls   *bool              `json:"parallel_tool_calls,omitempty"`
	ResponseFormat      json.RawMessage    `json:"response_format,omitempty"`
	ReasoningEffort     string             `json:"reasoning_effort,omitempty"`
	Fallbacks           []string           `json:"fallbacks,omitempty"`
	Metadata            map[string]any     `json:"metadata,omitempty"`

	// Extras: forward-compatible provider params. Validated as safe JSON
	// objects with bounded size; unknown keys pass through deliberately.
	Extras map[string]json.RawMessage `json:"-"`
}

// UnmarshalJSON decodes the request and separates known fields from Extras:
// unknown top-level keys ride along (bounded, JSON-typed) so new provider
// parameters do not need a cloud release. Known and disallowed keys are
// rejected loudly — silent dropping of a semantically meaningful field would
// corrupt billing-relevant behavior.
func (r *RunRequest) UnmarshalJSON(data []byte) error {
	type alias RunRequest
	a := (*alias)(r)
	if err := json.Unmarshal(data, a); err != nil {
		return err
	}
	if r.Extras == nil {
		r.Extras = map[string]json.RawMessage{}
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	for k, v := range raw {
		switch k {
		case "model", "messages", "stream", "turn_id", "idempotency_key",
			"tools", "tool_choice", "temperature", "top_p",
			"max_completion_tokens", "max_tokens", "stop", "seed",
			"frequency_penalty", "presence_penalty", "logit_bias", "logprobs",
			"top_logprobs", "parallel_tool_calls", "response_format",
			"reasoning_effort", "fallbacks", "metadata", "session_id":
			continue
		default:
			r.Extras[k] = v
		}
	}
	return nil
}

// MarshalJSON re-embeds Extras.
func (r *RunRequest) MarshalJSON() ([]byte, error) {
	type alias RunRequest
	a := (*alias)(r)
	base, err := json.Marshal(a)
	if err != nil || len(r.Extras) == 0 {
		return base, err
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(base, &m); err != nil {
		return base, err
	}
	for k, v := range r.Extras {
		if _, exists := m[k]; !exists {
			m[k] = v
		}
	}
	return json.Marshal(m)
}

// fingerprint derives the stable idempotency hash input: the billable
// content of the request only. Correlation fields (turn id, idempotency key,
// stream flag) and transport noise are excluded — a retry of the same logical
// request must hash identically.
func (r *RunRequest) fingerprint() string {
	type billable struct {
		Model               string                     `json:"m"`
		Messages            []bifrost.Message          `json:"msg"`
		Tools               []bifrost.Tool             `json:"t"`
		ToolChoice          json.RawMessage            `json:"tc,omitempty"`
		Temperature         *float64                   `json:"tp,omitempty"`
		TopP                *float64                   `json:"pp,omitempty"`
		MaxCompletionTokens *int64                     `json:"mc,omitempty"`
		MaxTokens           *int64                     `json:"mt,omitempty"`
		Stop                json.RawMessage            `json:"s,omitempty"`
		Seed                *int64                     `json:"sd,omitempty"`
		FrequencyPenalty    *float64                   `json:"fp,omitempty"`
		PresencePenalty     *float64                   `json:"pr,omitempty"`
		LogitBias           map[string]float64         `json:"lb,omitempty"`
		Logprobs            *bool                      `json:"lp,omitempty"`
		TopLogprobs         *int                       `json:"tl,omitempty"`
		ParallelToolCalls   *bool                      `json:"pt,omitempty"`
		ResponseFormat      json.RawMessage            `json:"rf,omitempty"`
		ReasoningEffort     string                     `json:"re,omitempty"`
		Fallbacks           []string                   `json:"f,omitempty"`
		Extras              map[string]json.RawMessage `json:"x,omitempty"`
	}
	b, err := json.Marshal(billable{
		Model: r.Model, Messages: r.Messages, Tools: r.Tools, ToolChoice: r.ToolChoice,
		Temperature: r.Temperature, TopP: r.TopP, MaxCompletionTokens: r.MaxCompletionTokens,
		MaxTokens: r.MaxTokens, Stop: r.Stop, Seed: r.Seed, FrequencyPenalty: r.FrequencyPenalty,
		PresencePenalty: r.PresencePenalty, LogitBias: r.LogitBias, Logprobs: r.Logprobs,
		TopLogprobs: r.TopLogprobs, ParallelToolCalls: r.ParallelToolCalls,
		ResponseFormat: r.ResponseFormat, ReasoningEffort: r.ReasoningEffort,
		Fallbacks: r.Fallbacks, Extras: r.Extras,
	})
	if err != nil {
		return ""
	}
	return idempotency.HashRequestBytes(b)
}

// ToBifrost converts the validated request into the upstream shape.
func (r *RunRequest) ToBifrost() *bifrost.ChatRequest {
	targetModel := r.Model
	if targetModel == "mash-agent" || targetModel == "default" || targetModel == "" {
		targetModel = "openai/gpt-4o-mini"
	}
	req := &bifrost.ChatRequest{
		Model:               targetModel,
		Messages:            r.Messages,
		Stream:              r.Stream,
		Fallbacks:           r.Fallbacks,
		Temperature:         r.Temperature,
		TopP:                r.TopP,
		MaxCompletionTokens: r.MaxCompletionTokens,
		MaxTokens:           r.MaxTokens,
		Stop:                r.Stop,
		Seed:                r.Seed,
		FrequencyPenalty:    r.FrequencyPenalty,
		PresencePenalty:     r.PresencePenalty,
		LogitBias:           r.LogitBias,
		Logprobs:            r.Logprobs,
		TopLogprobs:         r.TopLogprobs,
		ParallelToolCalls:   r.ParallelToolCalls,
		Tools:               r.Tools,
		ToolChoice:          r.ToolChoice,
		ResponseFormat:      r.ResponseFormat,
		Metadata:            r.Metadata,
		Extras:              r.Extras,
	}
	if r.ReasoningEffort != "" {
		req.Reasoning = &bifrost.Reasoning{Effort: r.ReasoningEffort}
	}
	if r.Stream {
		// Bifrost standardization puts usage in the LAST chunk only when
		// include_usage is requested — authoritative metering depends on it.
		req.StreamOptions = &bifrost.StreamOptions{IncludeUsage: true}
	}
	return req
}

// AllowedGenerationParams is the server-approved parameter surface. Anything
// outside this set that is NOT an extra (extras are explicit forward-compat)
// is rejected at validation.
var allowedRoles = map[string]bool{
	"system": true, "user": true, "assistant": true, "tool": true, "developer": true,
}

// Validate enforces every payload invariant (spec §7 step 12–13). Errors are
// domain errors ready for the client.
func (r *RunRequest) Validate(l Limits) *domain.Error {
	// Model: "provider/model" shape or "mash-agent" alias, bounded length, safe charset.
	if r.Model == "" {
		return domain.ErrValidation("model is required")
	}
	if len(r.Model) > l.MaxModelLen {
		return domain.ErrValidation("model exceeds maximum length")
	}
	if r.Model != "mash-agent" && r.Model != "default" {
		provider, model, hasSlash := strings.Cut(r.Model, "/")
		if !hasSlash || provider == "" || model == "" {
			return domain.ErrValidation(`model must be "provider/model" or "mash-agent"`)
		}
		if err := ids.Validate(r.Model, l.MaxModelLen); err != nil {
			return domain.ErrValidation("model contains invalid characters")
		}
	}

	// Messages: presence, count, roles, content shape.
	if len(r.Messages) == 0 {
		return domain.ErrValidation("messages must not be empty")
	}
	if len(r.Messages) > l.MaxMessages {
		return domain.ErrValidation(fmt.Sprintf("messages exceed the maximum of %d", l.MaxMessages))
	}
	for i := range r.Messages {
		m := &r.Messages[i]
		if !allowedRoles[m.Role] {
			return domain.ErrValidation(fmt.Sprintf("messages[%d]: invalid role %q", i, m.Role))
		}
		if m.Role == "tool" && m.ToolCallID == "" {
			return domain.ErrValidation(fmt.Sprintf("messages[%d]: tool message requires tool_call_id", i))
		}
		if m.Role != "tool" && m.ToolCallID != "" {
			return domain.ErrValidation(fmt.Sprintf("messages[%d]: tool_call_id is only valid on tool messages", i))
		}
		if m.Role == "assistant" {
			if len(m.ToolCalls) > l.MaxTools {
				return domain.ErrValidation(fmt.Sprintf("messages[%d]: too many tool_calls", i))
			}
			for j, tc := range m.ToolCalls {
				if tc.ID == "" || tc.Function.Name == "" {
					return domain.ErrValidation(fmt.Sprintf("messages[%d].tool_calls[%d]: id and function.name are required", i, j))
				}
				if err := ids.Validate(tc.ID, 128); err != nil {
					return domain.ErrValidation(fmt.Sprintf("messages[%d].tool_calls[%d]: invalid tool call id", i, j))
				}
			}
		}
		if err := validateContent(m.Role, m.Content); err != nil {
			return domain.ErrValidation(fmt.Sprintf("messages[%d]: %s", i, err.Error()))
		}
	}

	// Tools: count, names, parameter schema shape.
	if len(r.Tools) > l.MaxTools {
		return domain.ErrValidation(fmt.Sprintf("tools exceed the maximum of %d", l.MaxTools))
	}
	for i, t := range r.Tools {
		if t.Type != "function" {
			return domain.ErrValidation(fmt.Sprintf("tools[%d]: only type \"function\" is supported", i))
		}
		if t.Function == nil {
			return domain.ErrValidation(fmt.Sprintf("tools[%d]: function definition is required", i))
		}
		if t.Function.Name == "" || len(t.Function.Name) > 128 {
			return domain.ErrValidation(fmt.Sprintf("tools[%d].function.name is required (≤128 chars)", i))
		}
		if !toolNameOK(t.Function.Name) {
			return domain.ErrValidation(fmt.Sprintf("tools[%d].function.name has invalid characters", i))
		}
		if len(t.Function.Parameters) > 0 {
			var probe map[string]any
			if err := json.Unmarshal(t.Function.Parameters, &probe); err != nil {
				return domain.ErrValidation(fmt.Sprintf("tools[%d].function.parameters must be a JSON object", i))
			}
		}
	}

	// Generation parameters: bounded ranges (OpenAI-compatible semantics).
	if r.Temperature != nil && (*r.Temperature < 0 || *r.Temperature > 2) {
		return domain.ErrValidation("temperature must be within [0, 2]")
	}
	if r.TopP != nil && (*r.TopP < 0 || *r.TopP > 1) {
		return domain.ErrValidation("top_p must be within [0, 1]")
	}
	if r.FrequencyPenalty != nil && (*r.FrequencyPenalty < -2 || *r.FrequencyPenalty > 2) {
		return domain.ErrValidation("frequency_penalty must be within [-2, 2]")
	}
	if r.PresencePenalty != nil && (*r.PresencePenalty < -2 || *r.PresencePenalty > 2) {
		return domain.ErrValidation("presence_penalty must be within [-2, 2]")
	}
	if r.MaxTokens != nil && *r.MaxTokens < 1 {
		return domain.ErrValidation("max_tokens must be ≥ 1")
	}
	if r.MaxCompletionTokens != nil && *r.MaxCompletionTokens < 1 {
		return domain.ErrValidation("max_completion_tokens must be ≥ 1")
	}
	if r.TopLogprobs != nil && (*r.TopLogprobs < 0 || *r.TopLogprobs > 20) {
		return domain.ErrValidation("top_logprobs must be within [0, 20]")
	}
	if len(r.LogitBias) > 256 { // len(nil) == 0: absent and empty are the same
		return domain.ErrValidation("logit_bias supports at most 256 entries")
	}
	if r.ReasoningEffort != "" {
		switch r.ReasoningEffort {
		case "none", "minimal", "low", "medium", "high", "xhigh":
		default:
			return domain.ErrValidation("reasoning_effort must be one of none|minimal|low|medium|high|xhigh")
		}
	}
	if len(r.Stop) > 0 {
		var probe any
		if err := json.Unmarshal(r.Stop, &probe); err != nil {
			return domain.ErrValidation("stop must be a string or an array of strings")
		}
		switch v := probe.(type) {
		case string:
			// single stop sequence
		case []any:
			if len(v) > 4 {
				return domain.ErrValidation("stop supports at most 4 sequences")
			}
			for _, s := range v {
				if _, ok := s.(string); !ok {
					return domain.ErrValidation("stop sequences must be strings")
				}
			}
		default:
			// numbers / objects / booleans / null-typed scalars: OpenAI
			// accepts only string or array-of-strings.
			return domain.ErrValidation("stop must be a string or an array of strings")
		}
	}
	if len(r.ToolChoice) > 0 {
		if err := validateToolChoice(r.ToolChoice); err != nil {
			return err
		}
	}
	if len(r.ResponseFormat) > 0 {
		if err := validateResponseFormat(r.ResponseFormat); err != nil {
			return err
		}
	}
	if len(r.Fallbacks) > 4 {
		return domain.ErrValidation("fallbacks support at most 4 models")
	}
	for i, f := range r.Fallbacks {
		if f == "" || len(f) > l.MaxModelLen || !strings.Contains(f, "/") {
			return domain.ErrValidation(fmt.Sprintf("fallbacks[%d] must be \"provider/model\"", i))
		}
	}

	// Correlation ids: bounded, safe charset (they enter Redis keys and SQL).
	if r.TurnID != "" {
		if err := ids.Validate(r.TurnID, 128); err != nil {
			return domain.ErrValidation("turn_id has invalid characters")
		}
	}
	if r.IdempotencyKey != "" {
		if err := ids.Validate(r.IdempotencyKey, 256); err != nil {
			return domain.ErrValidation("idempotency_key has invalid characters")
		}
	}
	if len(r.Metadata) > 16 {
		return domain.ErrValidation("metadata supports at most 16 keys")
	}
	for k, v := range r.Metadata {
		if len(k) > 64 {
			return domain.ErrValidation("metadata keys must be ≤64 chars")
		}
		if s, ok := v.(string); ok && len(s) > 256 {
			return domain.ErrValidation("metadata string values must be ≤256 chars")
		}
	}
	return nil
}

// validateContent checks role/content compatibility: content must be a JSON
// string, an explicit null (OpenAI assistant tool-call messages routinely
// carry "content": null), or an array of typed blocks; tool messages carry
// string content.
func validateContent(role string, raw json.RawMessage) error {
	if len(raw) == 0 {
		if role == "tool" {
			return fmt.Errorf("tool message content is required")
		}
		return nil // absent content on assistant messages
	}
	if string(raw) == "null" {
		// Explicit JSON null: OpenAI wire shape for assistant messages that
		// consist only of tool_calls. Semantically identical to absent.
		if role == "tool" {
			return fmt.Errorf("tool message content is required")
		}
		return nil
	}
	var probe any
	if err := json.Unmarshal(raw, &probe); err != nil {
		return fmt.Errorf("content must be a string or an array of content blocks")
	}
	switch v := probe.(type) {
	case string:
		return nil
	case []any:
		if role == "tool" {
			return fmt.Errorf("tool message content must be a plain string")
		}
		if len(v) > 64 {
			return fmt.Errorf("content supports at most 64 blocks")
		}
		for _, b := range v {
			m, ok := b.(map[string]any)
			if !ok {
				return fmt.Errorf("content blocks must be objects")
			}
			t, _ := m["type"].(string)
			switch t {
			case "text", "image_url", "input_audio", "file", "thinking", "redacted_thinking":
			default:
				return fmt.Errorf("unsupported content block type %q", t)
			}
		}
		return nil
	default:
		return fmt.Errorf("content must be a string or an array of content blocks")
	}
}

func validateToolChoice(raw json.RawMessage) *domain.Error {
	var probe any
	if err := json.Unmarshal(raw, &probe); err != nil {
		return domain.ErrValidation("tool_choice must be \"auto\"|\"none\"|\"required\" or a function object")
	}
	switch v := probe.(type) {
	case string:
		switch v {
		case "auto", "none", "required":
			return nil
		default:
			return domain.ErrValidation(`tool_choice string must be "auto", "none" or "required"`)
		}
	case map[string]any:
		t, _ := v["type"].(string)
		if t != "function" {
			return domain.ErrValidation(`tool_choice object must have type "function"`)
		}
		fn, ok := v["function"].(map[string]any)
		if !ok {
			return domain.ErrValidation("tool_choice.function is required")
		}
		name, _ := fn["name"].(string)
		if name == "" || !toolNameOK(name) {
			return domain.ErrValidation("tool_choice.function.name is invalid")
		}
		return nil
	default:
		return domain.ErrValidation("tool_choice has an invalid shape")
	}
}

func validateResponseFormat(raw json.RawMessage) *domain.Error {
	var probe map[string]any
	if err := json.Unmarshal(raw, &probe); err != nil {
		return domain.ErrValidation("response_format must be an object")
	}
	t, _ := probe["type"].(string)
	switch t {
	case "text", "json_object", "json_schema":
	default:
		return domain.ErrValidation(`response_format.type must be "text", "json_object" or "json_schema"`)
	}
	return nil
}

func toolNameOK(name string) bool {
	if name == "" {
		return false
	}
	for i := 0; i < len(name); i++ {
		c := name[i]
		ok := (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
			c == '_' || c == '-' || c == '.'
		if !ok {
			return false
		}
	}
	return true
}
