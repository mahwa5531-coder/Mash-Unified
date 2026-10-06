package tests

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestMashModelsEndpoint(t *testing.T) {
	h := newHarness(t)
	req, _ := http.NewRequest(http.MethodGet, h.srv.URL+"/v1/models", nil)
	req.Header.Set("Authorization", "Bearer "+h.token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /v1/models: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	var body struct {
		Object string `json:"object"`
		Data   []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode models: %v", err)
	}
	if body.Object != "list" || len(body.Data) == 0 {
		t.Fatalf("unexpected models response: %+v", body)
	}
	foundMashAgent := false
	for _, m := range body.Data {
		if m.ID == "mash-agent" {
			foundMashAgent = true
			break
		}
	}
	if !foundMashAgent {
		t.Errorf("mash-agent not found in models: %+v", body.Data)
	}
}

func TestMashResponsesInferenceStreaming(t *testing.T) {
	h := newHarness(t)
	h.bifrost.script = []scriptChunk{
		{data: `{"id":"c1","choices":[{"index":0,"delta":{"content":"Auditor report"}}]}`, delay: 5 * time.Millisecond},
		{data: `{"id":"c2","choices":[{"index":0,"delta":{"content":" verified."}}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}`, delay: 5 * time.Millisecond},
		{data: "[DONE]"},
	}

	payload := `{"model":"mash-agent","stream":true,"messages":[{"role":"user","content":"Verify ledger."}]}`
	req, err := http.NewRequest(http.MethodPost, h.srv.URL+"/v1/responses", strings.NewReader(payload))
	if err != nil {
		t.Fatalf("request create: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+h.token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST /v1/responses: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, string(b))
	}
	lines := readRawSSE(t, resp, 2*time.Second)
	if len(lines) == 0 {
		t.Fatalf("expected streamed lines, got none")
	}
	if lines[len(lines)-1] != "[DONE]" {
		t.Errorf("expected final line [DONE], got %q", lines[len(lines)-1])
	}
}

func TestMashMePlanAndUsage(t *testing.T) {
	h := newHarness(t)

	// Test GET /v1/me/plan
	req, _ := http.NewRequest(http.MethodGet, h.srv.URL+"/v1/me/plan", nil)
	req.Header.Set("Authorization", "Bearer "+h.token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /v1/me/plan: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	// Test GET /v1/me/usage
	req2, _ := http.NewRequest(http.MethodGet, h.srv.URL+"/v1/me/usage", nil)
	req2.Header.Set("Authorization", "Bearer "+h.token)
	resp2, err := http.DefaultClient.Do(req2)
	if err != nil {
		t.Fatalf("GET /v1/me/usage: %v", err)
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp2.StatusCode)
	}

	// Test GET /v1/client/config
	req3, _ := http.NewRequest(http.MethodGet, h.srv.URL+"/v1/client/config", nil)
	req3.Header.Set("Authorization", "Bearer "+h.token)
	resp3, err := http.DefaultClient.Do(req3)
	if err != nil {
		t.Fatalf("GET /v1/client/config: %v", err)
	}
	defer resp3.Body.Close()
	if resp3.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp3.StatusCode)
	}
}

func TestMashAuthSessionAndLogoutAll(t *testing.T) {
	h := newHarness(t)

	// Test GET /v1/auth/session
	req, _ := http.NewRequest(http.MethodGet, h.srv.URL+"/v1/auth/session", nil)
	req.Header.Set("Authorization", "Bearer "+h.token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /v1/auth/session: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	var sessionData struct {
		Authenticated bool   `json:"authenticated"`
		UserID        string `json:"user_id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&sessionData); err != nil {
		t.Fatalf("decode session: %v", err)
	}
	if !sessionData.Authenticated || sessionData.UserID != "usr_1" {
		t.Fatalf("unexpected session data: %+v", sessionData)
	}

	// Test POST /v1/auth/logout-all
	req2, _ := http.NewRequest(http.MethodPost, h.srv.URL+"/v1/auth/logout-all", nil)
	req2.Header.Set("Authorization", "Bearer "+h.token)
	resp2, err := http.DefaultClient.Do(req2)
	if err != nil {
		t.Fatalf("POST /v1/auth/logout-all: %v", err)
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp2.StatusCode)
	}
}
