// WebSocket transport: one persistent desktop connection per session view.
// Architecture (spec §9): transport adapter only — no authorization, metering
// or Bifrost logic lives here. Business logic arrives via ProtocolHandler.
//
// Per connection: exactly 2 goroutines (reader, writer) with clear lifecycles.
// Outbound is a bounded queue; slow consumers get a grace window and are then
// evicted. Server pings keep intermediaries aligned; any inbound frame resets
// the read deadline. Cancellation propagates: connection loss cancels runs
// owned by this connection (handled by the run manager via OnClose hooks).
package streaming

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"github.com/nexau-cloud/nexau-api/internal/observability"
)

// WSConfig bounds one connection.
type WSConfig struct {
	HeartbeatInterval time.Duration
	WriteWait         time.Duration
	MaxMessageSize    int64
	SendQueue         int
	SlowConsumerGrace time.Duration
	IdleTimeout       time.Duration
}

// Close codes (spec §4.4).
const (
	CloseNormal    = websocket.CloseNormalClosure
	CloseGoingAway = websocket.CloseGoingAway
	ClosePolicy    = websocket.ClosePolicyViolation
	CloseInternal  = websocket.CloseInternalServerErr
)

// ProtocolHandler is the business-logic side of the WS protocol, implemented
// by the agent layer adapter. The transport never imports Bifrost or repos.
type ProtocolHandler interface {
	// HandleMessage processes one client protocol frame. It may use
	// conn.Send to deliver events synchronously.
	HandleMessage(ctx context.Context, conn *Connection, msg ClientMessage)
}

// ClientMessage is a decoded C→S frame.
type ClientMessage struct {
	Type         string          `json:"type"` // run.create|run.cancel|resume|ack|ping
	RunID        string          `json:"run_id,omitempty"`
	LastSequence int64           `json:"last_sequence,omitempty"`
	Request      json.RawMessage `json:"request,omitempty"`
}

// Upgrader builds connections (transport construction only; auth is done)
// and tracks live connections for graceful shutdown.
type Upgrader struct {
	upgrader websocket.Upgrader
	cfg      WSConfig
	m        *observability.Metrics

	mu    sync.Mutex
	conns map[*Connection]struct{}
}

func NewUpgrader(cfg WSConfig, allowedOrigins []string, m *observability.Metrics) *Upgrader {
	u := websocket.Upgrader{
		ReadBufferSize:  32 << 10,
		WriteBufferSize: 32 << 10,
	}
	if len(allowedOrigins) == 0 {
		// Non-browser desktop client: no Origin header is sent at all.
		u.CheckOrigin = func(r *http.Request) bool { return true }
	} else {
		allowed := make(map[string]struct{}, len(allowedOrigins))
		for _, o := range allowedOrigins {
			allowed[o] = struct{}{}
		}
		u.CheckOrigin = func(r *http.Request) bool {
			origin := r.Header.Get("Origin")
			if origin == "" {
				return true // native clients
			}
			_, ok := allowed[origin]
			return ok
		}
	}
	return &Upgrader{upgrader: u, cfg: cfg, m: m, conns: map[*Connection]struct{}{}}
}

// Shutdown closes every live connection with a Going Away close code
// (graceful-shutdown step 5). Idempotent.
func (u *Upgrader) Shutdown() {
	u.mu.Lock()
	conns := make([]*Connection, 0, len(u.conns))
	for c := range u.conns {
		conns = append(conns, c)
	}
	u.mu.Unlock()
	for _, c := range conns {
		c.shutdown(CloseGoingAway, "server shutting down")
	}
}

// LiveConnections reports the count (diagnostics).
func (u *Upgrader) LiveConnections() int {
	u.mu.Lock()
	defer u.mu.Unlock()
	return len(u.conns)
}

func (u *Upgrader) track(c *Connection) {
	u.mu.Lock()
	u.conns[c] = struct{}{}
	u.mu.Unlock()
}

func (u *Upgrader) untrack(c *Connection) {
	u.mu.Lock()
	delete(u.conns, c)
	u.mu.Unlock()
}

// Connection is one live desktop WebSocket. Safe for concurrent Send.
type Connection struct {
	ws      *websocket.Conn
	cfg     WSConfig
	m       *observability.Metrics
	session string
	tenant  string
	user    string
	owner   *Upgrader // set when created via Upgrader.Upgrade

	send    chan []byte
	closeMu sync.Mutex
	closed  bool
	closeCh chan struct{}

	// slow tracks the slow-consumer grace window. `dropped` flags that at
	// least one frame was discarded during the current episode so the next
	// successful enqueue delivers a RESYNC_REQUIRED hint (audit finding 7).
	slowMu    sync.Mutex
	slowSince time.Time
	dropped   bool
	evicted   bool

	// writeMu serializes all websocket frame writes (gorilla requirement).
	writeMu sync.Mutex

	// onClose hooks: run manager cancels runs owned by this connection.
	onCloseMu sync.Mutex
	onClose   []func()

	// authGuard is the periodic re-authorization probe (2026-09-19 audit,
	// cluster B: a WS connection must not outlive its credential). It is
	// invoked once per heartbeat tick by the write pump; a non-nil error
	// closes the connection with 1008 POLICY_VIOLATION. The transport
	// never interprets the check — the api layer owns what "still
	// authorized" means (jti blacklist + token expiry).
	authMu    sync.Mutex
	authGuard func() error
}

// SetAuthGuard installs the periodic authorization probe. Set BEFORE Serve
// (the first heartbeat tick may fire immediately after); safe to call later
// under the lock. A nil probe (or never-set) preserves the old behavior.
func (c *Connection) SetAuthGuard(fn func() error) {
	c.authMu.Lock()
	c.authGuard = fn
	c.authMu.Unlock()
}

func (c *Connection) runAuthGuard() error {
	c.authMu.Lock()
	fn := c.authGuard
	c.authMu.Unlock()
	if fn == nil {
		return nil
	}
	return fn()
}

// Upgrade performs the WS handshake. The request must already be
// authenticated (identity resolved) — transport never authenticates.
func (u *Upgrader) Upgrade(w http.ResponseWriter, r *http.Request, tenantID, userID, sessionID string) (*Connection, error) {
	ws, err := u.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return nil, err
	}
	if u.m != nil {
		u.m.ActiveWSConnections.Add(1)
	}
	c := &Connection{
		ws:      ws,
		cfg:     u.cfg,
		m:       u.m,
		session: sessionID,
		tenant:  tenantID,
		user:    userID,
		send:    make(chan []byte, u.cfg.SendQueue),
		closeCh: make(chan struct{}),
	}
	u.track(c)
	c.owner = u
	return c, nil
}

// Serve runs the connection to completion (blocks). handler receives every
// client frame. Exactly one reader + one writer goroutine live per call.
func (c *Connection) Serve(ctx context.Context, handler ProtocolHandler) {
	defer c.shutdown(CloseGoingAway, "server stopping")

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); c.readPump(ctx, cancel, handler) }()
	go func() { defer wg.Done(); c.writePump(ctx) }()
	wg.Wait()
}

func (c *Connection) readPump(ctx context.Context, cancel context.CancelFunc, handler ProtocolHandler) {
	defer cancel()
	// Poison-pill containment (2026-09-18 audit): the pumps run detached —
	// an unrecovered panic here kills the process. The connection dies
	// instead, and the desktop reconnects + resumes from replay.
	defer func() {
		if rec := recover(); rec != nil {
			if rec == http.ErrAbortHandler {
				panic(rec)
			}
			// shutdown itself must be panic-guarded: the connection
			// may be the poison source, and a panic inside this
			// recover would escape containment.
			func() {
				defer func() { _ = recover() }()
				c.shutdown(CloseInternal, "read pump failure")
			}()
		}
	}()
	c.ws.SetReadLimit(c.cfg.MaxMessageSize)
	_ = c.ws.SetReadDeadline(time.Now().Add(c.cfg.IdleTimeout))
	c.ws.SetPongHandler(func(string) error {
		_ = c.ws.SetReadDeadline(time.Now().Add(c.cfg.IdleTimeout))
		return nil
	})

	for {
		_, data, err := c.ws.ReadMessage()
		if err != nil {
			return // closed, protocol error or idle timeout
		}
		_ = c.ws.SetReadDeadline(time.Now().Add(c.cfg.IdleTimeout))

		if int64(len(data)) > c.cfg.MaxMessageSize {
			c.shutdown(ClosePolicy, "frame too large")
			return
		}
		var msg ClientMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			if err := c.SendControl(map[string]any{
				"type": "error", "code": "INVALID_FRAME",
				"message": "Malformed protocol frame.",
			}); err != nil {
				return
			}
			continue
		}
		switch msg.Type {
		case "ping":
			// Application-level ping: reply with a pong control frame.
			_ = c.SendControl(map[string]any{"type": "pong"})
		case "", "run.create", "run.cancel", "resume", "ack":
			if msg.Type == "" {
				_ = c.SendControl(map[string]any{
					"type": "error", "code": "INVALID_FRAME",
					"message": "Frame is missing the type field.",
				})
				continue
			}
			handler.HandleMessage(ctx, c, msg)
		default:
			_ = c.SendControl(map[string]any{
				"type": "error", "code": "UNKNOWN_FRAME",
				"message": "Unknown frame type.", "frame_type": msg.Type,
			})
		}
	}
}

func (c *Connection) writePump(ctx context.Context) {
	ticker := time.NewTicker(c.cfg.HeartbeatInterval)
	defer ticker.Stop()
	defer func() {
		if rec := recover(); rec != nil {
			if rec == http.ErrAbortHandler {
				panic(rec)
			}
			func() {
				defer func() { _ = recover() }()
				c.shutdown(CloseInternal, "write pump failure")
			}()
		}
	}()
	for {
		select {
		case <-ctx.Done():
			return
		case <-c.closeCh:
			// Drain briefly so queued events have a chance to land.
			c.drain(500 * time.Millisecond)
			return
		case blob := <-c.send:
			if err := c.writeFrame(websocket.TextMessage, blob); err != nil {
				return
			}
		case <-ticker.C:
			// Re-authorize before pinging: a connection whose token was
			// revoked (logout) or has expired is closed at the next
			// heartbeat — it must not run for hours on a credential
			// that would fail every new request (2026-09-19 audit,
			// cluster B).
			if err := c.runAuthGuard(); err != nil {
				c.shutdown(ClosePolicy, "authorization no longer valid")
				return
			}
			if err := c.ping(); err != nil {
				return
			}
		}
	}
}

func (c *Connection) drain(d time.Duration) {
	deadline := time.After(d)
	for {
		select {
		case blob := <-c.send:
			if err := c.writeFrame(websocket.TextMessage, blob); err != nil {
				return
			}
		case <-deadline:
			return
		default:
			return
		}
	}
}

func (c *Connection) writeFrame(mt int, blob []byte) error {
	// gorilla/websocket requires ONE concurrent writer. Every frame — data,
	// ping, close — funnels through this lock: the write pump, the eviction
	// path (Send → shutdown → close frame) and graceful shutdown all write
	// from different goroutines; without serialization the first overlap
	// panics the process ("concurrent write to websocket connection").
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	_ = c.ws.SetWriteDeadline(time.Now().Add(c.cfg.WriteWait))
	return c.ws.WriteMessage(mt, blob)
}

func (c *Connection) ping() error {
	return c.writeFrame(websocket.PingMessage, nil)
}

// Send enqueues one raw envelope for delivery. Non-blocking with
// slow-consumer grace: first overflow starts the grace window; sustained
// overflow past the window evicts the connection.
//
// Frames dropped inside the grace window are LOUD (audit finding 7): every
// drop increments ws_grace_drops, the first drop of an episode logs, and a
// RESYNC_REQUIRED control frame is delivered as soon as the queue drains —
// the client then resumes affected runs from the durable replay buffer to
// refill the gap. Sequences are per-run, so the client knows exactly which
// events went missing.
func (c *Connection) Send(blob []byte) error {
	c.closeMu.Lock()
	closed := c.closed
	c.closeMu.Unlock()
	if closed {
		return ErrConnClosed
	}

	select {
	case c.send <- blob:
		c.slowMu.Lock()
		recovered := c.dropped
		c.dropped = false
		c.slowSince = time.Time{}
		c.slowMu.Unlock()
		if recovered {
			c.hintResync()
		}
		return nil
	default:
	}

	c.slowMu.Lock()
	if c.evicted {
		c.slowMu.Unlock()
		return ErrConnClosed
	}
	if c.slowSince.IsZero() {
		c.slowSince = time.Now()
		c.dropped = true
		c.slowMu.Unlock()
		c.noteDrop(true) // first drop of the episode
		return nil       // within grace
	}
	if time.Since(c.slowSince) > c.cfg.SlowConsumerGrace {
		c.evicted = true
		c.slowMu.Unlock()
		if c.m != nil {
			c.m.WSSlowConsumers.Add(context.Background(), 1)
		}
		c.shutdown(CloseInternal, "slow consumer")
		return ErrConnClosed
	}
	c.slowMu.Unlock()
	c.noteDrop(false) // sustained overflow, still within grace
	return nil
}

// resyncFrame is the advisory control frame queued after a drop episode.
var resyncFrame = []byte(`{"type":"RESYNC_REQUIRED","message":"Frames were dropped under backpressure; resume active runs to refill sequence gaps."}`)

// noteDrop records a grace-window drop: metric always, log once per episode.
func (c *Connection) noteDrop(first bool) {
	if c.m != nil {
		c.m.WSGraceDrops.Add(context.Background(), 1)
	}
	if first {
		observability.LogWarn("ws: send queue full — dropping frames within grace window",
			"session_id", c.session, "user_id", c.user)
	}
}

// hintResync enqueues the RESYNC_REQUIRED hint now that the queue has
// capacity. Non-blocking: if the queue filled again in the race window, the
// flag is re-armed and the next successful send retries.
func (c *Connection) hintResync() {
	select {
	case c.send <- resyncFrame:
	default:
		c.slowMu.Lock()
		c.dropped = true
		c.slowMu.Unlock()
	}
}

// SendEvent marshals and enqueues an envelope.
func (c *Connection) SendEvent(env *Envelope) error {
	if env == nil {
		return nil
	}
	return c.Send(env.Marshal())
}

// SendControl sends a non-envelope control frame (pong, resume.ok, errors).
func (c *Connection) SendControl(v any) error {
	blob, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return c.Send(blob)
}

// ErrConnClosed marks a terminated connection.
var ErrConnClosed = errors.New("websocket connection closed")

// OnClose registers a hook fired exactly once when the connection ends.
// The run manager uses this to cancel runs owned by the connection.
func (c *Connection) OnClose(fn func()) {
	c.onCloseMu.Lock()
	c.onClose = append(c.onClose, fn)
	c.onCloseMu.Unlock()

	c.closeMu.Lock()
	closed := c.closed
	c.closeMu.Unlock()
	if closed { // race: closed between registration and check
		fn()
	}
}

// SessionID / TenantID / UserID identify the connection owner.
func (c *Connection) SessionID() string { return c.session }
func (c *Connection) TenantID() string  { return c.tenant }
func (c *Connection) UserID() string    { return c.user }

// shutdown closes the connection and runs close hooks exactly once.
func (c *Connection) shutdown(code int, reason string) {
	c.closeMu.Lock()
	if c.closed {
		c.closeMu.Unlock()
		return
	}
	c.closed = true
	close(c.closeCh)
	c.closeMu.Unlock()

	_ = c.writeFrame(websocket.CloseMessage, websocket.FormatCloseMessage(code, reason))
	time.Sleep(20 * time.Millisecond) // allow OS network buffer to flush the close frame before TCP teardown
	_ = c.ws.Close()

	if c.m != nil {
		c.m.ActiveWSConnections.Add(-1)
	}
	c.untrack()

	c.onCloseMu.Lock()
	hooks := c.onClose
	c.onClose = nil
	c.onCloseMu.Unlock()
	for _, fn := range hooks {
		fn()
	}
}

// ClosedSignal is closed exactly once when the connection terminates
// (lifecycle observation for detached goroutines).
func (c *Connection) ClosedSignal() <-chan struct{} { return c.closeCh }

// untrack removes the connection from its owning upgrader's registry.
func (c *Connection) untrack() {
	if c.owner != nil {
		c.owner.untrack(c)
	}
}

// Closed reports whether the connection has terminated.
func (c *Connection) Closed() bool {
	c.closeMu.Lock()
	defer c.closeMu.Unlock()
	return c.closed
}
