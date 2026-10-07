package repos

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mash-cloud/mash-api/internal/domain"
)

// NormalizationRepo reads token_normalization — the dynamic, per-model token
// accounting weights (the quota currency). The table is tiny by construction
// (a default row plus one row per specially-priced model), so callers load the
// full active set and resolve per model in a short-TTL cache; operators change
// accounting with a plain UPDATE and the API picks it up without a restart.
type NormalizationRepo struct{ Pool *pgxpool.Pool }

func NewNormalization(p *pgxpool.Pool) *NormalizationRepo { return &NormalizationRepo{Pool: p} }

// All returns every active rule ordered by model (exact keys, patterns and
// the '*' default all included — resolution is the caller's job).
func (r *NormalizationRepo) All(ctx context.Context) ([]domain.NormRule, error) {
	rows, err := r.Pool.Query(ctx, `
		SELECT model, input_weight, cached_read_weight, cached_write_weight, output_weight
		FROM token_normalization
		WHERE is_active
		ORDER BY model`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []domain.NormRule
	for rows.Next() {
		var rule domain.NormRule
		var in, cr, cw, outW float64
		if err := rows.Scan(&rule.Model, &in, &cr, &cw, &outW); err != nil {
			return nil, err
		}
		rule.InputWeight, rule.CachedReadWeight, rule.CachedWriteWeight, rule.OutputWeight = in, cr, cw, outW
		out = append(out, rule)
	}
	return out, rows.Err()
}
