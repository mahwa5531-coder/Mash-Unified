// Package ids generates server-authoritative, sortable identifiers.
// ULID-style: 48-bit timestamp + 80 bits of crypto/rand entropy, base32
// (Crockford) — 26 chars total, lexicographically ordered.
package ids

import (
	"crypto/rand"
	"encoding/binary"
	"fmt"
	"io"
	"sync"
	"time"
)

const alphabet = "0123456789abcdefghjkmnpqrstvwxyz" // Crockford base32, no i/l/o/u

var mu sync.Mutex // serializes reads from the shared entropy source

// New returns a prefixed ULID-style id: prefix + "_" + 26 chars.
func New(prefix string) string {
	var b [26]byte
	// Entropy lives in its own buffer: encoding in place would have the
	// loop below read back the base32 characters it just wrote (the writer
	// overtakes the reader from the third byte on), collapsing the 80
	// advertised entropy bits to ~16 and colliding IDs under same-millisecond
	// bursts (caught by TestNewCollisionFreeUnderBurst).
	var ent [16]byte

	mu.Lock()
	_, err := io.ReadFull(rand.Reader, ent[:])
	mu.Unlock()
	if err != nil {
		// crypto/rand failing is a process-level catastrophe; degrade to
		// time-based entropy rather than panicking on a hot path.
		binary.BigEndian.PutUint64(ent[:8], uint64(time.Now().UnixNano()))
	}
	ts := uint64(time.Now().UnixMilli())
	// 48-bit timestamp → 10 base32 chars
	b[0] = alphabet[(ts>>45)&0x1f]
	b[1] = alphabet[(ts>>40)&0x1f]
	b[2] = alphabet[(ts>>35)&0x1f]
	b[3] = alphabet[(ts>>30)&0x1f]
	b[4] = alphabet[(ts>>25)&0x1f]
	b[5] = alphabet[(ts>>20)&0x1f]
	b[6] = alphabet[(ts>>15)&0x1f]
	b[7] = alphabet[(ts>>10)&0x1f]
	b[8] = alphabet[(ts>>5)&0x1f]
	b[9] = alphabet[ts&0x1f]

	// 80-bit entropy → 16 base32 chars. b[10:] is write-only here; the
	// source bytes come from ent, never from the output array.
	var bitBuf uint64
	var bits uint
	pos := 10
	for _, by := range ent {
		bitBuf = bitBuf<<8 | uint64(by)
		bits += 8
		for bits >= 5 && pos < 26 {
			bits -= 5
			b[pos] = alphabet[(bitBuf>>bits)&0x1f]
			pos++
		}
	}
	for pos < 26 {
		b[pos] = alphabet[0]
		pos++
	}

	if prefix == "" {
		return string(b[:])
	}
	return prefix + "_" + string(b[:])
}

// Convenience constructors for the platform's id vocabulary.
func RequestID() string      { return New("req") }
func RunID() string          { return New("run") }
func SessionID() string      { return New("sess") }
func EventID() string        { return New("evt") }
func MessageID() string      { return New("msg") }
func ThinkingMsgID() string  { return New("thk") }
func TenantID() string       { return New("ten") }
func UserID() string         { return New("usr") }
func DeviceID() string       { return New("dev") }
func RefreshTokenID() string { return New("rt") }

// Validate checks a client-supplied id: non-empty, length bound, allowed
// charset. Prevents injection into Redis keys, SQL text and log fields.
//
// The charset is case-sensitive on purpose (ids are opaque echoes, and server
// ids are lowercase ULIDs), but BOTH cases of ASCII letters are accepted:
// real-world echoes carry mixed case — OpenAI tool-call ids look like
// "call_9w7xQeG2b7s1Lp5z8k9m0n" and provider model names like
// "anthropic/claude-3-5-Sonnet-20241022". Rejecting uppercase broke every
// multi-turn tool loop at turn 2 (audit finding 1).
func Validate(s string, maxLen int) error {
	if s == "" {
		return fmt.Errorf("empty id")
	}
	if len(s) > maxLen {
		return fmt.Errorf("id too long (%d > %d)", len(s), maxLen)
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		ok := (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
			c == '_' || c == '-' || c == '.' || c == '/'
		if !ok {
			return fmt.Errorf("invalid character %q at %d", c, i)
		}
	}
	return nil
}
