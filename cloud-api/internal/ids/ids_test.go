package ids

import (
	"strings"
	"testing"
)

// TestValidateAcceptsMixedCaseEchoes guards audit finding 1: real-world
// client echoes carry uppercase — OpenAI tool-call ids
// ("call_9w7xQeG2b7s1Lp5z8k9m0n") and provider model names
// ("anthropic/claude-3-5-Sonnet-20241022"). Rejecting them broke every
// multi-turn tool loop at turn 2 (the desktop's assistant tool_calls echo
// failed validation with HTTP 400).
func TestValidateAcceptsMixedCaseEchoes(t *testing.T) {
	ok := []string{
		"call_9w7xQeG2b7s1Lp5z8k9m0n",          // OpenAI tool call id (real shape)
		"anthropic/claude-3-5-Sonnet-20241022", // mixed-case model
		"Qwen/Qwen2.5-72B-Instruct",            // OpenRouter-style provider prefix
		"openai/gpt-4o",                        // baseline lowercase
		"MSG_UPPERCASE",                        // client correlation ids
		"turn-ABC.123/xyz",
	}
	for _, s := range ok {
		if err := Validate(s, 256); err != nil {
			t.Errorf("Validate(%q) = %v, want accepted", s, err)
		}
	}
}

func TestValidateStillRejectsUnsafeCharacters(t *testing.T) {
	bad := []string{
		"",             // empty
		"has space",    // spaces break Redis keys
		"newline\n",    // injection into logs
		"quote\"id",    // injection into SQL text
		"semicolon;id", // injection into SQL text
		"unicode-é",    // non-ASCII
		"back\\slash",
	}
	for _, s := range bad {
		if err := Validate(s, 256); err == nil {
			t.Errorf("Validate(%q) accepted, want rejected", s)
		}
	}
}

func TestValidateLengthBound(t *testing.T) {
	long := make([]byte, 300)
	for i := range long {
		long[i] = 'a'
	}
	if err := Validate(string(long), 256); err == nil {
		t.Error("oversized id accepted")
	}
	if err := Validate(string(long[:256]), 256); err != nil {
		t.Errorf("max-length id rejected: %v", err)
	}
}

// TestNewShape pins the wire format: prefix + "_" + exactly 26 lowercase
// Crockford base32 characters (no i/l/o/u — they would round-trip badly in
// hand-transcribed ids and sort inconsistently in TEXT keys).
func TestNewShape(t *testing.T) {
	crockford := make(map[byte]bool, len(alphabet))
	for i := 0; i < len(alphabet); i++ {
		crockford[alphabet[i]] = true
	}
	id := New("sess")
	if len(id) != len("sess")+1+26 {
		t.Fatalf("length = %d, want prefix+1+26", len(id))
	}
	if !strings.HasPrefix(id, "sess_") {
		t.Fatalf("prefix = %q, want sess_", id[:5])
	}
	for i := 5; i < len(id); i++ {
		if !crockford[id[i]] {
			t.Fatalf("char %q at %d not in Crockford base32", id[i], i)
		}
	}
	if New("") == "" {
		t.Fatal("empty-prefix id should still carry the 26-char body")
	}
}

// TestNewCollisionFreeUnderBurst is the regression for the entropy collapse:
// the base32 encoder used to read b[10:] while writing b[10:], so from the
// third input byte on it re-encoded its own output. Effective entropy fell
// from 80 bits to ~16, and same-millisecond bursts collided by birthday
// paradox (expected ≈ N²/2¹⁷ collisions per same-ms group — hundreds across
// this test). 80 real bits make a duplicate here a practical impossibility:
// at 200k ids the collision chance is ~10⁻²⁴.
func TestNewCollisionFreeUnderBurst(t *testing.T) {
	const n = 200_000
	seen := make(map[string]struct{}, n)
	for i := 0; i < n; i++ {
		id := New("run")
		if _, dup := seen[id]; dup {
			t.Fatalf("duplicate id %q after %d generations — entropy collapse regression", id, i)
		}
		seen[id] = struct{}{}
	}
}
