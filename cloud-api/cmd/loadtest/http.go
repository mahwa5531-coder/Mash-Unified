package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"time"
)

// One shared HTTP client for the entire generator: connection reuse is the
// deployment's hot path, so the load test must exercise it (never a fresh
// transport per request).
var sharedClient = &http.Client{
	Timeout: 10 * time.Minute,
	Transport: &http.Transport{
		MaxIdleConns:        1024,
		MaxIdleConnsPerHost: 1024,
		MaxConnsPerHost:     0,
		IdleConnTimeout:     90 * time.Second,
		ForceAttemptHTTP2:   true,
	},
}

type sharedClientType = http.Client

func newPOST(url, body, token string) (*http.Request, error) {
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader([]byte(body)))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	return req, nil
}

func jsonDecode(r interface{ Read([]byte) (int, error) }, v any) error {
	// minimal reader-based JSON decode
	buf := make([]byte, 0, 4096)
	b := make([]byte, 4096)
	for {
		n, err := r.Read(b)
		buf = append(buf, b[:n]...)
		if err != nil {
			break
		}
	}
	return json.Unmarshal(buf, v)
}
