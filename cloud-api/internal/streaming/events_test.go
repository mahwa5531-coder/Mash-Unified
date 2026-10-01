package streaming

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestEnvelopeRoundTrip(t *testing.T) {
	env := NewEnvelope("sess_1", "run_1", EventTextMessageContent,
		TextMessageContentData{MessageID: "msg_1", Delta: "Revenue"})
	env.Sequence = 42
	blob := env.Marshal()

	got, err := DecodeEnvelope(blob)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.EventID != env.EventID || got.RunID != "run_1" || got.Sequence != 42 ||
		got.Type != EventTextMessageContent || got.SessionID != "sess_1" {
		t.Fatalf("round-trip mismatch: %+v", got)
	}
	var d TextMessageContentData
	if err := json.Unmarshal(got.Data, &d); err != nil || d.Delta != "Revenue" || d.MessageID != "msg_1" {
		t.Fatalf("data mismatch: %+v err=%v", d, err)
	}
	if got.Timestamp.IsZero() {
		t.Fatal("timestamp must be set")
	}
}

func TestEnvelopeEventIDsUnique(t *testing.T) {
	a := NewEnvelope("s", "r", EventRunStarted, nil)
	b := NewEnvelope("s", "r", EventRunStarted, nil)
	if a.EventID == b.EventID {
		t.Fatal("event ids must be unique")
	}
}

func TestSSEWriterEvents(t *testing.T) {
	rec := httptest.NewRecorder()
	w, err := NewSSEWriter(rec, time.Second)
	if err != nil {
		t.Fatalf("NewSSEWriter: %v", err)
	}
	env := NewEnvelope("sess_1", "run_1", EventTextMessageContent, TextMessageContentData{MessageID: "m", Delta: "hi"})
	env.Sequence = 1
	if err := w.Event(env.Marshal()); err != nil {
		t.Fatalf("Event: %v", err)
	}
	if err := w.Comment("ping"); err != nil {
		t.Fatalf("Comment: %v", err)
	}
	w.Close()

	body := rec.Body.String()
	if !strings.Contains(body, "data: ") {
		t.Fatalf("body must carry SSE data frames: %q", body)
	}
	if !strings.Contains(body, `"type":"TEXT_MESSAGE_CONTENT"`) {
		t.Fatalf("body must carry the envelope: %q", body)
	}
	if !strings.Contains(body, ": ping") {
		t.Fatalf("body must carry the comment: %q", body)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "text/event-stream") {
		t.Fatalf("content type must be event-stream: %q", ct)
	}
	if !strings.Contains(body, "\n\n") {
		t.Fatal("frames must be newline-terminated")
	}
}

func TestSSEWriterConcurrentSafe(t *testing.T) {
	rec := httptest.NewRecorder()
	w, err := NewSSEWriter(rec, time.Second)
	if err != nil {
		t.Fatalf("NewSSEWriter: %v", err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			env := NewEnvelope("s", "r", EventUsageUpdate, nil)
			_ = w.Event(env.Marshal())
		}()
	}
	wg.Wait()
	w.Close()
}

func TestSSEWriterHeartbeatStops(t *testing.T) {
	rec := httptest.NewRecorder()
	w, err := NewSSEWriter(rec, time.Second)
	if err != nil {
		t.Fatalf("NewSSEWriter: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { w.Heartbeat(ctx, 10*time.Millisecond); close(done) }()
	time.Sleep(50 * time.Millisecond)
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("heartbeat must stop with its context")
	}
}
