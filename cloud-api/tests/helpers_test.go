package tests

import (
	"bufio"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
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

func cutPrefix(s, p string) (string, bool) {
	if len(s) >= len(p) && s[:len(p)] == p {
		return s[len(p):], true
	}
	return "", false
}

// waitFor polls until cond or timeout; returns whether cond was met.
func waitFor(t *testing.T, d time.Duration, cond func() bool) bool {
	t.Helper()
	deadline := time.Now().Add(d)
	for time.Now().Before(deadline) {
		if cond() {
			return true
		}
		time.Sleep(15 * time.Millisecond)
	}
	return cond()
}

// readRawSSE collects raw data lines (OpenAI pass-through surface).
func readRawSSE(t *testing.T, resp *http.Response, maxWait time.Duration) []string {
	t.Helper()
	defer resp.Body.Close()

	ch := make(chan []string, 1)
	go func() {
		var lines []string
		scanner := bufio.NewScanner(resp.Body)
		for scanner.Scan() {
			line := scanner.Text()
			if strings.HasPrefix(line, "data: ") {
				val := strings.TrimPrefix(line, "data: ")
				lines = append(lines, val)
				if val == "[DONE]" {
					break
				}
			}
		}
		ch <- lines
	}()

	select {
	case lines := <-ch:
		return lines
	case <-time.After(maxWait):
		return nil
	}
}

// readPartialSSE reads up to count chunks and closes the body promptly.
func readPartialSSE(t *testing.T, resp *http.Response, count int) {
	t.Helper()
	defer resp.Body.Close()
	scanner := bufio.NewScanner(resp.Body)
	read := 0
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "data: ") {
			read++
			if read >= count {
				return
			}
		}
	}
}
