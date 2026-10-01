package streaming

import (
	"testing"
	"time"
)

// TestSendGraceDropIsLoudAndHintsResync guards audit finding 7: frames
// dropped inside the slow-consumer grace window must not vanish silently.
// The drop is recorded (dropped flag → metric + log in production code) and,
// once the queue drains, a RESYNC_REQUIRED control frame is delivered so the
// client can resume affected runs from the durable replay buffer.
func TestSendGraceDropIsLoudAndHintsResync(t *testing.T) {
	c := &Connection{
		cfg: WSConfig{
			SendQueue:         2,
			SlowConsumerGrace: 30 * time.Second, // long enough not to evict mid-test
		},
		send:    make(chan []byte, 2),
		closeCh: make(chan struct{}),
	}

	// Fill the queue.
	if err := c.Send([]byte("a")); err != nil {
		t.Fatalf("send a: %v", err)
	}
	if err := c.Send([]byte("b")); err != nil {
		t.Fatalf("send b: %v", err)
	}

	// Overflow within the grace window: dropped, but NOT an error (the grace
	// window exists to absorb transient stalls without killing the conn).
	if err := c.Send([]byte("c")); err != nil {
		t.Fatalf("grace drop must not error: %v", err)
	}
	if err := c.Send([]byte("d")); err != nil {
		t.Fatalf("grace drop must not error: %v", err)
	}

	// The drop episode is recorded.
	c.slowMu.Lock()
	dropped := c.dropped
	c.slowMu.Unlock()
	if !dropped {
		t.Fatal("drop episode not recorded (silent drop — audit finding 7 regression)")
	}

	// Queue drains: the next successful send must deliver the RESYNC_REQUIRED
	// hint so the client rechecks per-run sequences. (Both backlog frames are
	// consumed — the hint needs one spare slot; if the queue refilled in the
	// race window the flag re-arms and a later send retries.)
	<-c.send // drain backlog "a"
	<-c.send // drain backlog "b"
	if err := c.Send([]byte("e")); err != nil {
		t.Fatalf("send after drain: %v", err)
	}

	var got [][]byte
	for {
		select {
		case b := <-c.send:
			got = append(got, b)
		default:
			goto done
		}
	}
done:
	if len(got) != 2 { // e (recovered), resyncFrame
		t.Fatalf("queue contents: %q", got)
	}
	last := string(got[len(got)-1])
	if last != string(resyncFrame) {
		t.Fatalf("last queued frame = %q, want RESYNC_REQUIRED hint %q", last, resyncFrame)
	}
}

// TestSendNoResyncWithoutDrop: the hint must only appear after an actual
// drop episode — healthy queues never inject control frames.
func TestSendNoResyncWithoutDrop(t *testing.T) {
	c := &Connection{
		cfg:     WSConfig{SendQueue: 4, SlowConsumerGrace: time.Second},
		send:    make(chan []byte, 4),
		closeCh: make(chan struct{}),
	}
	for i := 0; i < 3; i++ {
		if err := c.Send([]byte("x")); err != nil {
			t.Fatalf("send: %v", err)
		}
	}
	select {
	case b := <-c.send:
		if string(b) == string(resyncFrame) {
			t.Fatal("RESYNC_REQUIRED injected without any drop")
		}
	default:
	}
}
