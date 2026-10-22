package bifrost

import "encoding/json"

// ChatRequest is the request body for Bifrost's chat-completions endpoint.
// Field set mirrors the verified Bifrost OpenAPI ChatCompletionRequest:
// model is "provider/model"; messages are OpenAI-style; Bifrost extensions
// (fallbacks, reasoning) included. Unknown fields are preserved via Extras
// so the desktop can pass provider-specific parameters without the gateway
// needing a release.
type ChatRequest struct {
	Model               string             `json:"model"`
	Messages            []Message          `json:"messages"`
	Stream              bool               `json:"stream,omitempty"`
	StreamOptions       *StreamOptions     `json:"stream_options,omitempty"`
	Fallbacks           []string           `json:"fallbacks,omitempty"`
	Temperature         *float64           `json:"temperature,omitempty"`
	TopP                *float64           `json:"top_p,omitempty"`
	MaxCompletionTokens *int64             `json:"max_completion_tokens,omitempty"`
	MaxTokens           *int64             `json:"max_tokens,omitempty"`
	Stop                json.RawMessage    `json:"stop,omitempty"` // string or []string
	Seed                *int64             `json:"seed,omitempty"`
	FrequencyPenalty    *float64           `json:"frequency_penalty,omitempty"`
	PresencePenalty     *float64           `json:"presence_penalty,omitempty"`
	LogitBias           map[string]float64 `json:"logit_bias,omitempty"`
	Logprobs            *bool              `json:"logprobs,omitempty"`
	TopLogprobs         *int               `json:"top_logprobs,omitempty"`
	ParallelToolCalls   *bool              `json:"parallel_tool_calls,omitempty"`
	Tools               []Tool             `json:"tools,omitempty"`
	ToolChoice          json.RawMessage    `json:"tool_choice,omitempty"` // "auto"|"none"|"required" or struct
	ResponseFormat      json.RawMessage    `json:"response_format,omitempty"`
	Reasoning           *Reasoning         `json:"reasoning,omitempty"`
	User                string             `json:"user,omitempty"`
	Metadata            map[string]any     `json:"metadata,omitempty"`

	// Extras preserves forward-compatible fields validated-but-forwarded.
	Extras map[string]json.RawMessage `json:"-"`
}

// MarshalJSON emits known fields plus Extras inline.
func (r *ChatRequest) MarshalJSON() ([]byte, error) {
	type alias ChatRequest // avoid recursion
	a := alias(*r)
	base, err := json.Marshal(a)
	if err != nil || len(r.Extras) == 0 {
		return base, err
	}
	// merge Extras into the object
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

// Message is an OpenAI-style chat message. Content is RawMessage: a string
// or an array of typed content blocks, validated upstream, passed through
// without re-encoding to avoid unnecessary serialization.
type Message struct {
	Role       string            `json:"role"` // system|user|assistant|tool|developer
	Content    json.RawMessage   `json:"content,omitempty"`
	Name       string            `json:"name,omitempty"`
	ToolCallID string            `json:"tool_call_id,omitempty"`
	ToolCalls  []MessageToolCall `json:"tool_calls,omitempty"`
	Reasoning  string            `json:"reasoning,omitempty"`
	Refusal    string            `json:"refusal,omitempty"`
}

// MessageToolCall is a completed assistant tool call.
type MessageToolCall struct {
	ID       string       `json:"id"`
	Type     string       `json:"type"`
	Function FunctionCall `json:"function"`
}

// FunctionCall is the function invocation payload.
type FunctionCall struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

// Tool is a tool definition (function or custom).
type Tool struct {
	Type     string       `json:"type"` // "function" | "custom"
	Function *FunctionDef `json:"function,omitempty"`
}

// FunctionDef is the tool function schema.
type FunctionDef struct {
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	Parameters  json.RawMessage `json:"parameters,omitempty"`
	Strict      *bool           `json:"strict,omitempty"`
}

// StreamOptions mirrors Bifrost's ChatStreamOptions.
type StreamOptions struct {
	IncludeUsage bool `json:"include_usage,omitempty"`
}

// Reasoning mirrors Bifrost's ChatReasoning.
type Reasoning struct {
	Effort    string `json:"effort,omitempty"` // none|minimal|low|medium|high|xhigh
	MaxTokens *int64 `json:"max_tokens,omitempty"`
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

// ChatResponse is a non-stream completion result.
type ChatResponse struct {
	ID          string       `json:"id"`
	Object      string       `json:"object"`
	Created     int64        `json:"created"`
	Model       string       `json:"model"`
	Choices     []RespChoice `json:"choices"`
	Usage       *Usage       `json:"usage,omitempty"`
	ExtraFields *ExtraFields `json:"extra_fields,omitempty"`
}

// RespChoice is a completion choice (message for non-stream).
type RespChoice struct {
	Index        int         `json:"index"`
	FinishReason string      `json:"finish_reason"`
	Message      ChatMessage `json:"message"`
}

// ChatMessage is the completed assistant message.
type ChatMessage struct {
	Role      string            `json:"role"`
	Content   string            `json:"content,omitempty"`
	Reasoning string            `json:"reasoning,omitempty"`
	Refusal   string            `json:"refusal,omitempty"`
	ToolCalls []MessageToolCall `json:"tool_calls,omitempty"`
}

// ChatChunk is one SSE data payload of a streaming completion. Bifrost
// standardizes: finish_reason and usage appear in the LAST chunk only.
// A 200-OK stream may also carry an in-band BifrostError payload (verified
// from the Bifrost spec: mid-stream provider failures are surfaced this way),
// which IsError() detects.
type ChatChunk struct {
	ID          string        `json:"id"`
	Object      string        `json:"object"`
	Created     int64         `json:"created"`
	Model       string        `json:"model"`
	Choices     []ChunkChoice `json:"choices"`
	Usage       *Usage        `json:"usage,omitempty"`
	ExtraFields *ExtraFields  `json:"extra_fields,omitempty"`

	// In-band BifrostError fields (present only on error chunks).
	Type           string      `json:"type,omitempty"`
	IsBifrostError bool        `json:"is_bifrost_error,omitempty"`
	StatusCode     int         `json:"status_code,omitempty"`
	Error          *ErrorField `json:"error,omitempty"`
}

// IsError reports whether this chunk carries an in-band upstream error.
func (c *ChatChunk) IsError() bool {
	return c.IsBifrostError || (c.Error != nil &&
		(c.Error.Message != "" || c.Error.Code != "" || c.Error.Type != ""))
}

// ChunkChoice is the streaming choice with a delta.
type ChunkChoice struct {
	Index        int     `json:"index"`
	FinishReason *string `json:"finish_reason"` // pointer: null in most chunks
	Delta        Delta   `json:"delta"`
}

// Delta is the streaming message delta.
type Delta struct {
	Role             string            `json:"role,omitempty"`
	Content          string            `json:"content,omitempty"`
	Reasoning        string            `json:"reasoning,omitempty"`
	ReasoningContent string            `json:"reasoning_content,omitempty"` // DeepSeek/OpenRouter ext
	Refusal          string            `json:"refusal,omitempty"`
	ReasoningDetails []ReasoningDetail `json:"reasoning_details,omitempty"`
	ToolCalls        []ToolCallDelta   `json:"tool_calls,omitempty"`
}

// ReasoningDetail is a structured reasoning block.
type ReasoningDetail struct {
	ID        string `json:"id,omitempty"`
	Index     *int   `json:"index,omitempty"`
	Type      string `json:"type,omitempty"` // reasoning.summary|reasoning.text|reasoning.encrypted
	Summary   string `json:"summary,omitempty"`
	Text      string `json:"text,omitempty"`
	Signature string `json:"signature,omitempty"`
	Data      string `json:"data,omitempty"`
}

// ToolCallDelta is a streamed tool-call fragment. Index identifies the slot;
// id/name arrive once; arguments arrive incrementally.
type ToolCallDelta struct {
	Index    *int           `json:"index,omitempty"`
	ID       string         `json:"id,omitempty"`
	Type     string         `json:"type,omitempty"`
	Function *FunctionDelta `json:"function,omitempty"`
}

// FunctionDelta is the streamed function fragment.
type FunctionDelta struct {
	Name      string `json:"name,omitempty"`
	Arguments string `json:"arguments,omitempty"`
}

// Usage is BifrostLLMUsage — the authoritative token accounting.
type Usage struct {
	PromptTokens        int64                    `json:"prompt_tokens"`
	CompletionTokens    int64                    `json:"completion_tokens"`
	TotalTokens         int64                    `json:"total_tokens"`
	PromptTokensDetails *PromptTokensDetails     `json:"prompt_tokens_details,omitempty"`
	CompletionDetails   *CompletionTokensDetails `json:"completion_tokens_details,omitempty"`
	Cost                *Cost                    `json:"cost,omitempty"`
}

// PromptTokensDetails breaks down input tokens.
type PromptTokensDetails struct {
	TextTokens        int64 `json:"text_tokens,omitempty"`
	AudioTokens       int64 `json:"audio_tokens,omitempty"`
	ImageTokens       int64 `json:"image_tokens,omitempty"`
	CachedReadTokens  int64 `json:"cached_read_tokens,omitempty"`
	CachedWriteTokens int64 `json:"cached_write_tokens,omitempty"`
}

// CompletionTokensDetails breaks down output tokens.
type CompletionTokensDetails struct {
	TextTokens               int64 `json:"text_tokens,omitempty"`
	AudioTokens              int64 `json:"audio_tokens,omitempty"`
	ReasoningTokens          int64 `json:"reasoning_tokens,omitempty"`
	AcceptedPredictionTokens int64 `json:"accepted_prediction_tokens,omitempty"`
	RejectedPredictionTokens int64 `json:"rejected_prediction_tokens,omitempty"`
}

// Cost is Bifrost's cost breakdown.
type Cost struct {
	InputTokensCost  float64 `json:"input_tokens_cost,omitempty"`
	OutputTokensCost float64 `json:"output_tokens_cost,omitempty"`
	RequestCost      float64 `json:"request_cost,omitempty"`
	TotalCost        float64 `json:"total_cost,omitempty"`
}

// ExtraFields is Bifrost's per-response metadata.
type ExtraFields struct {
	RequestType     string `json:"request_type,omitempty"`
	Provider        string `json:"provider,omitempty"`
	ModelRequested  string `json:"model_requested,omitempty"`
	ModelDeployment string `json:"model_deployment,omitempty"`
	// Newer Bifrost builds (2026) renamed the resolved-model metadata:
	// original_model_requested (what the client asked for) and
	// resolved_model_used (what actually served, after routing/fallbacks).
	// Live-run against real maximhq/bifrost main 2026-09-27 (finding L1):
	// both field sets are tolerated; ResolvedModel() prefers either.
	OriginalModelRequested string `json:"original_model_requested,omitempty"`
	ResolvedModelUsed      string `json:"resolved_model_used,omitempty"`
	Latency                int64  `json:"latency,omitempty"` // milliseconds
	ChunkIndex             int    `json:"chunk_index,omitempty"`
}

// ResolvedModel returns the model that actually served the request,
// tolerating both the legacy (model_deployment) and current
// (resolved_model_used) Bifrost field names.
func (e *ExtraFields) ResolvedModel() string {
	if e == nil {
		return ""
	}
	if e.ModelDeployment != "" {
		return e.ModelDeployment
	}
	return e.ResolvedModelUsed
}

// ReasoningText returns the effective reasoning delta text across the
// extension fields providers use.
func (d *Delta) ReasoningText() string {
	if d.Reasoning != "" {
		return d.Reasoning
	}
	if d.ReasoningContent != "" {
		return d.ReasoningContent
	}
	for _, rd := range d.ReasoningDetails {
		if rd.Text != "" {
			return rd.Text
		}
		if rd.Summary != "" {
			return rd.Summary
		}
	}
	return ""
}
