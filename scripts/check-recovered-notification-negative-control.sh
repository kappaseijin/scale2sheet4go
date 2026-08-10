#!/usr/bin/env bash
set -euo pipefail

# Issue #165: accept-time evidence that the AC-1/AC-2 test actually catches
# the B-1 regression (delivery reverted to only the run's own period,
# reproducing the pre-fix bug where the other period's recovered alert was
# recorded as claimed but never sent). Not a reusable mutation framework,
# not wired to npm test/preflight -- same reasoning as #164's negative
# control script: this proves the test's power once, at accept time; the
# test itself is what protects the property afterward.
#
# Judgment is recorded as one of three values:
#   KILLED         the target test failed -> the hole is closed
#   KILLED-BY-TSC  typecheck failed before the test could run -> inconclusive
#   SURVIVED       tsc and vitest both passed -> the hole is open
# Manual negative control; not called from preflight.
# Corresponding tests: test/pipeline/pipeline.test.ts:593-651.
# Run this mutation when those tests are suspect and confirm KILLED.

pipeline_ts="src/pipeline/pipeline.ts"

if [ -n "$(git status --porcelain)" ]; then
  echo "refusing to run: working tree is dirty." >&2
  echo "This script rewrites $pipeline_ts in place, then restores it with" >&2
  echo "\`git checkout --\`. Commit or stash first." >&2
  exit 1
fi

restore() {
  git checkout -- "$pipeline_ts"
}
trap restore EXIT

judge() {
  local name="$1"
  local test_filter="$2"
  echo "--- $name ---"
  if ! npx tsc --noEmit; then
    echo "RESULT: $name = KILLED-BY-TSC (typecheck failed; mutation not exercised)"
    return
  fi
  if npx vitest run test/pipeline/pipeline.test.ts -t "$test_filter" >/tmp/nc-vitest-output.$$ 2>&1; then
    echo "RESULT: $name = SURVIVED (tsc and vitest both passed; the hole is open)"
    cat /tmp/nc-vitest-output.$$
  else
    echo "RESULT: $name = KILLED (the added test failed; the hole is closed)"
    cat /tmp/nc-vitest-output.$$
  fi
  rm -f /tmp/nc-vitest-output.$$
}

echo "############################################"
echo "# NC: revert delivery to only options.period (the pre-#165 bug)"
echo "############################################"
python3 - "$pipeline_ts" <<'PYEOF'
import sys
path = sys.argv[1]
text = open(path, encoding="utf-8").read()
old = "    for (const entry of result?.notifications ?? []) {"
new = '    for (const entry of (result?.notifications ?? []).filter((e) => e.period === options.period)) {'
if old not in text:
    raise SystemExit(f"NC target line not found: {old!r}")
open(path, "w", encoding="utf-8").write(text.replace(old, new, 1))
PYEOF
judge "NC (delivery reverted to run's own period only)" "AC-1/AC-2, #165"
restore

echo "############################################"
echo "Done. The result above must read KILLED for #165's test to be accepted"
echo "as closing the hole it targets."
echo "############################################"
