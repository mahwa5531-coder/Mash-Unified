// Package store owns all persistence: PostgreSQL (source of truth) and Redis
// (distributed fast-state). Repositories live in store/repos.
package store

import (
	"context"
	"errors"
	"fmt"
	"net"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/mash-cloud/mash-api/internal/domain"
)

// Postgres wraps the shared connection pool. One pool per process; repos
// borrow from it. Never a connection per request.
type Postgres struct {
	Pool *pgxpool.Pool
}

// NewPostgres creates and pings the pool. Bounded sizes, lifetime, and a
// health-check query budget come from cfg; ping failure is fatal at boot.
func NewPostgres(ctx context.Context, url string, maxConns, minConns int32, maxLifetime, healthTimeout time.Duration) (*Postgres, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("store: parse DATABASE_URL: %w", err)
	}
	cfg.MaxConns = maxConns
	cfg.MinConns = minConns
	cfg.MaxConnLifetime = maxLifetime
	cfg.MaxConnIdleTime = maxLifetime / 3
	cfg.HealthCheckPeriod = 30 * time.Second
	// Statement-level timeout: guards runaway queries; set per-statement by
	// repositories with their own budgets via context deadlines.
	cfg.ConnConfig.ConnectTimeout = 10 * time.Second

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("store: create pool: %w", err)
	}
	pingCtx, cancel := context.WithTimeout(ctx, healthTimeout)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("store: postgres ping: %w", err)
	}
	return &Postgres{Pool: pool}, nil
}

// Health pings with its own budget (used by /health/ready).
func (p *Postgres) Health(ctx context.Context) error {
	c, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	return p.Pool.Ping(c)
}

// Close closes the pool (idempotent).
func (p *Postgres) Close() {
	if p.Pool != nil {
		p.Pool.Close()
	}
}

// Stats snapshot for metrics.
func (p *Postgres) Stats() *pgxpool.Stat { return p.Pool.Stat() }

// Redis wraps the shared Redis client.
type Redis struct {
	Client redis.UniversalClient
}

// NewRedis builds the client from a URL and verifies connectivity.
func NewRedis(ctx context.Context, url string, poolSize int, cmdTimeout time.Duration) (*Redis, error) {
	opts, err := redis.ParseURL(url)
	if err != nil {
		return nil, fmt.Errorf("store: parse REDIS_URL: %w", err)
	}
	opts.PoolSize = poolSize
	opts.MinIdleConns = min(8, poolSize)
	opts.DialTimeout = 3 * time.Second
	opts.ReadTimeout = cmdTimeout
	opts.WriteTimeout = cmdTimeout
	// go-redis retries are safe for our idempotent commands; keep it minimal.
	opts.MaxRetries = 1

	client := redis.NewClient(opts)
	pingCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if err := client.Ping(pingCtx).Err(); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("store: redis ping: %w", err)
	}
	return &Redis{Client: client}, nil
}

// Health pings Redis with its own budget.
func (r *Redis) Health(ctx context.Context) error {
	c, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	return r.Client.Ping(c).Err()
}

// Close closes the client.
func (r *Redis) Close() error {
	if r.Client == nil {
		return nil
	}
	return r.Client.Close()
}

// IsRedisDown classifies errors as "Redis temporarily unavailable" — the
// signal for fail-open policies.
func IsRedisDown(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	if errors.Is(err, context.Canceled) {
		return false // caller canceled, not Redis
	}
	var rerr redis.Error
	if errors.As(err, &rerr) {
		// Redis answered with an error → it is up; the command was wrong.
		return false
	}
	var nerr interface{ Timeout() bool }
	if errors.As(err, &nerr) {
		return true
	}
	return true // network / closed / pool error → treat as down
}

// IsNotFound reports pgx.ErrNoCache / ErrNoRows in one place.
func IsNotFound(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

// IsUniqueViolation reports a unique-constraint conflict (pg error 23505).
func IsUniqueViolation(err error) bool {
	var pgErr interface{ SQLState() string }
	return errors.As(err, &pgErr) && pgErr.SQLState() == "23505"
}

// MapDBError converts storage-layer errors into the domain error model.
// Connection-class failures become DEPENDENCY_UNAVAILABLE so handlers can 503;
// everything unknown becomes INTERNAL with the cause preserved for logs.
func MapDBError(err error) *domain.Error {
	if err == nil {
		return nil
	}
	if IsNotFound(err) {
		return domain.ErrNotFound("resource")
	}
	if IsUniqueViolation(err) {
		return &domain.Error{Code: "CONFLICT", Message: "The resource already exists.", HTTP: 409, Cause: err}
	}
	if IsTimeout(err) {
		return domain.ErrDependencyUnavailable("postgres")
	}
	if IsConnUnavailable(err) {
		// Connection-level failures (refused/reset/closed/pool exhausted) are
		// dependency outages: 503 + retry guidance, never a 500 that suggests a
		// bug. pgx surfaces these as *pgconn.ConnectError / *net.OpError.
		return domain.ErrDependencyUnavailable("postgres")
	}
	return domain.ErrInternal(err)
}

// IsConnUnavailable reports connection-level failures (refused, reset,
// closed, unreachable). Timeouts are handled by IsTimeout; both map to
// DEPENDENCY_UNAVAILABLE but with distinct diagnostics.
func IsConnUnavailable(err error) bool {
	if err == nil {
		return false
	}
	var nerr net.Error
	if errors.As(err, &nerr) {
		return true
	}
	return errors.Is(err, net.ErrClosed)
}

// IsTimeout reports deadline exceeded (query budgets).
func IsTimeout(err error) bool {
	return errors.Is(err, context.DeadlineExceeded) || isPgTimeout(err)
}

func isPgTimeout(err error) bool {
	var t interface{ Timeout() bool }
	return errors.As(err, &t) && t.Timeout()
}
