package agent

import (
	"encoding/json"
	"testing"
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
