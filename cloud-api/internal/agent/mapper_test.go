package agent

import (
	"encoding/json"
	"testing"

	"github.com/nexau-cloud/nexau-api/internal/bifrost"
	"github.com/nexau-cloud/nexau-api/internal/streaming"
)

func newMapper() *Mapper {
	return NewMapper("run_1", "sess_1", "sess_1", "turn_1", "openai/gpt-4o")
}

func types(envs []*streaming.Envelope) []string {
	out := make([]string, len(envs))
	for i, e := range envs {
		out[i] = e.Type
	}
	return out
}

func chunk(delta bifrost.Delta) *bifrost.ChatChunk {
	return &bifrost.ChatChunk{
		ID:      "cmpl_1",
		Model:   "openai/gpt-4o",
		Choices: []bifrost.ChunkChoice{{Index: 0, Delta: delta}},
	}
}

func TestMapperTextLifecycle(t *testing.T) {
	m := newMapper()

	var got []string
	got = append(got, types(m.MapChunk(chunk(bifrost.Delta{Role: "assistant"})))...)
	got = append(got, types(m.MapChunk(chunk(bifrost.Delta{Content: "Revenue"})))...)
	got = append(got, types(m.MapChunk(chunk(bifrost.Delta{Content: " up"})))...)
	got = append(got, types(m.Finish("stop"))...)

	want := []string{
		streaming.EventTextMessageStart,
		streaming.EventTextMessageContent,
		streaming.EventTextMessageContent,
		streaming.EventTextMessageEnd,
		streaming.EventModelCallFinished,
		streaming.EventRunFinished,
	}
	if len(got) != len(want) {
		t.Fatalf("events: %v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("events[%d] = %s, want %s (all: %v)", i, got[i], want[i], got)
		}
	}
}

func TestMapperThinkingLifecycle(t *testing.T) {
	m := newMapper()
	var got []string
	got = append(got, types(m.MapChunk(chunk(bifrost.Delta{Reasoning: "thinking..."})))...)
	got = append(got, types(m.MapChunk(chunk(bifrost.Delta{ReasoningContent: " more"})))...)
	got = append(got, types(m.MapChunk(chunk(bifrost.Delta{Content: "answer"})))...)
	got = append(got, types(m.Finish(""))...)

	// Audit finding 6 semantics: the assistant message opens BEFORE the
	// thinking block (parent_message_id must reference it), and the thinking
	// lifecycle closes AT the reasoning→answer transition — not at Finish().
	want := []string{
		streaming.EventTextMessageStart,  // parent message exists first
		streaming.EventThinkingTextStart, // parent_message_id set
		streaming.EventThinkingTextContent,
		streaming.EventThinkingTextContent,
		streaming.EventThinkingTextEnd,    // closed at the transition
		streaming.EventTextMessageContent, // answer streams after thinking END
		streaming.EventTextMessageEnd,
		streaming.EventModelCallFinished,
		streaming.EventRunFinished,
	}
	if len(got) != len(want) {
		t.Fatalf("thinking lifecycle: %v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("thinking[%d] = %s, want %s (all: %v)", i, got[i], want[i], got)
		}
	}
}

// TestMapperThinkingParentMessageID guards audit finding 6: a reasoning-first
// stream (DeepSeek R1 / o1-style: thinking chunks arrive with no role and no
// content) must produce THINKING_TEXT_MESSAGE_START with a non-empty
// parent_message_id.
func TestMapperThinkingParentMessageID(t *testing.T) {
	m := newMapper()
	envs := m.MapChunk(chunk(bifrost.Delta{Reasoning: "hmm"}))
	var start *streaming.Envelope
	for _, e := range envs {
		if e.Type == streaming.EventThinkingTextStart {
			start = e
		}
	}
	if start == nil {
		t.Fatalf("no THINKING_TEXT_MESSAGE_START: %v", types(envs))
	}
	var d streaming.ThinkingTextStartData
	if err := decodeData(start, &d); err != nil {
		t.Fatalf("data: %v", err)
	}
	if d.ThinkingMessageID == "" {
		t.Error("thinking_message_id empty")
	}
	if d.ParentMessageID == "" {
		t.Error("parent_message_id empty — thinking block has no parent message")
	}
}

// TestMapperThinkingEndsBeforeToolCalls: reasoning that precedes tool calls
// must close at the tool-call boundary too.
func TestMapperThinkingEndsBeforeToolCalls(t *testing.T) {
	m := newMapper()
	idx := 0
	var got []string
	got = append(got, types(m.MapChunk(chunk(bifrost.Delta{Reasoning: "plan"})))...)
	got = append(got, types(m.MapChunk(chunk(bifrost.Delta{ToolCalls: []bifrost.ToolCallDelta{{
		Index: &idx, ID: "call_X", Type: "function",
		Function: &bifrost.FunctionDelta{Name: "bash"},
	}}})))...)

	wantPrefix := []string{
		streaming.EventTextMessageStart,
		streaming.EventThinkingTextStart,
		streaming.EventThinkingTextContent,
		streaming.EventThinkingTextEnd,
		streaming.EventToolCallStart,
	}
	if len(got) < len(wantPrefix) {
		t.Fatalf("events: %v", got)
	}
	for i := range wantPrefix {
		if got[i] != wantPrefix[i] {
			t.Fatalf("thinking→tool[%d] = %s, want %s (all: %v)", i, got[i], wantPrefix[i], got)
		}
	}
}

func TestMapperToolCallLifecycle(t *testing.T) {
	m := newMapper()
	idx := 0
	toolChunk := func(name, args string) *bifrost.ChatChunk {
		return &bifrost.ChatChunk{Choices: []bifrost.ChunkChoice{{
			Index: 0,
			Delta: bifrost.Delta{ToolCalls: []bifrost.ToolCallDelta{{
				Index:    &idx,
				ID:       "tcall_1",
				Type:     "function",
				Function: &bifrost.FunctionDelta{Name: name, Arguments: args},
			}}},
		}}}
	}

	var got []string
	got = append(got, types(m.MapChunk(toolChunk("read_excel", "")))...)
	got = append(got, types(m.MapChunk(toolChunk("", `{"path":"`)))...)
	got = append(got, types(m.MapChunk(toolChunk("", `"/sales.xlsx"}`)))...)
	got = append(got, types(m.Finish("tool_calls"))...)

	want := []string{
		streaming.EventTextMessageStart, // tool calls imply the assistant message
		streaming.EventToolCallStart,
		streaming.EventToolCallArgs,
		streaming.EventToolCallArgs,
		streaming.EventTextMessageEnd,
		streaming.EventToolCallEnd,
		streaming.EventModelCallFinished,
		streaming.EventRunFinished,
	}
	if len(got) != len(want) {
		t.Fatalf("tool lifecycle: %v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("tool[%d]=%s want %s", i, got[i], want[i])
		}
	}
}

func TestMapperMultipleToolCalls(t *testing.T) {
	m := newMapper()
	i0, i1 := 0, 1
	c := &bifrost.ChatChunk{Choices: []bifrost.ChunkChoice{{Index: 0, Delta: bifrost.Delta{
		ToolCalls: []bifrost.ToolCallDelta{
			{Index: &i0, ID: "tc_a", Type: "function", Function: &bifrost.FunctionDelta{Name: "a"}},
			{Index: &i1, ID: "tc_b", Type: "function", Function: &bifrost.FunctionDelta{Name: "b"}},
		},
	}}}}
	envs := m.MapChunk(c)
	starts := 0
	for _, e := range envs {
		if e.Type == streaming.EventToolCallStart {
			starts++
		}
	}
	if starts != 2 {
		t.Fatalf("expected 2 TOOL_CALL_START, got %d", starts)
	}
	fin := m.Finish("tool_calls")
	ends := 0
	for _, e := range fin {
		if e.Type == streaming.EventToolCallEnd {
			ends++
		}
	}
	if ends != 2 {
		t.Fatalf("expected 2 TOOL_CALL_END, got %d", ends)
	}
}

func TestMapperUsageOnFinalChunk(t *testing.T) {
	m := newMapper()
	m.MapChunk(chunk(bifrost.Delta{Content: "x"}))

	final := chunk(bifrost.Delta{})
	final.Usage = &bifrost.Usage{
		PromptTokens:        100,
		CompletionTokens:    50,
		TotalTokens:         150,
		PromptTokensDetails: &bifrost.PromptTokensDetails{CachedReadTokens: 20},
		CompletionDetails:   &bifrost.CompletionTokensDetails{ReasoningTokens: 10},
		Cost:                &bifrost.Cost{InputTokensCost: 0.001, OutputTokensCost: 0.002, TotalCost: 0.003},
	}
	m.MapChunk(final)
	envs := m.Finish("stop")

	var usageEnv *streaming.Envelope
	for _, e := range envs {
		if e.Type == streaming.EventUsageUpdate {
			usageEnv = e
		}
	}
	if usageEnv == nil {
		t.Fatal("USAGE_UPDATE must be emitted")
	}
	var ud streaming.RunUsageData
	if err := decodeData(usageEnv, &ud); err != nil {
		t.Fatalf("usage data: %v", err)
	}
	// NexAU semantics: input excludes cache reads.
	if ud.InputTokens != 80 {
		t.Errorf("input_tokens: %d (want 80 = 100 prompt − 20 cache read)", ud.InputTokens)
	}
	if ud.CacheReadTokens != 20 {
		t.Errorf("cache_read: %d", ud.CacheReadTokens)
	}
	if ud.OutputTokens != 50 || ud.ReasoningTokens != 10 {
		t.Errorf("output/reasoning: %d/%d", ud.OutputTokens, ud.ReasoningTokens)
	}
	if ud.TotalTokens != 150 {
		t.Errorf("total: %d", ud.TotalTokens)
	}

	out := m.Outcome()
	if out.Usage == nil || out.Usage.TotalTokens != 150 {
		t.Fatal("Outcome must carry usage")
	}
}

func TestNormalizeUsageFloors(t *testing.T) {
	u := NormalizeUsage(&bifrost.Usage{
		PromptTokens:        10,
		PromptTokensDetails: &bifrost.PromptTokensDetails{CachedReadTokens: 20}, // inconsistent upstream
	})
	if u.InputTokens < 0 {
		t.Fatal("input must floor at zero")
	}
	if NormalizeUsage(nil) != nil {
		t.Fatal("nil usage stays nil")
	}
}

func TestMapperErrorClosesLifecycles(t *testing.T) {
	m := newMapper()
	m.MapChunk(chunk(bifrost.Delta{Content: "partial"}))
	envs := m.FinishError("MODEL_TIMEOUT", "The model request timed out.")
	var sawTextEnd, sawRunError bool
	for _, e := range envs {
		if e.Type == streaming.EventTextMessageEnd {
			sawTextEnd = true
		}
		if e.Type == streaming.EventRunError {
			sawRunError = true
		}
	}
	if !sawTextEnd || !sawRunError {
		t.Fatalf("error finish must close text and emit RUN_ERROR: %v", types(envs))
	}
	// Idempotence.
	if again := m.FinishError("X", "y"); len(again) != 1 {
		t.Fatalf("second FinishError must only re-emit RUN_ERROR: %v", types(again))
	}
}

func TestMapperFinishIdempotent(t *testing.T) {
	m := newMapper()
	m.MapChunk(chunk(bifrost.Delta{Content: "x"}))
	first := m.Finish("stop")
	if second := m.Finish("stop"); len(second) != 0 {
		t.Fatalf("Finish must be idempotent: %v", types(second))
	}
	_ = first
}

func TestMapperDropsNonFirstChoices(t *testing.T) {
	m := newMapper()
	c := &bifrost.ChatChunk{Choices: []bifrost.ChunkChoice{
		{Index: 0, Delta: bifrost.Delta{Content: "first"}},
		{Index: 1, Delta: bifrost.Delta{Content: "second"}},
	}}
	envs := m.MapChunk(c)
	var contents []string
	for _, e := range envs {
		if e.Type == streaming.EventTextMessageContent {
			var d streaming.TextMessageContentData
			_ = decodeData(e, &d)
			contents = append(contents, d.Delta)
		}
	}
	if len(contents) != 1 || contents[0] != "first" {
		t.Fatalf("non-first choices must drop: %v", contents)
	}
}

func TestMapperCapturesModelAndProvider(t *testing.T) {
	m := newMapper()
	c := chunk(bifrost.Delta{Content: "x"})
	c.ExtraFields = &bifrost.ExtraFields{Provider: "anthropic", ModelDeployment: "claude-sonnet-4-5", Latency: 123}
	m.MapChunk(c)
	m.Finish("stop")
	out := m.Outcome()
	if out.Provider != "anthropic" || out.Model != "claude-sonnet-4-5" || out.LatencyMS != 123 {
		t.Fatalf("outcome: %+v", out)
	}
}

func TestStartAndCancelEnvelopes(t *testing.T) {
	m := newMapper()
	s := m.StartEnvelope()
	if s.Type != streaming.EventRunStarted {
		t.Fatalf("start: %s", s.Type)
	}
	var d streaming.RunStartedData
	if err := decodeData(s, &d); err != nil || d.ThreadID != "sess_1" || d.Model != "openai/gpt-4o" {
		t.Fatalf("start data: %+v err=%v", d, err)
	}
	c := m.CancelEnvelope("usr_1")
	if c.Type != streaming.EventRunCancelled {
		t.Fatalf("cancel: %s", c.Type)
	}
}

func decodeData(e *streaming.Envelope, v any) error {
	return jsonUnmarshal(e.Data, v)
}

func jsonUnmarshal(b []byte, v any) error { return json.Unmarshal(b, v) }
