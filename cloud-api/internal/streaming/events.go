// Package streaming defines the transport-neutral NexaU event envelope and the
// AG-UI-compatible event vocabulary. The envelope is the ONLY shape that
// crosses the cloud→desktop boundary on every transport (SSE and WebSocket);
// event payloads preserve the NexAU/AG-UI runtime vocabulary so the desktop
// event consumer needs no translation layer.
//
// Verified against nex-agi/NexAU (nexau/archs/main_sub/execution/middleware/
// agent_events.py and AG-UI protocol): lifecycle pattern is
// START → CONTENT… → END per logical unit (text message, thinking message,
// tool call), with RUN_* bookends and USAGE_UPDATE on the final chunk.
package streaming

import (
	"encoding/json"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/ids"
)

// Envelope is the wire shape of every cloud→desktop event.
type Envelope struct {
	EventID   string          `json:"event_id"`
	SessionID string          `json:"session_id"`
	RunID     string          `json:"run_id"`
	Sequence  int64           `json:"sequence"` // per-run, monotonic, gap-free
	Type      string          `json:"type"`
	Timestamp time.Time       `json:"timestamp"`
	Data      json.RawMessage `json:"data,omitempty"`
}

// AG-UI-compatible event types (NexAU runtime vocabulary, preserved).
const (
	EventRunStarted          = "RUN_STARTED"
	EventRunFinished         = "RUN_FINISHED"
	EventRunError            = "RUN_ERROR"
	EventRunCancelled        = "RUN_CANCELLED"
	EventTextMessageStart    = "TEXT_MESSAGE_START"
	EventTextMessageContent  = "TEXT_MESSAGE_CONTENT"
	EventTextMessageEnd      = "TEXT_MESSAGE_END"
	EventThinkingTextStart   = "THINKING_TEXT_MESSAGE_START"
	EventThinkingTextContent = "THINKING_TEXT_MESSAGE_CONTENT"
	EventThinkingTextEnd     = "THINKING_TEXT_MESSAGE_END"
	EventToolCallStart       = "TOOL_CALL_START"
	EventToolCallArgs        = "TOOL_CALL_ARGS"
	EventToolCallEnd         = "TOOL_CALL_END"
	EventToolCallResult      = "TOOL_CALL_RESULT"
	EventUsageUpdate         = "USAGE_UPDATE"
	EventModelCallFinished   = "MODEL_CALL_FINISHED"
	EventRawModelMessage     = "RAW_MODEL_MESSAGE" // raw OpenAI chunk passthrough (compat surface)
	EventHeartbeat           = "heartbeat"         // SSE comment / WS ping level; never sequenced
	// Reconnection control (WS path only, still envelope-shaped).
	EventResumeOK     = "RESUME_OK"
	EventResumeMissed = "RESUME_MISSED"
)

// Data payloads (AG-UI-compatible field names).

type RunStartedData struct {
	ThreadID  string          `json:"thread_id"`
	Model     string          `json:"model,omitempty"`
	TurnID    string          `json:"turn_id,omitempty"`
	SessionID string          `json:"session_id,omitempty"`
	Tools     json.RawMessage `json:"tools,omitempty"`
}

type RunFinishedData struct {
	ThreadID     string        `json:"thread_id"`
	RunID        string        `json:"run_id,omitempty"`
	FinishReason string        `json:"finish_reason,omitempty"`
	Usage        *RunUsageData `json:"usage,omitempty"`
}

type RunErrorData struct {
	ThreadID string `json:"thread_id"`
	Code     string `json:"code,omitempty"`
	Message  string `json:"message,omitempty"`
}

type RunCancelledData struct {
	ThreadID    string `json:"thread_id"`
	RunID       string `json:"run_id,omitempty"`
	CancelledBy string `json:"cancelled_by,omitempty"`
}

type TextMessageStartData struct {
	MessageID string `json:"message_id"`
	Role      string `json:"role"`
}

type TextMessageContentData struct {
	MessageID string `json:"message_id"`
	Delta     string `json:"delta"`
}

type TextMessageEndData struct {
	MessageID string `json:"message_id"`
}

type ThinkingTextStartData struct {
	// NexAU field name parity: thinking_message_id + parent_message_id.
	ThinkingMessageID string `json:"thinking_message_id"`
	ParentMessageID   string `json:"parent_message_id,omitempty"`
}

type ThinkingTextContentData struct {
	ThinkingMessageID string `json:"thinking_message_id"`
	Delta             string `json:"delta"`
}

type ThinkingTextEndData struct {
	ThinkingMessageID string `json:"thinking_message_id"`
}

type ToolCallStartData struct {
	ToolCallID      string `json:"tool_call_id"`
	ToolCallName    string `json:"tool_call_name"`
	ParentMessageID string `json:"parent_message_id,omitempty"`
}

type ToolCallArgsData struct {
	ToolCallID string `json:"tool_call_id"`
	Delta      string `json:"delta"`
}

type ToolCallEndData struct {
	ToolCallID string `json:"tool_call_id"`
}

type RunUsageData struct {
	InputTokens      int64   `json:"input_tokens"`
	OutputTokens     int64   `json:"output_tokens"`
	TotalTokens      int64   `json:"total_tokens"`
	ReasoningTokens  int64   `json:"reasoning_tokens"`
	CacheReadTokens  int64   `json:"cache_read_tokens"`
	CacheWriteTokens int64   `json:"cache_write_tokens"`
	InputCost        float64 `json:"input_cost,omitempty"`
	OutputCost       float64 `json:"output_cost,omitempty"`
	TotalCost        float64 `json:"total_cost,omitempty"`
}

type ModelCallFinishedData struct {
	RunID        string        `json:"run_id,omitempty"`
	FinishReason string        `json:"finish_reason,omitempty"`
	Usage        *RunUsageData `json:"usage,omitempty"`
}

// NewEnvelope builds an envelope with a fresh event id and timestamp. The
// producer assigns the sequence.
func NewEnvelope(sessionID, runID, typ string, data any) *Envelope {
	var raw json.RawMessage
	if data != nil {
		b, err := json.Marshal(data)
		if err == nil {
			raw = b
		}
	}
	return &Envelope{
		EventID:   ids.EventID(),
		SessionID: sessionID,
		RunID:     runID,
		Type:      typ,
		Timestamp: time.Now().UTC(),
		Data:      raw,
	}
}

// Marshal serializes the envelope (pre-serialized once, forwarded everywhere).
func (e *Envelope) Marshal() []byte {
	b, err := json.Marshal(e)
	if err != nil {
		// Envelope fields are marshal-safe by construction; the fallback keeps
		// the stream alive no matter what a future field introduces.
		return []byte(`{"type":"RUN_ERROR","data":{"message":"envelope encoding failure"}}`)
	}
	return b
}

// DecodeEnvelope parses a stored/bus envelope.
func DecodeEnvelope(blob []byte) (*Envelope, error) {
	e := &Envelope{}
	if err := json.Unmarshal(blob, e); err != nil {
		return nil, err
	}
	return e, nil
}
