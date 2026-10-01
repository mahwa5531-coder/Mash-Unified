#!/usr/bin/env bash
# Full validation suite, grouped so each invocation fits a 10-minute window.
# Usage: scripts/run_full_validation_grouped.sh <group-key>   (g1..g12|regression|render)
set -uo pipefail
cd /home/z/my-project/nexau-api
export PATH=/home/z/my-project/tools/go/bin:$PATH
export GOTOOLCHAIN=local
mkdir -p build

case "${1:-}" in
  g1)  RUN='TestV03_|TestV04_|TestV05_|TestV06_|TestV07_' ;;
  g2)  RUN='TestV08_|TestV09_|TestV10_|TestV11_|TestV12_|TestV13_' ;;
  g3)  RUN='TestV14_|TestV15_|TestV16_|TestV17_|TestV18_' ;;
  g4)  RUN='TestV19_|TestV20_|TestV21_' ;;
  g5)  RUN='TestV22_' ;;
  g6)  RUN='TestV23_|TestV24_' ;;
  g7)  RUN='TestV25_|TestV26_|TestV27_|TestV28_|TestV29_' ;;
  g8)  RUN='TestV30_|TestV31_|TestV32_|TestV33_|TestV34_' ;;
  g9)  RUN='TestV35_|TestV36_|TestV37_|TestV38_|TestV39_' ;;
  g10) RUN='TestV41_|TestV42_' ;;
  g11) RUN='TestV43_|TestV44_|TestV45_' ;;
  g12) RUN='TestVCap' ;;
  regression)
    echo "[$(date +%H:%M:%S)] package regression (all packages, no race)"
    go test ./... -count=1 -timeout 20m > build/regression.txt 2>&1
    rc=$?
    echo "[$(date +%H:%M:%S)] regression exit=$rc"
    tail -5 build/regression.txt
    exit $rc ;;
  render)
    cat build/g1.json build/g2.json build/g3.json build/g4.json build/g5.json \
        build/g6.json build/g7.json build/g8.json build/g9.json build/g10.json \
        build/g11.json build/g12.json > build/validation.jsonl 2>/dev/null
    python3 scripts/validation_report.py < build/validation.jsonl > VALIDATION_REPORT.md
    echo "REPORT_RENDERED"
    rg -c "PASS" VALIDATION_REPORT.md || true
    exit 0 ;;
  *) echo "usage: $0 <g1..g12|regression|render>"; exit 2 ;;
esac

echo "[$(date +%H:%M:%S)] group $1 starting ($RUN)"
go test ./validation/ -json -race -count=1 -timeout 25m -run "$RUN" \
  > "build/$1.json" 2> "build/$1.err"
rc=$?
echo "[$(date +%H:%M:%S)] group $1 exit=$rc"
# print a compact pass/fail summary from the json stream
python3 - "$1" <<'EOF'
import json, sys, collections
g = sys.argv[1]
res = collections.Counter()
fails = []
for line in open(f"build/{g}.json"):
    try: ev = json.loads(line)
    except Exception: continue
    if ev.get("Test") and ev.get("Action") in ("pass", "fail"):
        res[ev["Action"]] += 1
        if ev["Action"] == "fail":
            fails.append(ev["Test"])
print(f"  {g}: {dict(res) or 'NO RESULTS'}")
if fails: print("  FAILED:", ", ".join(fails))
EOF
exit $rc
