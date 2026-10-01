// Package idempotency implements Idempotency-Key processing for run creation.
// Duplicate submissions (network retry, client retry, LB retry) must not
// trigger a second billable upstream call.
//
// Layering:
//  1. Redis `SET NX PX` — fast path, short window (NEXAU_IDEMPOTENCY_TTL).
//     Value stores {run_id, request_hash, status}.
//  2. PostgreSQL unique partial index on agent_runs(idempotency_key) — durable
//     backstop when the Redis window expired or Redis was flushed.
//
// Semantics:
//
//	same key + same body  → replay: point the client at the original run
//	same key + new body   → IDEMPOTENCY_KEY_REUSE (422): client bug or abuse
//	key seen mid-flight   → DUPLICATE_IN_PROGRESS (409): original still running
package idempotency

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/nexau-cloud/nexau-api/internal/domain"
	"github.com/nexau-cloud/nexau-api/internal/store"
)

// Record is the stored idempotency state.
type Record struct {
	RunID       string `json:"run_id"`
	RequestHash string `json:"request_hash"`
	Status      string `json:"status"`
	SessionID   string `json:"session_id"`
	// ClaimedAt is when the current claim was written. Consumers use it to
	// disambiguate a nil PG row: a fresh claim means the winner is still
	// between the Redis claim and the durable insert (normal race); an old
	// claim means the winner died in that window (stale).
	ClaimedAt time.Time `json:"claimed_at,omitempty"`
}

// Store is safe for concurrent use.
type Store struct {
	rdb redis.UniversalClient
	ttl time.Duration
}

func New(rdb redis.UniversalClient, ttl time.Duration) *Store {
	return &Store{rdb: rdb, ttl: ttl}
}

// Outcome of a Begin call.
type Outcome int

const (
	// Fresh: no prior use — the caller owns the logical operation.
	Fresh Outcome = iota
	// Replay: a prior completed run exists — return the original outcome.
	Replay
	// InFlight: the original request is still being processed.
	InFlight
	// Reuse: the key was reused with a DIFFERENT body — client error.
	Reuse
)

// Begin claims the key. caller-visible decisions map 1:1 to Outcome.
// runID is the id the caller will use if the outcome is Fresh.
func (s *Store) Begin(ctx context.Context, tenantID, userID, key, requestHash, runID, sessionID string) (Outcome, *Record, error) {
	rec := &Record{RunID: runID, RequestHash: requestHash, Status: domain.RunRunning, SessionID: sessionID, ClaimedAt: time.Now().UTC()}
	blob, err := json.Marshal(rec)
	if err != nil {
		return Fresh, nil, domain.ErrInternal(err)
	}

	k := keyName(tenantID, userID, key)
	ok, err := s.rdb.SetNX(ctx, k, blob, s.ttl).Result()
	if err != nil {
		if store.IsRedisDown(err) {
			// Redis unavailable: fall through to the DB backstop. The caller
			// checks the runs table; a unique-violation there replays. We mark
			// Fresh so the caller proceeds — the DB constraint is the guard.
			return Fresh, nil, nil
		}
		return Fresh, nil, domain.ErrInternal(err)
	}
	if ok {
		return Fresh, rec, nil
	}

	// Key exists: load and compare.
	prev, err := s.load(ctx, k)
	if err != nil {
		return Fresh, nil, err
	}
	if prev == nil {
		// Corrupt/empty entry: treat as fresh by overwriting.
		s.rdb.Set(ctx, k, blob, s.ttl)
		return Fresh, rec, nil
	}
	if prev.RequestHash != requestHash {
		return Reuse, prev, nil
	}
	switch prev.Status {
	case domain.RunRunning, domain.RunDisconnected:
		return InFlight, prev, nil
	default:
		return Replay, prev, nil
	}
}

// Complete updates the stored status when the logical operation finishes.
// Best-effort: Redis loss only shortens the replay window; the DB backstop
// remains authoritative.
func (s *Store) Complete(ctx context.Context, tenantID, userID, key, runID, status string) {
	if s.rdb == nil {
		return
	}
	k := keyName(tenantID, userID, key)
	blob, err := s.rdb.Get(ctx, k).Bytes()
	if err != nil || len(blob) == 0 {
		return
	}
	var rec Record
	if json.Unmarshal(blob, &rec) != nil || rec.RunID != runID {
		return
	}
	rec.Status = status
	if nb, err := json.Marshal(&rec); err == nil {
		s.rdb.Set(ctx, k, nb, s.ttl)
	}
}

// Abort releases a claimed key when the logical operation FAILED BEFORE the
// run became durable (setup fault: concurrency rejection, DB insert error,
// orphaned record). Without this, the key stays "running" for the full TTL
// and every client retry gets DUPLICATE_IN_PROGRESS — a transient fault
// would poison the key. Deletes only if the record still maps to runID
// (never clobbers a record another request owns).
func (s *Store) Abort(ctx context.Context, tenantID, userID, key, runID string) {
	if s.rdb == nil {
		return
	}
	k := keyName(tenantID, userID, key)
	blob, err := s.rdb.Get(ctx, k).Bytes()
	if err != nil || len(blob) == 0 {
		return
	}
	var rec Record
	if json.Unmarshal(blob, &rec) != nil || rec.RunID != runID {
		return
	}
	s.rdb.Del(ctx, k)
}

// Repoint rewrites the stored record to the authoritative run — used when the
// PostgreSQL unique backstop wins the race (our Fresh claim pointed at a run
// that was never inserted; the DB already holds the original). Future retries
// then replay from the fast path instead of re-hitting the DB constraint.
func (s *Store) Repoint(ctx context.Context, tenantID, userID, key string, rec *Record) {
	if s.rdb == nil || rec == nil {
		return
	}
	blob, err := json.Marshal(rec)
	if err != nil {
		return
	}
	s.rdb.Set(ctx, keyName(tenantID, userID, key), blob, s.ttl)
}

// Get resolves the current record for a key (diagnostics + WS path).
func (s *Store) Get(ctx context.Context, tenantID, userID, key string) (*Record, error) {
	return s.load(ctx, keyName(tenantID, userID, key))
}

func (s *Store) load(ctx context.Context, k string) (*Record, error) {
	blob, err := s.rdb.Get(ctx, k).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, nil
		}
		if store.IsRedisDown(err) {
			return nil, nil // degraded: callers fall to the DB backstop
		}
		return nil, domain.ErrInternal(err)
	}
	var rec Record
	if err := json.Unmarshal(blob, &rec); err != nil {
		return nil, nil
	}
	return &rec, nil
}

// HashRequestBytes hashes a pre-serialized fingerprint.
func HashRequestBytes(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

func keyName(tenantID, userID, key string) string {
	return "idem:" + tenantID + ":" + userID + ":" + key
}
