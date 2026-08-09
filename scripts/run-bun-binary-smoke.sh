#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
temp_root="$(mktemp -d "${TMPDIR:-/tmp}/scale2sheet-smoke.XXXXXX")"
binary="$temp_root/scale2sheet"

cleanup() {
  rm -rf "$temp_root"
}
trap cleanup EXIT

# #168: fail loudly with install guidance rather than skipping if bun is
# missing -- a skip would mean "the binary was not smoke-tested," not "the
# binary behaved correctly" (Issue #126). Matches #128's guard.
if ! command -v bun >/dev/null 2>&1; then
  echo 'bun is required to run acceptance:bun-binary-smoke (part of `npm test`).' >&2
  echo 'Install it with: curl -fsSL https://bun.sh/install | bash' >&2
  echo 'Then restart your shell so `bun` is on PATH, and re-run `npm test`.' >&2
  exit 1
fi

echo "Building Bun single-file executable..."
(cd "$repo_root" && bun build ./src/index.ts --compile --outfile "$binary")

if [ ! -x "$binary" ]; then
  echo "Bun binary was not created or is not executable: $binary" >&2
  exit 1
fi

run_case() {
  local name="$1"
  local expected_status="$2"
  local expected_text="$3"
  shift 3

  local stdout_file="$temp_root/$name.stdout"
  local stderr_file="$temp_root/$name.stderr"
  local status=0

  echo "Running smoke case: $name"
  "$@" >"$stdout_file" 2>"$stderr_file" || status=$?

  if [ "$status" -ne "$expected_status" ]; then
    echo "Case '$name' exited with $status, expected $expected_status" >&2
    echo "--- stdout ---" >&2
    cat "$stdout_file" >&2
    echo "--- stderr ---" >&2
    cat "$stderr_file" >&2
    exit 1
  fi

  if ! grep -Fq "$expected_text" "$stdout_file" "$stderr_file"; then
    echo "Case '$name' did not contain expected text: $expected_text" >&2
    echo "--- stdout ---" >&2
    cat "$stdout_file" >&2
    echo "--- stderr ---" >&2
    cat "$stderr_file" >&2
    exit 1
  fi
}

isolated_env() {
  local home_dir="$1"
  local output_dir="$2"
  shift 2

  (
    cd "$home_dir"
    env -i \
      HOME="$home_dir" \
      PATH="${PATH:-/usr/bin:/bin}" \
      TMPDIR="${TMPDIR:-/tmp}" \
      SCALE_EXPORTER_OUTPUT_DIR="$output_dir" \
      "$@"
  )
}

empty_home="$temp_root/empty-home"
empty_output="$temp_root/empty-output"
mkdir -p "$empty_home" "$empty_output"

run_case "help" 0 "Usage:" "$binary" --help
run_case "version" 0 "0.1.0" "$binary" --version

# #168: `run` now validates the Sheets config at startup (#47/#51, #148),
# before ever reading input, so this no-data case needs sheet-id and
# sheets-credentials even though it never reaches a real Sheets write.
# scale-exporter-output-dir is unaffected -- isolated_env already passes it
# via SCALE_EXPORTER_OUTPUT_DIR. Neither value below is real (sheet-id is
# not the production Spreadsheet ID 163Lc0YeN5Zn...).
mkdir -p "$empty_home/.config/scale2sheet"
cat >"$empty_home/.config/scale2sheet/settings.json" <<'JSON'
{
  "sheet-id": "acceptance-fixture-not-a-real-spreadsheet",
  "sheets-credentials": "/nonexistent/acceptance-fixture-credentials.json"
}
JSON

run_case "empty-scale-exporter" 0 "No spreadsheet row updated." \
  isolated_env "$empty_home" "$empty_output" \
  "$binary" run --period morning --source scale-exporter

invalid_settings_home="$temp_root/invalid-settings-home"
invalid_settings_output="$temp_root/invalid-settings-output"
mkdir -p "$invalid_settings_home/.config/scale2sheet" "$invalid_settings_output"
cat >"$invalid_settings_home/.config/scale2sheet/settings.json" <<'JSON'
{
  "source": "invalid"
}
JSON

run_case "invalid-settings-source" 1 "invalid settings file" \
  isolated_env "$invalid_settings_home" "$invalid_settings_output" \
  "$binary" run --period morning --source scale-exporter

invalid_reading_home="$temp_root/invalid-reading-home"
invalid_reading_output="$temp_root/invalid-reading-output"
mkdir -p "$invalid_reading_home/.config/scale2sheet" "$invalid_reading_output"
cat >"$invalid_reading_home/.config/scale2sheet/settings.json" <<'JSON'
{
  "time-zone": "Asia/Tokyo",
  "source": "scale-exporter",
  "sheet-name": "体温・血圧",
  "scale-exporter-output-dir": "__OUTPUT_DIR__",
  "sheet-id": "acceptance-fixture-not-a-real-spreadsheet",
  "sheets-credentials": "/nonexistent/acceptance-fixture-credentials.json"
}
JSON
perl -0pi -e "s#__OUTPUT_DIR__#$invalid_reading_output#g" \
  "$invalid_reading_home/.config/scale2sheet/settings.json"
cat >"$invalid_reading_output/scale_exporter_2026-06-18_apple-health_001.jsonl" <<'JSONL'
{"measuredAt":"2026-06-18T06:50:00+09:00","kind":"steps","value":100,"unit":"kg","source":"apple_health"}
JSONL

run_case "invalid-scale-exporter-reading" 1 "invalid reading" \
  isolated_env "$invalid_reading_home" "$invalid_reading_output" \
  "$binary" run --period morning --source scale-exporter --date 2026-06-18

valid_weight_home="$temp_root/valid-weight-home"
valid_weight_output="$temp_root/valid-weight-output"
mkdir -p "$valid_weight_home/.config/scale2sheet" "$valid_weight_output"
cat >"$valid_weight_home/.config/scale2sheet/settings.json" <<'JSON'
{
  "time-zone": "Asia/Tokyo",
  "source": "scale-exporter",
  "sheet-name": "体温・血圧",
  "scale-exporter-output-dir": "__OUTPUT_DIR__"
}
JSON
perl -0pi -e "s#__OUTPUT_DIR__#$valid_weight_output#g" \
  "$valid_weight_home/.config/scale2sheet/settings.json"
cat >"$valid_weight_output/scale_exporter_2026-06-18_apple-health_001.jsonl" <<'JSONL'
{"measuredAt":"2026-06-18T06:50:00+09:00","kind":"weight","value":70.2,"unit":"kg","source":"apple_health"}
JSONL

run_case "valid-weight-missing-sheets-credentials" 1 "Google Sheets requires both sheet-id and sheets-credentials" \
  isolated_env "$valid_weight_home" "$valid_weight_output" \
  "$binary" run --period morning --source scale-exporter --date 2026-06-18

echo "All Bun binary smoke cases passed."
