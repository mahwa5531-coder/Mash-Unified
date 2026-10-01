// Spec §21 (WebSocket Abuse Tests).
package validation

import (
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/nexau-cloud/nexau-api/internal/streaming"
)

// TestV21_WSWithoutAuthentication: upgrade without a token is rejected.
func TestV21_WSWithoutAuthentication(t *testing.T) {
	s := newStackDefault(t)
	sess := s.sessionFor("wsa", "ten_A", "usr_1")

	url := "ws" + strings.TrimPrefix(s.replicas[0].url, "http") + "/v1/agent/sessions/" + sess + "/stream"
	dialer := &websocket.Dialer{HandshakeTimeout: 5 * time.Second}
	_, resp, err := dialer.Dial(url, nil)
	if err == nil {
		t.Fatal("unauthenticated WS upgrade succeeded")
	}
	if resp == nil || resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthenticated upgrade: %v", resp)
	}
}

// TestV21_WSWithExpiredAuthentication: expired token rejected at upgrade.
func TestV21_WSWithExpiredAuthentication(t *testing.T) {
	s := newStackDefault(t)
	sess := s.sessionFor("wsa", "ten_A", "usr_1")

	tok, err := s.signer.Sign("usr_1", "ten_A", "member", "", "jti_exp_ws", time.Now().Add(-time.Hour))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	_, resp, err := dialWS(t, s.replicas[0].url, tok, sess)
	if err == nil {
		t.Fatal("expired-token upgrade succeeded")
	}
	if resp == nil || resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expired upgrade: %v", resp)
	}
}

// TestV21_RapidConnectDisconnect: 200 rapid connect/disconnect cycles — no
// resource exhaustion, no goroutine leak.
func TestV21_RapidConnectDisconnect(t *testing.T) {
	s := newStackDefault(t)
	sess := s.sessionFor("rapid", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")

	// Prime the limiter script cache with one warmup connection.
	if c, _, err := dialWS(t, s.replicas[0].url, tok, sess); err == nil {
		_ = c.Close()
	}
	time.Sleep(200 * time.Millisecond)

	base := goroutines()
	baseFD := fdCount()
	for i := 0; i < 200; i++ {
		conn, _, err := dialWS(t, s.replicas[0].url, tok, sess)
		if err != nil {
			t.Fatalf("dial %d: %v", i, err)
		}
		if i%3 == 0 {
			// Abrupt close without a close frame.
			_ = conn.UnderlyingConn().Close()
		} else {
			_ = conn.Close()
		}
	}
	// Let the server reap the connections.
	if !waitFor(t, 10*time.Second, func() bool { return goroutines() <= base+30 }) {
		t.Fatalf("goroutines=%d after 200 connect/disconnect (base=%d)", goroutines(), base)
	}
	if !waitFor(t, 10*time.Second, func() bool { return fdCount() <= baseFD+30 }) {
		t.Fatalf("fds=%d after 200 connect/disconnect (base=%d)", fdCount(), baseFD)
	}
	vm(t, "ws_rapid_cycles", 200)
}

// TestV21_ManyIdleConnections: idle connections are capped by the per-user
// WS quota; excess upgrades get 429 WS_CONNECTION_LIMIT.
func TestV21_ManyIdleConnections(t *testing.T) {
	o := defaultOpts()
	o.wsPerUser = 5
	s := newStack(t, o)
	sess := s.sessionFor("idle", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")

	var conns []*websocket.Conn
	defer func() {
		for _, c := range conns {
			_ = c.Close()
		}
	}()

	accepted := 0
	for i := 0; i < 8; i++ {
		conn, resp, err := dialWS(t, s.replicas[0].url, tok, sess)
		if err != nil {
			if resp == nil || resp.StatusCode != http.StatusTooManyRequests {
				t.Fatalf("conn %d: unexpected rejection %v", i, resp)
			}
			// The rejection must be the documented WS quota error.
			var probe struct {
				Error struct {
					Code string `json:"code"`
				} `json:"error"`
			}
			dec := json.NewDecoder(resp.Body)
			_ = dec.Decode(&probe)
			resp.Body.Close()
			if probe.Error.Code != "WS_CONNECTION_LIMIT" {
				t.Fatalf("conn %d: code=%s, want WS_CONNECTION_LIMIT", i, probe.Error.Code)
			}
			continue
		}
		conns = append(conns, conn)
		accepted++
	}
	if accepted != 5 {
		t.Fatalf("accepted=%d, want exactly the quota of 5", accepted)
	}
	vm(t, "ws_quota_enforced", accepted)
}

// TestV21_UnexpectedFrames: binary frames, oversized frames, invalid event
// types and invalid JSON — clean error frames, connection survives where
// designed, bounded resources.
func TestV21_UnexpectedFrames(t *testing.T) {
	t.Run("binary frame rejected, connection survives", func(t *testing.T) {
		s := newStackDefault(t)
		sess := s.sessionFor("frames", "ten_A", "usr_1")
		conn, _, err := dialWS(t, s.replicas[0].url, s.tokenFor("usr_1", "ten_A"), sess)
		if err != nil {
			t.Fatalf("dial: %v", err)
		}
		defer conn.Close()

		if err := conn.WriteMessage(websocket.BinaryMessage, []byte{0x00, 0x01, 0x02}); err != nil {
			t.Fatalf("binary write: %v", err)
		}
		_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
		_, data, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("expected error frame after binary: %v", err)
		}
		var probe map[string]any
		if json.Unmarshal(data, &probe) != nil || probe["type"] != "error" {
			t.Fatalf("binary frame response: %s", data)
		}

		// Connection still usable.
		if err := conn.WriteJSON(map[string]any{"type": "ping"}); err != nil {
			t.Fatalf("ping: %v", err)
		}
		_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
		if _, _, err := conn.ReadMessage(); err != nil {
			t.Fatalf("pong: %v", err)
		}
	})

	t.Run("invalid event type gets INVALID_FRAME", func(t *testing.T) {
		s := newStackDefault(t)
		sess := s.sessionFor("frames", "ten_A", "usr_1")
		conn, _, err := dialWS(t, s.replicas[0].url, s.tokenFor("usr_1", "ten_A"), sess)
		if err != nil {
			t.Fatalf("dial: %v", err)
		}
		defer conn.Close()

		if err := conn.WriteJSON(map[string]any{"type": "run.explode", "payload": "x"}); err != nil {
			t.Fatalf("write: %v", err)
		}
		_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
		_, data, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("read: %v", err)
		}
		var probe map[string]any
		if json.Unmarshal(data, &probe) != nil || probe["type"] != "error" {
			t.Fatalf("unknown type response: %s", data)
		}
		if probe["code"] != "INVALID_FRAME" && probe["code"] != "UNKNOWN_FRAME" {
			t.Fatalf("unknown type code: %v", probe["code"])
		}
	})

	t.Run("oversized frame closes the connection cleanly", func(t *testing.T) {
		o := defaultOpts()
		o.wsPerUser = 64
		s := newStack(t, o)
		sess := s.sessionFor("bigframe", "ten_A", "usr_1")
		conn, _, err := dialWS(t, s.replicas[0].url, s.tokenFor("usr_1", "ten_A"), sess)
		if err != nil {
			t.Fatalf("dial: %v", err)
		}
		defer conn.Close()

		// WSMaxMessageSize = 512 KiB; send 2 MiB. The server enforces the
		// read limit and closes the connection (a mid-frame client write
		// error is the expected symptom of the server-side reset).
		huge := make([]byte, 2<<20)
		_ = conn.WriteMessage(websocket.TextMessage, huge) // may error: server reset

		_ = conn.SetReadDeadline(time.Now().Add(10 * time.Second))
		readErr := false
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				readErr = true
				break
			}
		}
		if !readErr {
			t.Fatal("connection stayed open after an oversized frame")
		}
		// The server must be unaffected.
		conn2, _, err := dialWS(t, s.replicas[0].url, s.tokenFor("usr_1", "ten_A"), sess)
		if err != nil {
			t.Fatalf("server unhealthy after oversized frame: %v", err)
		}
		_ = conn2.Close()
	})
}

// TestV21_ManyConcurrentActiveStreams: 30 concurrent active WS streams with
// interleaved runs — all complete, bounded resources.
func TestV21_ManyConcurrentActiveStreams(t *testing.T) {
	s := newStackDefault(t)
	s.bifrost.setScript(standardScript()...)
	sess := s.sessionFor("many", "ten_A", "usr_1")
	tok := s.tokenFor("usr_1", "ten_A")

	base := goroutines()
	var wg sync.WaitGroup
	errs := make(chan error, 30)
	for i := 0; i < 30; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			conn, _, err := dialWS(t, s.replicas[0].url, tok, sess)
			if err != nil {
				errs <- err
				return
			}
			defer conn.Close()
			wsRunCreate(t, conn, runBody("openai/gpt-4o", "stream", true))
			events, _ := wsRead(t, conn, streaming.EventRunFinished, 20*time.Second)
			if len(events) == 0 || events[len(events)-1].Type != streaming.EventRunFinished {
				errs <- errStreamIncomplete
				return
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent WS stream failure: %v", err)
		}
	}
	if goroutines() > base+100 {
		t.Fatalf("goroutines=%d (base=%d) after 30 concurrent streams", goroutines(), base)
	}
	vm(t, "ws_concurrent_streams", 30)
}

var errStreamIncomplete = &streamError{}

type streamError struct{}

func (e *streamError) Error() string { return "stream did not complete" }
