#!/usr/bin/env bash
set -euo pipefail

# Issue #164: this reproduces the two negative controls the acceptance
# criteria require (NC-1, NC-2), as accept-time evidence that the tests
# added for #164 actually catch the two holes reviewer found -- not a
# reusable mutation-testing framework, and not wired to any gate (npm
# test, preflight, or otherwise). See the Issue and PR body for why:
# a mutation script proves a test's power once, at the moment it's
# introduced; the test itself is what keeps protecting the property
# afterward. Run it by hand when you need to re-demonstrate that.
#
# Judgment is recorded as one of three values, not just pass/fail:
#   KILLED         the target test(s) failed -> the hole is closed
#   KILLED-BY-TSC  typecheck failed before the test could run -> the
#                  mutation wasn't actually exercised; inconclusive
#   SURVIVED       tsc and vitest both passed -> the hole is open

pipeline_ts="src/pipeline/pipeline.ts"
status_ts="src/pipeline/status.ts"

if [ -n "$(git status --porcelain)" ]; then
  echo "refusing to run: working tree is dirty." >&2
  echo "This script rewrites $pipeline_ts and $status_ts in place, then restores" >&2
  echo "them with \`git checkout --\`. Commit or stash first." >&2
  exit 1
fi

restore() {
  git checkout -- "$pipeline_ts" "$status_ts"
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
    echo "RESULT: $name = KILLED (the added test(s) failed; the hole is closed)"
    cat /tmp/nc-vitest-output.$$
  fi
  rm -f /tmp/nc-vitest-output.$$
}

echo "############################################"
echo "# NC-1: stop notify delivery for input failures only"
echo "############################################"
python3 - "$pipeline_ts" <<'PYEOF'
import sys
path = sys.argv[1]
text = open(path, encoding="utf-8").read()
old1 = '    if (result?.notification?.trigger === "state-transition") {'
new1 = '    if (!outcome.startsWith("failed:input") && result?.notification?.trigger === "state-transition") {'
old2 = '    } else if (result?.notification?.trigger === "notification-state-loss") {'
new2 = '    } else if (!outcome.startsWith("failed:input") && result?.notification?.trigger === "notification-state-loss") {'
for old in (old1, old2):
    if old not in text:
        raise SystemExit(f"NC-1 target line not found: {old!r}")
text = text.replace(old1, new1, 1).replace(old2, new2, 1)
open(path, "w", encoding="utf-8").write(text)
PYEOF
judge "NC-1 (input-failure notify suppressed)" "AC-1"
restore

echo "############################################"
echo "# NC-2: drop normal from stateTransitionTrigger's fromState"
echo "############################################"
python3 - "$status_ts" <<'PYEOF'
import sys
path = sys.argv[1]
text = open(path, encoding="utf-8").read()
old = '  if ((fromState === "unobserved" || fromState === "normal") && toState === "alert") {'
new = '  if (fromState === "unobserved" && toState === "alert") {'
if old not in text:
    raise SystemExit(f"NC-2 target line not found: {old!r}")
open(path, "w", encoding="utf-8").write(text.replace(old, new, 1))
PYEOF
judge "NC-2 (normal -> alert transition dropped)" "AC-2"
restore

echo "############################################"
echo "Done. Both negative controls above must read KILLED for #164's tests"
echo "to be accepted as closing the two holes they target."
echo "############################################"
