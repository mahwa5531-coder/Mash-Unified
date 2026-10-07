package store

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"sort"
	"strconv"
	"strings"
	"time"
)

//go:embed migrations/*.sql
var migrationFS embed.FS

// Migrate applies all pending migrations under store/migrations exactly once,
// guarded by a PostgreSQL advisory lock so concurrent instances (horizontal
// scale, rolling deploys) never race. Each migration runs in a transaction;
// the version bookkeeping lives in schema_migrations.
func Migrate(ctx context.Context, pool *Postgres) error {
	if _, err := pool.Pool.Exec(ctx, `
                CREATE TABLE IF NOT EXISTS schema_migrations (
                        version    BIGINT PRIMARY KEY,
                        name       TEXT NOT NULL,
                        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )`); err != nil {
		return fmt.Errorf("migrate: bootstrap: %w", err)
	}

	names, err := fs.Glob(migrationFS, "migrations/*.sql")
	if err != nil {
		return fmt.Errorf("migrate: glob: %w", err)
	}
	sort.Strings(names) // 000001_users.sql, 000002_..., …

	// Cluster-wide lock: any instance may migrate; exactly one does at a time.
	if _, err := pool.Pool.Exec(ctx, `SELECT pg_advisory_lock(5234091001)`); err != nil {
		return fmt.Errorf("migrate: advisory lock: %w", err)
	}
	defer pool.Pool.Exec(context.WithoutCancel(ctx), `SELECT pg_advisory_unlock(5234091001)`)

	for _, name := range names {
		version, err := strconv.ParseInt(strings.SplitN(strings.TrimPrefix(name, "migrations/"), "_", 2)[0], 10, 64)
		if err != nil {
			return fmt.Errorf("migrate: bad filename %q: %w", name, err)
		}

		var exists bool
		if err := pool.Pool.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)`, version,
		).Scan(&exists); err != nil {
			return fmt.Errorf("migrate: check %d: %w", version, err)
		}
		if exists {
			continue
		}

		sql, err := migrationFS.ReadFile(name)
		if err != nil {
			return fmt.Errorf("migrate: read %q: %w", name, err)
		}

		if err := applyMigration(ctx, pool, version, name, string(sql)); err != nil {
			return err
		}
	}
	return nil
}

func applyMigration(ctx context.Context, pool *Postgres, version int64, name, sql string) error {
	limitCtx, cancel := context.WithTimeout(ctx, 2*time.Minute) // migrations may be slow
	defer cancel()

	tx, err := pool.Pool.Begin(limitCtx)
	if err != nil {
		return fmt.Errorf("migrate: begin %s: %w", name, err)
	}
	defer func() { _ = tx.Rollback(limitCtx) }()

	// session_replication_role is not needed: our FK graph is forward-declared.
	if _, err := tx.Exec(limitCtx, sql); err != nil {
		return fmt.Errorf("migrate: apply %s: %w", name, err)
	}
	if _, err := tx.Exec(limitCtx,
		`INSERT INTO schema_migrations (version, name) VALUES ($1, $2)`,
		version, strings.TrimSuffix(name, ".sql"),
	); err != nil {
		return fmt.Errorf("migrate: record %s: %w", name, err)
	}
	if err := tx.Commit(limitCtx); err != nil {
		return fmt.Errorf("migrate: commit %s: %w", name, err)
	}
	return nil
}
