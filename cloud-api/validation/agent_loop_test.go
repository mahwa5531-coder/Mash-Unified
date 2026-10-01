// Spec §37 (Test the Actual End-to-End Agent Loop).
//
// The user's directive: mock the OpenAI-agent-like input — the NexAU desktop
// runtime is NOT executed (the API contract is OpenAI-compatible, so a mock
// client produces the exact wire shapes). Full loop:
//
//	Desktop → user task → API → Bifrost → LLM tool call → Desktop →
//	local tool execution → tool result → API → Bifrost → LLM → final response
package validation

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/streaming"
)

// toolCallScript: turn 1 — the model requests a tool; turn 2 (after the tool
// result arrives) — the final text answer.
func toolCallScript() []chunk {
	return []chunk{
		{data: `{"id":"cmpl_t1","object":"chat.completion.chunk","model":"openai/gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","content":"Let me read the spreadsheet."}}]}`, delay: 20 * time.Millisecond},
		{data: `{"id":"cmpl_t1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_read_q3","type":"function","function":{"name":"read_excel","arguments":"{\"sheet\":\"Q3\",\"range\":\"A1:D20\"}"}}]}}]}`, delay: 60 * time.Millisecond},
		{data: `{"id":"cmpl_t1","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":120,"completion_tokens":35,"total_tokens":155},"extra_fields":{"provider":"openai","model_deployment":"gpt-4o-2024","latency_ms":280}}`, delay: 60 * time.Millisecond},
		{data: `[DONE]`, delay: 0},
	}
}

func finalAnswerScript() []chunk {
	return []chunk{
		{data: `{"id":"cmpl_t2","object":"chat.completion.chunk","model":"openai/gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","content":"Q3 revenue"}}]}`, delay: 20 * time.Millisecond},
		{data: `{"id":"cmpl_t2","choices":[{"index":0,"delta":{"content":" is up 12% driven by enterprise renewals."}}]}`, delay: 60 * time.Millisecond},
		{data: `{"id":"cmpl_t2","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":340,"completion_tokens":48,"total_tokens":388},"extra_fields":{"provider":"openai","model_deployment":"gpt-4o-2024","latency_ms":310}}`, delay: 60 * time.Millisecond},
		{data: `[DONE]`, delay: 0},
	}
}

// TestV37_AgentLoopOverAgentSurface: full multi-turn loop through the
// AGENT runs surface (SSE, AG-UI events) with a locally executed tool.
func TestV37_AgentLoopOverAgentSurface(t *testing.T) {
	s := newStackDefault(t)
	sess := s.sessionFor("loop", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")

	// --- Turn 1: user task; the model answers with a tool call.
	s.bifrost.setScript(toolCallScript()...)
	resp, err := s.postRun(0, tok, sess, runBody("openai/gpt-4o", "What is Q3 revenue? Read the sheet.", true), nil)
	if err != nil {
		t.Fatalf("turn 1 post: %v", err)
	}
	turn1 := readSSE(t, resp, streaming.EventRunFinished, 15*time.Second)
	if len(turn1) == 0 {
		t.Fatal("turn 1 produced no events")
	}
	assertLifecycle(t, turn1, "turn 1")

	// The tool call must be delivered as a TOOL_CALL_* lifecycle with the
	// streamed argument fragments.
	var toolName, toolArgs string
	var sawToolCall bool
	for _, e := range turn1 {
		switch e.env.Type {
		case streaming.EventToolCallStart:
			var d streaming.ToolCallStartData
			if err := jsonUnmarshal(e.env.Data, &d); err == nil {
				toolName = d.ToolCallName
				sawToolCall = true
			}
		case streaming.EventToolCallArgs:
			var d streaming.ToolCallArgsData
			if err := jsonUnmarshal(e.env.Data, &d); err == nil {
				toolArgs += d.Delta
			}
		}
	}
	if !sawToolCall || toolName != "read_excel" {
		t.Fatalf("tool call lifecycle missing: name=%q saw=%v", toolName, sawToolCall)
	}
	if !strings.Contains(toolArgs, "Q3") {
		t.Fatalf("tool call args fragmented wrong: %q", toolArgs)
	}
	run1 := turn1[0].env.RunID

	// --- The desktop executes the tool LOCALLY (this mock stand-in for the
	// NexAU local tool runtime) and reports the result.
	toolResult := `{"total_revenue": 4821000, "growth_pct": 12.0}`

	// --- Turn 2: assistant tool_call message + tool result → final answer.
	s.bifrost.setScript(finalAnswerScript()...)
	body := `{
		"model": "openai/gpt-4o",
		"stream": true,
		"messages": [
			{"role": "user", "content": "What is Q3 revenue? Read the sheet."},
			{"role": "assistant", "content": "Let me read the spreadsheet.", "tool_calls": [
				{"id": "call_read_q3", "type": "function", "function": {"name": "read_excel", "arguments": "{\"sheet\":\"Q3\",\"range\":\"A1:D20\"}"}}
			]},
			{"role": "tool", "tool_call_id": "call_read_q3", "content": ` + jsonQuote(toolResult) + `}
		]
	}`
	resp, err = s.postRun(0, tok, sess, body, nil)
	if err != nil {
		t.Fatalf("turn 2 post: %v", err)
	}
	turn2 := readSSE(t, resp, streaming.EventRunFinished, 15*time.Second)
	if len(turn2) == 0 {
		t.Fatal("turn 2 produced no events")
	}
	assertLifecycle(t, turn2, "turn 2")
	run2 := turn2[0].env.RunID

	// The final answer streams as text.
	var finalText strings.Builder
	for _, e := range turn2 {
		if e.env.Type == streaming.EventTextMessageContent {
			var d streaming.TextMessageContentData
			if err := jsonUnmarshal(e.env.Data, &d); err == nil {
				finalText.WriteString(d.Delta)
			}
		}
	}
	if !strings.Contains(finalText.String(), "up 12%") {
		t.Fatalf("final answer missing: %q", finalText.String())
	}

	// --- Invariants across the loop:
	if run1 == run2 {
		t.Fatal("the two turns must be distinct runs in the session")
	}
	for _, e := range turn2 {
		if e.env.SessionID != sess {
			t.Fatalf("turn 2 session drift: %s", e.env.SessionID)
		}
	}
	// Two upstream calls (one per turn), two usage records.
	if s.bifrost.count() != 2 {
		t.Fatalf("upstream calls=%d, want 2 (one per LLM turn)", s.bifrost.count())
	}
	if !waitFor(t, 5*time.Second, func() bool { return len(s.usage.records()) == 2 }) {
		t.Fatalf("usage records=%d, want 2 (one per turn)", len(s.usage.records()))
	}
	u1, u2 := s.usage.records()[0], s.usage.records()[1]
	if u1.Usage.OutputTokens != 35 || u2.Usage.OutputTokens != 48 {
		t.Fatalf("per-turn usage attribution: %+v / %+v", u1.Usage, u2.Usage)
	}
	if u1.RunID != run1 || u2.RunID != run2 {
		t.Fatalf("usage-to-run attribution: %s/%s want %s/%s", u1.RunID, u2.RunID, run1, run2)
	}
	vm(t, "agent_loop_turns", 2)
	vm(t, "agent_loop_tool_calls", 1)
}

// TestV37_AgentLoopOverOpenAICompatSurface: the same loop through the
// OpenAI-compatible chat/completions surface — the wire shape the NexAU
// desktop's LLMConfig client produces. Raw SSE chunks pass through
// verbatim; the mock desktop parses OpenAI chunks, executes the tool, and
// completes the loop.
func TestV37_AgentLoopOverOpenAICompatSurface(t *testing.T) {
	s := newStackDefault(t)
	tok := s.tokenFor("usr_1", "ten_A")

	// --- Turn 1: stream=true, the model requests the tool.
	s.bifrost.setScript(toolCallScript()...)
	resp, err := s.chat(0, tok, `{"model":"openai/gpt-4o","stream":true,"messages":[{"role":"user","content":"What is Q3 revenue?"}]}`, nil)
	if err != nil {
		t.Fatalf("turn 1 chat: %v", err)
	}
	lines := readRawSSE(t, resp, 15*time.Second)
	if len(lines) == 0 {
		t.Fatal("turn 1 produced no chunks")
	}

	// The mock desktop assembles the OpenAI tool_call from the raw chunks.
	var assistantToolCall struct {
		ID       string `json:"id"`
		Type     string `json:"type"`
		Function struct {
			Name      string `json:"name"`
			Arguments string `json:"arguments"`
		} `json:"function"`
	}
	var toolCallJSON string
	var finishReason string
	for _, l := range lines {
		if l == "[DONE]" {
			continue
		}
		var chunk struct {
			Choices []struct {
				FinishReason string `json:"finish_reason"`
				Delta        struct {
					ToolCalls []json.RawMessage `json:"tool_calls"`
				} `json:"delta"`
			} `json:"choices"`
			Usage json.RawMessage `json:"usage"`
		}
		if err := json.Unmarshal([]byte(l), &chunk); err != nil {
			continue
		}
		if len(chunk.Choices) == 0 {
			continue
		}
		if chunk.Choices[0].FinishReason != "" {
			finishReason = chunk.Choices[0].FinishReason
		}
		for _, tc := range chunk.Choices[0].Delta.ToolCalls {
			toolCallJSON += string(tc)
		}
	}
	if finishReason != "tool_calls" {
		t.Fatalf("turn 1 finish_reason=%q, want tool_calls (raw passthrough must preserve it)", finishReason)
	}
	if toolCallJSON == "" || !strings.Contains(toolCallJSON, "read_excel") {
		t.Fatalf("tool call not delivered verbatim: %s", toolCallJSON)
	}
	_ = assistantToolCall

	// --- Local tool execution (mock desktop side).
	toolResult := `{"total_revenue": 4821000, "growth_pct": 12.0}`

	// --- Turn 2: full OpenAI conversation shape → final answer.
	s.bifrost.setScript(finalAnswerScript()...)
	body := `{
		"model": "openai/gpt-4o",
		"stream": true,
		"messages": [
			{"role": "user", "content": "What is Q3 revenue?"},
			{"role": "assistant", "content": null, "tool_calls": [
				{"id": "call_read_q3", "type": "function", "function": {"name": "read_excel", "arguments": "{\"sheet\":\"Q3\",\"range\":\"A1:D20\"}"}}
			]},
			{"role": "tool", "tool_call_id": "call_read_q3", "content": ` + jsonQuote(toolResult) + `}
		]
	}`
	resp, err = s.chat(0, tok, body, nil)
	if err != nil {
		t.Fatalf("turn 2 chat: %v", err)
	}
	lines = readRawSSE(t, resp, 15*time.Second)
	var text strings.Builder
	for _, l := range lines {
		if l == "[DONE]" {
			continue
		}
		var chunk struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
		}
		if err := json.Unmarshal([]byte(l), &chunk); err != nil {
			continue
		}
		if len(chunk.Choices) > 0 {
			text.WriteString(chunk.Choices[0].Delta.Content)
		}
	}
	if !strings.Contains(text.String(), "up 12%") {
		t.Fatalf("final answer missing on compat surface: %q", text.String())
	}
	if s.bifrost.count() != 2 {
		t.Fatalf("upstream calls=%d, want 2", s.bifrost.count())
	}
	// The compat surface derives a deterministic implicit session; both turns
	// executed and billed.
	if !waitFor(t, 5*time.Second, func() bool { return len(s.usage.records()) == 2 }) {
		t.Fatalf("usage records=%d, want 2", len(s.usage.records()))
	}
	vm(t, "agent_loop_compat_surface", 1)
}

// TestV37_AgentLoopOverWebSocket: the same loop over the WebSocket
// transport with TOOL_CALL_* events and cancellation mid-loop.
func TestV37_AgentLoopOverWebSocket(t *testing.T) {
	s := newStackDefault(t)
	sess := s.sessionFor("wsloop", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")

	// --- Turn 1 over WS.
	s.bifrost.setScript(toolCallScript()...)
	conn, _, err := dialWS(t, s.replicas[0].url, tok, sess)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	wsRunCreate(t, conn, runBody("openai/gpt-4o", "What is Q3 revenue?", true))
	turn1, _ := wsRead(t, conn, streaming.EventRunFinished, 15*time.Second)
	if len(turn1) < 6 {
		t.Fatalf("turn 1 events=%d", len(turn1))
	}
	assertLifecycleW(t, turn1, "ws turn 1")
	sawTool := false
	for _, e := range turn1 {
		if e.Type == streaming.EventToolCallStart || e.Type == streaming.EventToolCallArgs || e.Type == streaming.EventToolCallEnd {
			sawTool = true
		}
	}
	if !sawTool {
		t.Fatal("WS turn 1 missing tool call lifecycle")
	}
	run1 := turn1[0].RunID

	// --- Turn 2 with the tool result, on the SAME connection.
	s.bifrost.setScript(finalAnswerScript()...)
	body := `{
		"model": "openai/gpt-4o",
		"stream": true,
		"messages": [
			{"role": "user", "content": "What is Q3 revenue?"},
			{"role": "assistant", "tool_calls": [{"id": "call_read_q3", "type": "function", "function": {"name": "read_excel", "arguments": "{}"}}]},
			{"role": "tool", "tool_call_id": "call_read_q3", "content": "{\"total_revenue\": 4821000}"}
		]
	}`
	wsRunCreate(t, conn, body)
	turn2, _ := wsRead(t, conn, streaming.EventRunFinished, 15*time.Second)
	assertLifecycleW(t, turn2, "ws turn 2")
	if len(turn2) == 0 || turn2[0].RunID == run1 {
		t.Fatalf("ws turn 2 run identity: %d events", len(turn2))
	}

	// --- Cancellation mid-loop: turn 3 stalls; the desktop cancels.
	s.bifrost.setScript(
		chunk{data: `{"id":"cmpl_t3","choices":[{"index":0,"delta":{"role":"assistant","content":"thinking"}}]}`, delay: 30 * time.Millisecond},
		chunk{data: `{"id":"cmpl_t3","choices":[{"index":0,"delta":{"content":"..."}}]}`, delay: 20 * time.Second},
	)
	wsRunCreate(t, conn, runBody("openai/gpt-4o", "one more thing", true))
	events3, _ := wsRead(t, conn, streaming.EventTextMessageContent, 5*time.Second)
	if len(events3) == 0 {
		t.Fatal("turn 3 did not start")
	}
	run3 := events3[0].RunID
	if err := conn.WriteJSON(map[string]any{"type": "run.cancel", "run_id": run3}); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	waitFor(t, 5*time.Second, func() bool { return s.bifrost.cancelCount() > 0 })
	waitFor(t, 5*time.Second, func() bool {
		r := s.runs.get(run3)
		return r != nil && r.Terminal()
	})
	if r := s.runs.get(run3); r == nil || r.Status != domainRunCancelled {
		t.Fatalf("ws loop cancel: %+v", r)
	}

	// Usage: turn 1 + turn 2 billed (turn 3 cancelled pre-usage).
	if !waitFor(t, 5*time.Second, func() bool { return len(s.usage.records()) >= 2 }) {
		t.Fatalf("usage records=%d, want >=2", len(s.usage.records()))
	}
	vm(t, "agent_loop_ws_turns", 3)
}

// --- helpers -----------------------------------------------------------------

// assertLifecycle checks the AG-UI event-shape invariants of one turn.
func assertLifecycle(t *testing.T, events []sseEvt, label string) {
	t.Helper()
	if events[0].env.Type != streaming.EventRunStarted {
		t.Fatalf("%s: first event %s", label, events[0].env.Type)
	}
	last := events[len(events)-1].env.Type
	if last != streaming.EventRunFinished {
		t.Fatalf("%s: terminal event %s", label, last)
	}
	// Sequences are monotonic + gap-free per run.
	for i := 1; i < len(events); i++ {
		if events[i].env.Sequence != events[i-1].env.Sequence+1 {
			t.Fatalf("%s: sequence gap %d→%d", label, events[i-1].env.Sequence, events[i].env.Sequence)
		}
	}
	// Every open lifecycle closes: TEXT_MESSAGE_START ⇔ TEXT_MESSAGE_END etc.
	opened, closed := 0, 0
	for _, e := range events {
		switch e.env.Type {
		case streaming.EventTextMessageStart, streaming.EventToolCallStart:
			opened++
		case streaming.EventTextMessageEnd, streaming.EventToolCallEnd:
			closed++
		}
	}
	if opened != closed {
		t.Fatalf("%s: lifecycle mismatch opened=%d closed=%d", label, opened, closed)
	}
}

func assertLifecycleW(t *testing.T, events []streaming.Envelope, label string) {
	t.Helper()
	if events[0].Type != streaming.EventRunStarted {
		t.Fatalf("%s: first event %s", label, events[0].Type)
	}
	if events[len(events)-1].Type != streaming.EventRunFinished {
		t.Fatalf("%s: terminal event %s", label, events[len(events)-1].Type)
	}
	for i := 1; i < len(events); i++ {
		if events[i].Sequence != events[i-1].Sequence+1 {
			t.Fatalf("%s: sequence gap %d→%d", label, events[i-1].Sequence, events[i].Sequence)
		}
	}
}

func jsonQuote(s string) string {
	b, err := json.Marshal(s)
	if err != nil {
		return `"{}"`
	}
	return string(b)
}
