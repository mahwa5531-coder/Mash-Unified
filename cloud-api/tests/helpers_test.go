package tests

import (
	"encoding/json"
	"io"
	"net/http"
	"testing"
	"time"

	"github.com/nexau-cloud/nexau-api/internal/streaming"
)

func jsonUnmarshal(b []byte, v any) error { return json.Unmarshal(b, v) }

func newRequest(t *testing.T, method, url string) (*http.Request, error) {
	t.Helper()
	return http.NewRequest(method, url, nil)
}

func httpDo(req *http.Request) (*http.Response, error) {
	return http.DefaultClient.Do(req)
}

func readAll(t *testing.T, resp *http.Response) string {
	t.Helper()
	b, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return ""
	}
	return string(b)
}

// readOne pulls the next event frame (or nil on stream end / timeout).
func readOne(t *testing.T, resp *http.Response) *sseEvent {
	t.Helper()
	var carry []byte
	buf := make([]byte, 32<<10)
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			carry = append(carry, buf[:n]...)
			for {
				idx := indexTerminator(carry)
				if idx < 0 {
					break
				}
				frame := string(carry[:idx])
				carry = carry[idx+2:]
				if line, ok := cutPrefix(frame, "data: "); ok {
					env, derr := streaming.DecodeEnvelope([]byte(line))
					if derr == nil {
						return &sseEvent{env: *env, at: time.Now()}
					}
				}
			}
		}
		if err != nil {
			return nil
		}
	}
	return nil
}

func cutPrefix(s, p string) (string, bool) {
	if len(s) >= len(p) && s[:len(p)] == p {
		return s[len(p):], true
	}
	return "", false
}
