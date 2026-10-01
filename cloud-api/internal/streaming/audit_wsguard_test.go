// 2026-09-19 security audit, cluster B — WS connections outliving their
// credential. Regression tests for the heartbeat auth guard.
//
// The audit finding: a WebSocket authenticated once at upgrade and never
// re-checked kept working for hours after logout/revocation (and past the
// access token's own expiry). The fix: an injectable guard runs on every
// heartbeat tick in the write pump; failure closes the socket with 1008
// POLICY_VIOLATION.
package streaming

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

type noopHandler struct{}

func (noopHandler) HandleMessage(context.Context, *Connection, ClientMessage) {}

// TestAudit_AuthGuardProbeSemantics: nil guard = old behavior (always ok);
// installed guard's error propagates; a panic-free nil return is a pass.
func TestAudit_AuthGuardProbeSemantics(t *testing.T) {
	c := &Connection{send: make(chan []byte, 1), closeCh: make(chan struct{})}

	if err := c.runAuthGuard(); err != nil {
		t.Fatalf("nil guard must allow: %v", err)
	}

	probe := errors.New("token revoked")
	c.SetAuthGuard(func() error { return probe })
	if err := c.runAuthGuard(); !errors.Is(err, probe) {
		t.Fatalf("guard error must propagate, got %v", err)
	}

	c.SetAuthGuard(func() error { return nil })
	if err := c.runAuthGuard(); err != nil {
		t.Fatalf("healthy guard must allow: %v", err)
	}

	c.SetAuthGuard(nil)
	if err := c.runAuthGuard(); err != nil {
		t.Fatalf("guard removal must restore old behavior: %v", err)
	}
}

// TestAudit_WritePumpClosesConnectionOnGuardFailure: the full loop — a live
// WS pair, the guard starts failing after the first heartbeat, and the CLIENT
// observes close code 1008 (policy violation) on the wire.
func TestAudit_WritePumpClosesConnectionOnGuardFailure(t *testing.T) {
	u := NewUpgrader(WSConfig{
		HeartbeatInterval: 20 * time.Millisecond,
		WriteWait:         time.Second,
		MaxMessageSize:    1 << 16,
		SendQueue:         8,
		IdleTimeout:       10 * time.Second,
	}, nil, nil)

	conns := make(chan *Connection, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := u.Upgrade(w, r, "ten_1", "usr_1", "sess_1")
		if err != nil {
			return
		}
		conns <- c
		c.Serve(context.Background(), noopHandler{})
	}))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	cl, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer cl.Close()

	var conn *Connection
	select {
	case conn = <-conns:
	case <-time.After(3 * time.Second):
		t.Fatal("server never completed the upgrade")
	}

	// Let at least one healthy heartbeat tick pass (guard nil → ping ok),
	// then install the failing guard — the client's token "was revoked".
	time.Sleep(60 * time.Millisecond)
	conn.SetAuthGuard(func() error { return errors.New("token revoked") })

	// The client must observe the close frame 1008 shortly. (Pings are
	// consumed transparently by gorilla's control-frame path and never
	// surface from ReadMessage — the close itself is the evidence that a
	// heartbeat tick ran the guard.)
	cl.SetReadDeadline(time.Now().Add(3 * time.Second))
	for {
		_, _, err := cl.ReadMessage()
		if err != nil {
			ce, ok := err.(*websocket.CloseError)
			if !ok {
				t.Fatalf("expected close error, got: %v", err)
			}
			if ce.Code != websocket.ClosePolicyViolation {
				t.Fatalf("close code = %d, want 1008 (policy violation)", ce.Code)
			}
			return
		}
	}
}
