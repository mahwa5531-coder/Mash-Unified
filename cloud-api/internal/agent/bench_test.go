package agent

import (
	"encoding/json"
	"testing"

	"github.com/nexau-cloud/nexau-api/internal/bifrost"
	"github.com/nexau-cloud/nexau-api/internal/streaming"
)

// BenchmarkValidate measures the per-request validation cost (target: single
// digit microseconds — it runs before every upstream call).
func BenchmarkValidate(b *testing.B) {
	body := `{"model":"openai/gpt-4o","messages":[{"role":"system","content":"You are NexAU."},{"role":"user","content":"Analyze this spreadsheet: ` + repeat("sales,region,quarter ", 40) + `"}],"tools":[{"type":"function","function":{"name":"read_excel","parameters":{"type":"object","properties":{"path":{"type":"string"}}}}}],"temperature":0.7,"max_tokens":4096}`
	lim := Limits{MaxMessages: 256, MaxTools: 128, MaxModelLen: 256}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req := &RunRequest{}
		_ = json.Unmarshal([]byte(body), req)
		if de := req.Validate(lim); de != nil {
			b.Fatal(de)
		}
	}
}

// BenchmarkMapChunk measures the hot-path chunk→event mapping (runs once per
// upstream SSE chunk — the latency floor between Bifrost and the desktop).
func BenchmarkMapChunk(b *testing.B) {
	m := NewMapper("run_bench", "sess_bench", "sess_bench", "turn_bench", "openai/gpt-4o")
	chunk := &bifrost.ChatChunk{
		ID: "cmpl_1", Model: "openai/gpt-4o",
		Choices: []bifrost.ChunkChoice{{Index: 0, Delta: bifrost.Delta{Content: "Revenue is up 12% quarter over quarter"}}},
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = m.MapChunk(chunk)
	}
}

// BenchmarkMapToolChunk measures tool-call fragment mapping.
func BenchmarkMapToolChunk(b *testing.B) {
	idx := 0
	chunk := &bifrost.ChatChunk{Choices: []bifrost.ChunkChoice{{
		Index: 0,
		Delta: bifrost.Delta{
			ToolCalls: []bifrost.ToolCallDelta{{
				Index:    &idx,
				ID:       "tc_1",
				Type:     "function",
				Function: &bifrost.FunctionDelta{Arguments: `{"path":"/sales/Q3.xlsx"}`},
			}},
		},
	}}}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		m := NewMapper("run_bench", "sess_bench", "sess_bench", "", "openai/gpt-4o")
		_ = m.MapChunk(chunk)
	}
}

// BenchmarkEnvelopeMarshal measures event serialization (once per event).
func BenchmarkEnvelopeMarshal(b *testing.B) {
	env := streaming.NewEnvelope("sess_bench", "run_bench", streaming.EventTextMessageContent,
		streaming.TextMessageContentData{MessageID: "msg_bench", Delta: "Revenue is up"})
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = env.Marshal()
	}
}

// BenchmarkFingerprint measures the idempotency hash input construction.
func BenchmarkFingerprint(b *testing.B) {
	r := &RunRequest{}
	_ = json.Unmarshal([]byte(`{"model":"openai/gpt-4o","messages":[{"role":"user","content":"x"}]}`), r)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = r.fingerprint()
	}
}

func repeat(s string, n int) string {
	out := make([]byte, 0, len(s)*n)
	for i := 0; i < n; i++ {
		out = append(out, s...)
	}
	return string(out)
}
