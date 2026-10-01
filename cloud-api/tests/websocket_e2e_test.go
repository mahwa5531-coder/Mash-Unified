package tests

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/nexau-cloud/nexau-api/internal/domain"
	"github.com/nexau-cloud/nexau-api/internal/streaming"
)

// dialWS opens the session WebSocket with the auth header.
func dialWS(t *testing.T, h *harness, sessionID string) *websocket.Conn {
	t.Helper()
	url := "ws" + strings.TrimPrefix(h.srv.URL, "http") + "/v1/agent/sessions/" + sessionID + "/stream"
	dialer := &websocket.Dialer{HandshakeTimeout: 5 * time.Second}
	conn, resp, err := dialer.Dial(url, map[string][]string{
		"Authorization": {"Bearer " + h.token},
	})
	if err != nil {
		status := 0
		if resp != nil {
			status = resp.StatusCode
		}
		t.Fatalf("ws dial: %v (status %d)", err, status)
	}
	t.Cleanup(func() { _ = conn.Close() })
	return conn
}

type wsFrame struct {
	Type         string          `json:"type"`
	RunID        string          `json:"run_id,omitempty"`
	LastSequence int64           `json:"last_sequence,omitempty"`
	Request      json.RawMessage `json:"request,omitempty"`
}

// readEvents collects events until the stop type, the deadline, or a control
// frame of interest.
func readWSEvents(t *testing.T, conn *websocket.Conn, stopOn string, maxWait time.Duration) ([]streaming.Envelope, []map[string]any) {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(maxWait))
	var events []streaming.Envelope
	var controls []map[string]any
	deadline := time.Now().Add(maxWait)
	for time.Now().Before(deadline) {
		_, data, err := conn.ReadMessage()
		if err != nil {
			return events, controls
		}
		var probe map[string]any
		if json.Unmarshal(data, &probe) == nil {
			if typ, _ := probe["type"].(string); typ != "" && !isEnvelopeType(typ) {
				controls = append(controls, probe)
				continue
			}
		}
		env, err := streaming.DecodeEnvelope(data)
		if err != nil {
			continue
		}
		events = append(events, *env)
		if stopOn != "" && env.Type == stopOn {
			return events, controls
		}
	}
	return events, controls
}

func isEnvelopeType(typ string) bool {
	switch typ {
	case "error", "pong", "run.replay", "run.cancel.ok", "RESUME_OK", "RESUME_MISSED":
		return false
	}
	return true
}

// TestWSEndToEnd: run.create over the persistent connection → AG-UI events
// delivered over the same connection → run.cancel stops the run.
func TestWSEndToEnd(t *testing.T) {
	h := newHarness(t)
	h.bifrost.setScript(standardScript()...)
	sess := h.createSession()

	conn := dialWS(t, h, sess)

	req := map[string]any{
		"type": "run.create",
		"request": map[string]any{
			"model":    "openai/gpt-4o",
			"messages": []map[string]any{{"role": "user", "content": "Analyze"}},
		},
	}
	if err := conn.WriteJSON(req); err != nil {
		t.Fatalf("run.create: %v", err)
	}

	events, _ := readWSEvents(t, conn, streaming.EventRunFinished, 10*time.Second)
	if len(events) < 8 {
		t.Fatalf("expected full lifecycle over WS, got %d", len(events))
	}
	if events[0].Type != streaming.EventRunStarted {
		t.Fatalf("first event: %s", events[0].Type)
	}
	// Sequences arrive monotonic.
	for i := 1; i < len(events); i++ {
		if events[i].Sequence != events[i-1].Sequence+1 {
			t.Fatalf("sequence gap: %d → %d", events[i-1].Sequence, events[i].Sequence)
		}
	}
	runID := events[0].RunID

	waitFor(t, 3*time.Second, func() bool {
		r := h.runs.get(runID)
		return r != nil && r.Terminal()
	})
	run := h.runs.get(runID)
	if run == nil || run.Status != domain.RunCompleted {
		t.Fatalf("run status: %+v", run)
	}
}

// TestWSRunCancelFromSameConnection: run.cancel over WS cancels the active run.
func TestWSRunCancelFromSameConnection(t *testing.T) {
	h := newHarness(t)
	h.bifrost.setScript(
		scriptChunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","content":"a"}}]}`, delay: 50 * time.Millisecond},
		scriptChunk{data: `{"id":"c1","choices":[{"index":0,"delta":{"content":"b"}}]}`, delay: 10 * time.Minute},
	)
	sess := h.createSession()
	conn := dialWS(t, h, sess)

	if err := conn.WriteJSON(map[string]any{
		"type": "run.create",
		"request": map[string]any{
			"model":    "openai/gpt-4o",
			"messages": []map[string]any{{"role": "user", "content": "x"}},
		},
	}); err != nil {
		t.Fatalf("run.create: %v", err)
	}

	events, _ := readWSEvents(t, conn, streaming.EventTextMessageContent, 5*time.Second)
	if len(events) == 0 {
		t.Fatal("no events over WS")
	}
	runID := events[0].RunID

	// Cancel over the same connection.
	if err := conn.WriteJSON(wsFrame{Type: "run.cancel", RunID: runID}); err != nil {
		t.Fatalf("run.cancel: %v", err)
	}

	// A control ack arrives.
	_, controls := readWSEvents(t, conn, "", 3*time.Second)
	foundAck := false
	for _, c := range controls {
		if c["type"] == "run.cancel.ok" {
			foundAck = true
		}
	}
	if !foundAck {
		t.Fatalf("run.cancel.ok control frame missing: %v", controls)
	}

	waitFor(t, 3*time.Second, h.bifrost.wasCanceled)
	if !h.bifrost.wasCanceled() {
		t.Fatal("WS cancel must propagate upstream")
	}

	waitFor(t, 3*time.Second, func() bool {
		r := h.runs.get(runID)
		return r != nil && r.Terminal()
	})
	run := h.runs.get(runID)
	if run == nil || run.Status != domain.RunCancelled {
		t.Fatalf("run status after WS cancel: %+v", run)
	}
}

// TestWSRejectsMalformedFrames: protocol violations get clean error frames,
// the connection survives.
func TestWSRejectsMalformedFrames(t *testing.T) {
	h := newHarness(t)
	sess := h.createSession()
	conn := dialWS(t, h, sess)

	if err := conn.WriteMessage(websocket.TextMessage, []byte(`{not json`)); err != nil {
		t.Fatalf("write garbage: %v", err)
	}
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	_, data, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("expected error frame, got: %v", err)
	}
	var probe map[string]any
	if json.Unmarshal(data, &probe) != nil || probe["type"] != "error" {
		t.Fatalf("error frame: %s", data)
	}
	if probe["code"] != "INVALID_FRAME" {
		t.Fatalf("error code: %v", probe["code"])
	}

	// Connection still usable: ping/pong.
	if err := conn.WriteJSON(wsFrame{Type: "ping"}); err != nil {
		t.Fatalf("ping: %v", err)
	}
	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	_, data, err = conn.ReadMessage()
	if err != nil {
		t.Fatalf("pong: %v", err)
	}
	if probe["type"] = ""; json.Unmarshal(data, &probe) != nil || probe["type"] != "pong" {
		t.Fatalf("pong frame: %s", data)
	}
}

// TestWSForeignSession: tenant isolation on the upgrade path.
func TestWSForeignSession(t *testing.T) {
	h := newHarness(t)
	foreign := h.createForeignSession()

	url := "ws" + strings.TrimPrefix(h.srv.URL, "http") + "/v1/agent/sessions/" + foreign + "/stream"
	dialer := &websocket.Dialer{HandshakeTimeout: 5 * time.Second}
	_, resp, err := dialer.Dial(url, map[string][]string{
		"Authorization": {"Bearer " + h.token},
	})
	if err == nil {
		t.Fatal("foreign session upgrade must fail")
	}
	if resp == nil || resp.StatusCode != 404 {
		t.Fatalf("foreign session: status %v", resp)
	}
}

// TestWSResumeReplaysBuffer: after a run completes, a resume request on a
// fresh connection replays the buffered events after last_sequence.
func TestWSResumeReplaysBuffer(t *testing.T) {
	h := newHarness(t)
	h.bifrost.setScript(standardScript()...)
	sess := h.createSession()

	// Run 1 completes on a first connection.
	conn1 := dialWS(t, h, sess)
	if err := conn1.WriteJSON(map[string]any{
		"type": "run.create",
		"request": map[string]any{
			"model":    "openai/gpt-4o",
			"messages": []map[string]any{{"role": "user", "content": "x"}},
		},
	}); err != nil {
		t.Fatalf("run.create: %v", err)
	}
	events, _ := readWSEvents(t, conn1, streaming.EventRunFinished, 10*time.Second)
	if len(events) < 8 {
		t.Fatalf("run 1 events: %d", len(events))
	}
	runID := events[0].RunID
	_ = conn1.Close()

	// Reconnect and resume from the middle.
	conn2 := dialWS(t, h, sess)
	half := events[len(events)/2-1].Sequence
	if err := conn2.WriteJSON(wsFrame{Type: "resume", RunID: runID, LastSequence: half}); err != nil {
		t.Fatalf("resume: %v", err)
	}
	replayed, controls := readWSEvents(t, conn2, "", 5*time.Second)

	okFrame := false
	for _, c := range controls {
		if c["type"] == "RESUME_OK" {
			okFrame = true
		}
	}
	if !okFrame {
		t.Fatalf("RESUME_OK missing: %v", controls)
	}
	if len(replayed) != len(events)-len(events)/2+1-1 && len(replayed) == 0 {
		t.Fatalf("replay delivered nothing")
	}
	// Every replayed event is strictly after the resume point.
	for _, e := range replayed {
		if e.Sequence <= half {
			t.Fatalf("replayed stale event: %d ≤ %d", e.Sequence, half)
		}
	}
}
