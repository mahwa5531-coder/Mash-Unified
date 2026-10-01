// mapper converts Bifrost chat-completions stream chunks into the NexAU
// AG-UI-compatible event stream. Lifecycle parity with the local NexAU
// runtime (verified from its OpenAI chat aggregator):
//
//	TEXT_MESSAGE_START → CONTENT… → END
//	THINKING_TEXT_MESSAGE_START → CONTENT… → END
//	TOOL_CALL_START → ARGS… → END (per tool call, keyed by stream index)
//	USAGE_UPDATE on the final chunk (Bifrost puts usage there)
//	MODEL_CALL_FINISHED + RUN_FINISHED bookends
//
// Only choices[0] is processed — NexAU drops non-first choices; the cloud
// preserves that semantic. The mapper is stateful per run and used by exactly
// one goroutine (the run producer), so it needs no internal locking.
package agent

import (
	"github.com/nexau-cloud/nexau-api/internal/bifrost"
	"github.com/nexau-cloud/nexau-api/internal/domain"
	"github.com/nexau-cloud/nexau-api/internal/ids"
	"github.com/nexau-cloud/nexau-api/internal/streaming"
)

// Mapper is per-run chunk→event state.
type Mapper struct {
	runID     string
	sessionID string
	threadID  string
	turnID    string
	model     string

	msgID     string
	msgOpen   bool
	thinkID   string
	thinkOpen bool

	// toolCalls keys on the OpenAI stream index; absent index → append slot.
	toolOrder []string
	toolCalls map[string]*toolCallState

	usage         *domain.TokenUsage
	finish        string
	ended         bool
	upstreamModel string
	provider      string
	latencyMS     int64
}

type toolCallState struct {
	id   string
	name string
	open bool
}

func NewMapper(runID, sessionID, threadID, turnID, model string) *Mapper {
	return &Mapper{
		runID:     runID,
		sessionID: sessionID,
		threadID:  threadID,
		turnID:    turnID,
		model:     model,
		toolCalls: map[string]*toolCallState{},
	}
}

// MapChunk converts one decoded Bifrost chunk into zero or more events.
// The final chunk (finish_reason/usage) produces no terminal events here —
// Finish() closes lifecycles after the stream ends so that aborts mid-stream
// can still close whatever opened (partial-but-valid event sequences).
func (m *Mapper) MapChunk(chunk *bifrost.ChatChunk) []*streaming.Envelope {
	var out []*streaming.Envelope
	if chunk == nil || m.ended {
		return nil
	}

	if chunk.Model != "" {
		m.upstreamModel = chunk.Model
	}
	if chunk.ExtraFields != nil {
		if chunk.ExtraFields.Provider != "" {
			m.provider = chunk.ExtraFields.Provider
		}
		if chunk.ExtraFields.ModelDeployment != "" {
			m.upstreamModel = chunk.ExtraFields.ModelDeployment
		} else if chunk.ExtraFields.ResolvedModelUsed != "" {
			m.upstreamModel = chunk.ExtraFields.ResolvedModelUsed
		}
		if chunk.ExtraFields.Latency > 0 {
			m.latencyMS = chunk.ExtraFields.Latency
		}
	}
	if chunk.Usage != nil {
		m.usage = NormalizeUsage(chunk.Usage)
	}

	// choices[0] only (NexAU aggregator parity).
	for _, ch := range chunk.Choices {
		if ch.Index != 0 {
			continue
		}
		if ch.FinishReason != nil && *ch.FinishReason != "" {
			m.finish = *ch.FinishReason
		}
		d := &ch.Delta

		if d.Role == "assistant" || d.Content != "" {
			if !m.msgOpen {
				m.msgID = ids.MessageID()
				m.msgOpen = true
				out = append(out, m.env(streaming.EventTextMessageStart,
					streaming.TextMessageStartData{MessageID: m.msgID, Role: "assistant"}))
			}
		}
		if d.Content != "" {
			// Answer text begins: close the thinking lifecycle AT the
			// reasoning→answer transition so the desktop never renders
			// an open thinking box while streaming the answer (audit
			// finding 6).
			out = append(out, m.closeThinking()...)
			out = append(out, m.env(streaming.EventTextMessageContent,
				streaming.TextMessageContentData{MessageID: m.msgID, Delta: d.Content}))
		}
		if d.Refusal != "" && m.msgOpen {
			// Refusals ride the text channel: the desktop renders them as the
			// assistant message content (OpenAI semantics).
			out = append(out, m.env(streaming.EventTextMessageContent,
				streaming.TextMessageContentData{MessageID: m.msgID, Delta: d.Refusal}))
		}

		if rt := d.ReasoningText(); rt != "" {
			// Thinking belongs to the assistant message (NexAU parity:
			// thinking_message_id + parent_message_id): the parent
			// message must exist BEFORE the thinking block opens —
			// reasoning-first streams (DeepSeek R1, o1/o3) arrive
			// before any role or content chunk (audit finding 6).
			if !m.msgOpen {
				m.msgID = ids.MessageID()
				m.msgOpen = true
				out = append(out, m.env(streaming.EventTextMessageStart,
					streaming.TextMessageStartData{MessageID: m.msgID, Role: "assistant"}))
			}
			if !m.thinkOpen {
				m.thinkID = ids.ThinkingMsgID()
				m.thinkOpen = true
				out = append(out, m.env(streaming.EventThinkingTextStart,
					streaming.ThinkingTextStartData{
						ThinkingMessageID: m.thinkID,
						ParentMessageID:   m.msgID,
					}))
			}
			out = append(out, m.env(streaming.EventThinkingTextContent,
				streaming.ThinkingTextContentData{ThinkingMessageID: m.thinkID, Delta: rt}))
		}

		for _, tc := range d.ToolCalls {
			key := m.toolKey(tc.Index, len(m.toolOrder))
			st := m.toolCalls[key]
			if st == nil {
				// A tool call implies the assistant message exists (NexAU
				// parity: tool calls belong to the assistant message) — the
				// message opens BEFORE the tool call it contains.
				if !m.msgOpen {
					m.msgID = ids.MessageID()
					m.msgOpen = true
					out = append(out, m.env(streaming.EventTextMessageStart,
						streaming.TextMessageStartData{MessageID: m.msgID, Role: "assistant"}))
				}
				// Reasoning that precedes tool calls ends here too.
				out = append(out, m.closeThinking()...)
				id := tc.ID
				if id == "" {
					id = ids.New("tcall")
				}
				st = &toolCallState{id: id, open: true}
				m.toolCalls[key] = st
				m.toolOrder = append(m.toolOrder, key)
				name := ""
				if tc.Function != nil {
					name = tc.Function.Name
				}
				st.name = name
				out = append(out, m.env(streaming.EventToolCallStart,
					streaming.ToolCallStartData{
						ToolCallID:      st.id,
						ToolCallName:    name,
						ParentMessageID: m.msgID,
					}))
			}
			if tc.Function != nil && tc.Function.Arguments != "" {
				out = append(out, m.env(streaming.EventToolCallArgs,
					streaming.ToolCallArgsData{ToolCallID: st.id, Delta: tc.Function.Arguments}))
			}
		}
		break // only choices[0]
	}
	return out
}

// Finish closes every open lifecycle and appends the run bookends. It is
// idempotent and terminal: call exactly once per run, after the stream ends
// (clean end, error or cancellation).
func (m *Mapper) Finish(finishReason string) []*streaming.Envelope {
	if m.ended {
		return nil
	}
	m.ended = true
	if finishReason != "" {
		m.finish = finishReason
	}

	var out []*streaming.Envelope
	if m.msgOpen {
		out = append(out, m.env(streaming.EventTextMessageEnd,
			streaming.TextMessageEndData{MessageID: m.msgID}))
	}
	if m.thinkOpen {
		out = append(out, m.env(streaming.EventThinkingTextEnd,
			streaming.ThinkingTextEndData{ThinkingMessageID: m.thinkID}))
	}
	for _, key := range m.toolOrder {
		if st := m.toolCalls[key]; st != nil && st.open {
			st.open = false
			out = append(out, m.env(streaming.EventToolCallEnd,
				streaming.ToolCallEndData{ToolCallID: st.id}))
		}
	}
	if m.usage != nil {
		out = append(out, m.env(streaming.EventUsageUpdate, usageData(m.usage)))
	}
	out = append(out, m.env(streaming.EventModelCallFinished,
		streaming.ModelCallFinishedData{RunID: m.runID, FinishReason: m.finish, Usage: usageData(m.usage)}))
	out = append(out, m.env(streaming.EventRunFinished,
		streaming.RunFinishedData{ThreadID: m.threadID, RunID: m.runID, FinishReason: m.finish, Usage: usageData(m.usage)}))
	return out
}

// FinishOnError produces the error bookend (RUN_ERROR) after closing open
// lifecycles — the desktop always observes a terminated run. When the mapper
// already received provider-reported usage (interim input/partial-output
// tokens), a final USAGE_UPDATE precedes the error so cancel/disconnect
// paths do not silently drop metered consumption (2026-09-19 audit finding).
func (m *Mapper) FinishError(code, message string) []*streaming.Envelope {
	var out []*streaming.Envelope
	if !m.ended {
		// Close lifecycles silently so partial output stays well-formed.
		if m.msgOpen {
			out = append(out, m.env(streaming.EventTextMessageEnd, streaming.TextMessageEndData{MessageID: m.msgID}))
		}
		if m.thinkOpen {
			out = append(out, m.env(streaming.EventThinkingTextEnd, streaming.ThinkingTextEndData{ThinkingMessageID: m.thinkID}))
		}
		for _, key := range m.toolOrder {
			if st := m.toolCalls[key]; st != nil && st.open {
				st.open = false
				out = append(out, m.env(streaming.EventToolCallEnd, streaming.ToolCallEndData{ToolCallID: st.id}))
			}
		}
		m.ended = true
	}
	if m.usage != nil {
		out = append(out, m.env(streaming.EventUsageUpdate, usageData(m.usage)))
	}
	out = append(out, m.env(streaming.EventRunError, streaming.RunErrorData{
		ThreadID: m.threadID, Code: code, Message: message,
	}))
	return out
}

// Outcome summarizes metering-relevant facts accumulated across the stream.
type Outcome struct {
	FinishReason string
	Usage        *domain.TokenUsage
	Provider     string
	Model        string
	LatencyMS    int64
}

// Outcome reports what the mapper observed (call after Finish).
func (m *Mapper) Outcome() Outcome {
	return Outcome{
		FinishReason: m.finish,
		Usage:        m.usage,
		Provider:     m.provider,
		Model:        m.upstreamModel,
		LatencyMS:    m.latencyMS,
	}
}

// NormalizeUsage maps Bifrost's BifrostLLMUsage onto the NexAU canonical
// TokenUsage (nexau/core/usage.py semantics):
//
//	input_tokens        non-cached input (prompt minus cache hits/writes)
//	cache_read_tokens   cached input
//	cache_write_tokens  cache write
//	output_tokens       provider completion count (includes reasoning)
//	reasoning_tokens    reasoning subset of completion
//	total_tokens        provider total
func NormalizeUsage(u *bifrost.Usage) *domain.TokenUsage {
	if u == nil {
		return nil
	}
	t := &domain.TokenUsage{
		InputTokens:      u.PromptTokens,
		OutputTokens:     u.CompletionTokens,
		TotalTokens:      u.TotalTokens,
		ReasoningTokens:  0,
		CacheReadTokens:  0,
		CacheWriteTokens: 0,
	}
	if u.PromptTokensDetails != nil {
		t.CacheReadTokens = u.PromptTokensDetails.CachedReadTokens
		t.CacheWriteTokens = u.PromptTokensDetails.CachedWriteTokens
	}
	if u.CompletionDetails != nil {
		t.ReasoningTokens = u.CompletionDetails.ReasoningTokens
	}
	// input_tokens = prompt − cached hit − cached write (floor 0).
	cached := t.CacheReadTokens + t.CacheWriteTokens
	if cached > 0 && cached <= t.InputTokens {
		t.InputTokens = u.PromptTokens - cached
	}
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

func usageData(u *domain.TokenUsage) *streaming.RunUsageData {
	if u == nil {
		return nil
	}
	return &streaming.RunUsageData{
		InputTokens:      u.InputTokens,
		OutputTokens:     u.OutputTokens,
		TotalTokens:      u.TotalTokens,
		ReasoningTokens:  u.ReasoningTokens,
		CacheReadTokens:  u.CacheReadTokens,
		CacheWriteTokens: u.CacheWriteTokens,
		InputCost:        u.InputCost,
		OutputCost:       u.OutputCost,
		TotalCost:        u.TotalCost,
	}
}

// StartEnvelope builds the RUN_STARTED opener.
func (m *Mapper) StartEnvelope() *streaming.Envelope {
	return m.env(streaming.EventRunStarted, streaming.RunStartedData{
		ThreadID: m.threadID, Model: m.model, TurnID: m.turnID, SessionID: m.sessionID,
	})
}

// CancelEnvelope builds the RUN_CANCELLED notice.
func (m *Mapper) CancelEnvelope(cancelledBy string) *streaming.Envelope {
	return m.env(streaming.EventRunCancelled, streaming.RunCancelledData{
		ThreadID: m.threadID, RunID: m.runID, CancelledBy: cancelledBy,
	})
}

func (m *Mapper) env(typ string, data any) *streaming.Envelope {
	return streaming.NewEnvelope(m.sessionID, m.runID, typ, data)
}

// closeThinking ends an open thinking lifecycle at a semantic boundary
// (answer text begins, tool calls begin). Idempotent: no-op when thinking is
// not open. Returns the END envelope to append (audit finding 6).
func (m *Mapper) closeThinking() []*streaming.Envelope {
	if !m.thinkOpen {
		return nil
	}
	m.thinkOpen = false
	return []*streaming.Envelope{m.env(streaming.EventThinkingTextEnd,
		streaming.ThinkingTextEndData{ThinkingMessageID: m.thinkID})}
}

// toolKey resolves the stable key of a streamed tool call. OpenAI indexes
// arrive on the first fragment and persist; Bifrost preserves them. Absent
// index → positional append.
func (m *Mapper) toolKey(idx *int, position int) string {
	if idx != nil {
		return "i" + itoa(*idx)
	}
	return "p" + itoa(position)
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}
