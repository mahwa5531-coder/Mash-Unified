#!/usr/bin/env bash
# NexaU Cloud API — production validation runner (spec §2, §39, §40).
#
# Runs the full validation suite (sections 1–40) with the race detector and
# renders VALIDATION_REPORT.md. Environment notes:
#   - Full stack in-process: production API code + OpenAI-compatible mock
#     Bifrost + fault-injectable PG seam fakes + miniredis.
#   - Docker/compose is the production deployment shape (compose.yaml);
#     this runner is the reproducible in-process environment.
#
# Usage:
#   scripts/run_validation.sh              # full suite (race enabled)
#   SHORT=1 scripts/run_validation.sh      # -short mode (skip soaks/loads)

set -euo pipefail
cd "$(dirname "$0")/.."

OUT_DIR="${OUT_DIR:-build}"
mkdir -p "$OUT_DIR"

RACE_FLAG="-race"
SHORT_FLAG=""
if [[ "${SHORT:-0}" == "1" ]]; then
    SHORT_FLAG="-short"
    RACE_FLAG=""
fi

echo "==> Running validation suite (go test ./validation/ $RACE_FLAG $SHORT_FLAG)"
go test ./validation/ -json -count=1 $RACE_FLAG $SHORT_FLAG -timeout 45m \
    2> "$OUT_DIR/validation.stderr.log" \
    | tee "$OUT_DIR/validation.jsonl" > /dev/null || true

echo "==> Unit + integration regression (all packages)"
go test ./... -count=1 -timeout 20m 2>> "$OUT_DIR/validation.stderr.log" \
    | tee "$OUT_DIR/regression.txt" > /dev/null || true

echo "==> Rendering VALIDATION_REPORT.md"
python3 scripts/validation_report.py < "$OUT_DIR/validation.jsonl" > VALIDATION_REPORT.md

echo "==> Done: VALIDATION_REPORT.md"
grep -c "^| " VALIDATION_REPORT.md | xargs -I{} echo "    table rows: {}"
