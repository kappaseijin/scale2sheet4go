#!/usr/bin/env bash
set -euo pipefail

# Canonical local acceptance entry point for the current Go product path.
# Every child script owns its isolated HOME/fixtures and builds its own Go
# binary, so this runner must not add a shared dist/ or credential fallback.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "ERROR: Go acceptance matrix requires macOS (Darwin)" >&2
  exit 2
fi

acceptance_scripts=(
  scripts/run-pipeline-shadow-acceptance.sh
  scripts/run-google-sheets-deadline-acceptance.sh
  scripts/run-installer-acceptance.sh
  scripts/run-runtime-safety-acceptance.sh
  scripts/run-binary-source-drift-acceptance.sh
  scripts/run-bun-binary-smoke.sh
  scripts/run-macos-release-acceptance.sh
  scripts/run-macos-distribution-contract-acceptance.sh
)

for relative_script in "${acceptance_scripts[@]}"; do
  script_path="$repo_root/$relative_script"
  if [[ ! -f "$script_path" ]]; then
    echo "ERROR: acceptance script is missing: $relative_script" >&2
    exit 1
  fi

  echo "=== RUN $relative_script ==="
  (cd "$repo_root" && bash "$script_path")
  echo "=== PASS $relative_script ==="
done

echo "PASS: complete current Go acceptance matrix (${#acceptance_scripts[@]} scripts)"
