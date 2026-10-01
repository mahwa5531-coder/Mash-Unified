package agent

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/nexau-cloud/nexau-api/internal/domain"
)

func lim() Limits { return Limits{MaxMessages: 4, MaxTools: 2, MaxModelLen: 64} }

func buildReq(t *testing.T, body string) *RunRequest {
	t.Helper()
	r := &RunRequest{}
	if err := json.Unmarshal([]byte(body), r); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return r
}

func TestValidateMinimalRequest(t *testing.T) {
	r := buildReq(t, `{"model":"openai/gpt-4o","messages":[{"role":"user","content":"hi"}]}`)
	if de := r.Validate(lim()); de != nil {
		t.Fatalf("minimal request must pass: %v", de)
	}
}

func TestValidateModelShape(t *testing.T) {
	cases := []string{
		`{"model":"","messages":[{"role":"user","content":"x"}]}`,
		`{"model":"gpt-4o","messages":[{"role":"user","content":"x"}]}`,
		`{"model":"/gpt-4o","messages":[{"role":"user","content":"x"}]}`,
		`{"model":"openai/","messages":[{"role":"user","content":"x"}]}`,
		`{"model":"openai/` + strings.Repeat("a", 80) + `","messages":[{"role":"user","content":"x"}]}`,
		`{"model":"openai/mo del","messages":[{"role":"user","content":"x"}]}`,
	}
	for _, body := range cases {
		r := buildReq(t, body)
		if de := r.Validate(lim()); de == nil {
			t.Errorf("model %q must fail", extractModel(t, body))
		}
	}
}

func TestValidateMessages(t *testing.T) {
	// empty messages
	if de := (&RunRequest{Model: "openai/gpt-4o"}).Validate(lim()); de == nil {
		t.Error("empty messages must fail")
	}
	// too many messages (limit 4)
	r := buildReq(t, `{"model":"openai/gpt-4o","messages":[
                {"role":"user","content":"1"},{"role":"user","content":"2"},
                {"role":"user","content":"3"},{"role":"user","content":"4"},
                {"role":"user","content":"5"}]}`)
	if de := r.Validate(lim()); de == nil {
		t.Error("message count limit must be enforced")
	}
	// invalid role
	r = buildReq(t, `{"model":"openai/gpt-4o","messages":[{"role":"root","content":"x"}]}`)
	if de := r.Validate(lim()); de == nil {
		t.Error("invalid role must fail")
	}
	// tool message without tool_call_id
	r = buildReq(t, `{"model":"openai/gpt-4o","messages":[{"role":"tool","content":"x"}]}`)
	if de := r.Validate(lim()); de == nil {
		t.Error("tool message without tool_call_id must fail")
	}
	// content block array
	r = buildReq(t, `{"model":"openai/gpt-4o","messages":[{"role":"user","content":[{"type":"text","text":"hi"}]}]}`)
	if de := r.Validate(lim()); de != nil {
		t.Errorf("content block array must pass: %v", de)
	}
	// unsupported block type
	r = buildReq(t, `{"model":"openai/gpt-4o","messages":[{"role":"user","content":[{"type":"video","url":"x"}]}]}`)
	if de := r.Validate(lim()); de == nil {
		t.Error("unsupported content block must fail")
	}
	// tool role with block content
	r = buildReq(t, `{"model":"openai/gpt-4o","messages":[{"role":"tool","tool_call_id":"t1","content":[{"type":"text","text":"x"}]}]}`)
	if de := r.Validate(lim()); de == nil {
		t.Error("tool content must be a string")
	}
}

func TestValidateParams(t *testing.T) {
	base := `{"model":"openai/gpt-4o","messages":[{"role":"user","content":"x"}],`
	cases := []string{
		base + `"temperature":2.5}`,
		base + `"temperature":-0.1}`,
		base + `"top_p":1.5}`,
		base + `"frequency_penalty":3}`,
		base + `"presence_penalty":-3}`,
		base + `"max_tokens":0}`,
		base + `"top_logprobs":21}`,
		base + `"reasoning_effort":"ultra"}`,
		base + `"stop":["a","b","c","d","e"]}`,
		base + `"tool_choice":"sometimes"}`,
		base + `"response_format":{"type":"yaml"}}`,
	}
	for _, body := range cases {
		r := buildReq(t, body)
		if de := r.Validate(lim()); de == nil {
			t.Errorf("param validation must fail for %s", body[len(base):])
		}
	}
	// Valid forms.
	valid := []string{
		base + `"temperature":0.7}`,
		base + `"temperature":2}`,
		base + `"reasoning_effort":"high"}`,
		base + `"stop":"END"}`,
		base + `"tool_choice":{"type":"function","function":{"name":"read_excel"}}}`,
		base + `"response_format":{"type":"json_object"}}`,
	}
	for _, body := range valid {
		r := buildReq(t, body)
		if de := r.Validate(lim()); de != nil {
			t.Errorf("valid param set failed: %v (%s)", de, body[len(base):])
		}
	}
}

func TestValidateTools(t *testing.T) {
	base := `{"model":"openai/gpt-4o","messages":[{"role":"user","content":"x"}],`
	if de := buildReq(t, base+`"tools":[{"type":"function","function":{"name":"","parameters":{}}}]}`).Validate(lim()); de == nil {
		t.Error("empty tool name must fail")
	}
	if de := buildReq(t, base+`"tools":[{"type":"function","function":{"name":"bad name!"}}]}`).Validate(lim()); de == nil {
		t.Error("invalid tool name must fail")
	}
	if de := buildReq(t, base+`"tools":[{"type":"custom"}]}`).Validate(lim()); de == nil {
		t.Error("non-function tool type must fail")
	}
	// tool count limit (2)
	three := `"tools":[` + strings.Repeat(`{"type":"function","function":{"name":"t"}},`, 2) + `{"type":"function","function":{"name":"t"}}]}`
	if de := buildReq(t, base+three).Validate(lim()); de == nil {
		t.Error("tool count limit must be enforced")
	}
}

func TestValidateCorrelationIDs(t *testing.T) {
	base := `{"model":"openai/gpt-4o","messages":[{"role":"user","content":"x"}],`
	if de := buildReq(t, base+`"turn_id":"turn 1"}`).Validate(lim()); de == nil {
		t.Error("turn_id with space must fail")
	}
	if de := buildReq(t, base+`"idempotency_key":"key@1"}`).Validate(lim()); de == nil {
		t.Error("idempotency_key with bad charset must fail")
	}
	if de := buildReq(t, base+`"turn_id":"turn_1","idempotency_key":"abc-123"}`).Validate(lim()); de != nil {
		t.Errorf("valid correlation ids must pass: %v", de)
	}
}

func TestModelAllowedPatterns(t *testing.T) {
	cases := []struct {
		allow []string
		model string
		want  bool
	}{
		{nil, "openai/gpt-4o", true},
		{[]string{"openai/gpt-4o"}, "openai/gpt-4o", true},
		{[]string{"openai/gpt-4o"}, "openai/gpt-4o-mini", false},
		{[]string{"openai/*"}, "openai/gpt-4o", true},
		{[]string{"openai/*"}, "anthropic/claude-3", false},
		{[]string{"openai/gpt-4o", "anthropic/*"}, "anthropic/claude-3", true},
	}
	for _, c := range cases {
		if got := modelAllowed(c.allow, c.model); got != c.want {
			t.Errorf("modelAllowed(%v, %q)=%v want %v", c.allow, c.model, got, c.want)
		}
	}
}

func TestRunRequestExtrasRoundTrip(t *testing.T) {
	body := `{"model":"openai/gpt-4o","messages":[{"role":"user","content":"x"}],"vendor_beta_feature":{"k":1}}`
	r := buildReq(t, body)
	if _, ok := r.Extras["vendor_beta_feature"]; !ok {
		t.Fatal("unknown key must land in Extras")
	}
	out, err := json.Marshal(r)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if !strings.Contains(string(out), "vendor_beta_feature") {
		t.Fatal("Extras must round-trip")
	}
	// ToBifrost forwards extras.
	breq := r.ToBifrost()
	if _, ok := breq.Extras["vendor_beta_feature"]; !ok {
		t.Fatal("ToBifrost must carry Extras")
	}
}

func TestStreamOptionsForcedForMetering(t *testing.T) {
	r := buildReq(t, `{"model":"openai/gpt-4o","messages":[{"role":"user","content":"x"}],"stream":true}`)
	b := r.ToBifrost()
	if b.StreamOptions == nil || !b.StreamOptions.IncludeUsage {
		t.Fatal("streaming requests must force include_usage (authoritative metering)")
	}
}

func TestFingerprintStableAcrossTransportNoise(t *testing.T) {
	a := buildReq(t, `{"model":"openai/gpt-4o","messages":[{"role":"user","content":"x"}],"turn_id":"t1","stream":true}`)
	b := buildReq(t, `{"model":"openai/gpt-4o","messages":[{"role":"user","content":"x"}],"turn_id":"t2","stream":false}`)
	if a.fingerprint() != b.fingerprint() {
		t.Fatal("fingerprint must ignore turn_id/stream")
	}
	c := buildReq(t, `{"model":"openai/gpt-4o","messages":[{"role":"user","content":"DIFFERENT"}]}`)
	if a.fingerprint() == c.fingerprint() {
		t.Fatal("fingerprint must change with billable content")
	}
}

func TestDomainErrorMapping(t *testing.T) {
	if domain.ErrRateLimited(1000, "x").HTTP != 429 {
		t.Fatal("rate limit maps to 429")
	}
	if domain.ErrCancelled.HTTP != 499 {
		t.Fatal("cancelled maps to 499")
	}
	de := domain.ErrModelNotEntitled("m")
	if de.Details["model"] != "m" {
		t.Fatal("model detail must ride along")
	}
}

func extractModel(t *testing.T, body string) string {
	t.Helper()
	var probe struct {
		Model string `json:"model"`
	}
	_ = json.Unmarshal([]byte(body), &probe)
	return probe.Model
}
