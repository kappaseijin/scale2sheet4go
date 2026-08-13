#!/usr/bin/env bash
set -euo pipefail

# Run real Google acceptance cases only against an explicitly marked, isolated
# environment.  This script deliberately does not print child stdout/stderr:
# those streams may contain OAuth URLs, provider diagnostics, or configured
# paths.  A command-boundary PASS still requires manual external observation
# of Spreadsheet cells, Google Fit data, or cron callbacks.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
runner_version="1"
root="$(mktemp -d "${TMPDIR:-/tmp}/scale2sheet-google-external.XXXXXX")"
child_pid=""

cleanup() {
  if [ -n "$child_pid" ] && kill -0 "$child_pid" 2>/dev/null; then
    kill -TERM "$child_pid" 2>/dev/null || true
    wait "$child_pid" 2>/dev/null || true
  fi
  rm -rf "$root"
}
trap cleanup EXIT

usage() {
  cat <<'USAGE'
Usage: scripts/run-google-external-acceptance.sh CASE

CASE is one of: at-01 at-02 at-03 at-04 at-05 at-06 all

The runner requires the documented SCALE2SHEET_EXTERNAL_* variables, an
isolated HOME marker, a dedicated Spreadsheet, and owner-only credentials.
It never selects the current user's scale2sheet configuration automatically.
USAGE
}

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

case_id="${1:-}"
case "$case_id" in
  -h|--help)
    usage
    exit 0
    ;;
  at-01|at-02|at-03|at-04|at-05|at-06|all)
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

if [ "$(uname -s)" != 'Darwin' ]; then
  fail 'macOS (Darwin) is required for Google external acceptance'
fi
if ! command -v python3 >/dev/null 2>&1; then
  fail 'python3 is required for the external acceptance boundary'
fi

if [ "${SCALE2SHEET_EXTERNAL_ACCEPTANCE:-}" != '1' ]; then
  fail 'SCALE2SHEET_EXTERNAL_ACCEPTANCE=1 is required'
fi

external_home_input="${SCALE2SHEET_EXTERNAL_HOME:-}"
sheet_id="${SCALE2SHEET_EXTERNAL_SHEET_ID:-}"
credentials_path="${SCALE2SHEET_EXTERNAL_SHEETS_CREDENTIALS:-}"
input_dir_input="${SCALE2SHEET_EXTERNAL_INPUT_DIR:-}"
binary_input="${SCALE2SHEET_EXTERNAL_BINARY:-$repo_root/dist/scale2sheet}"
sheet_name="${SCALE2SHEET_EXTERNAL_SHEET_NAME:-体温・血圧}"
external_date="${SCALE2SHEET_EXTERNAL_DATE:-$(TZ=Asia/Tokyo date +%F)}"
past_date="${SCALE2SHEET_EXTERNAL_PAST_DATE:-}"
serve_cron="${SCALE2SHEET_EXTERNAL_SERVE_CRON:-}"
serve_seconds="${SCALE2SHEET_EXTERNAL_SERVE_SECONDS:-}"
fit_client_id="${GOOGLE_FIT_CLIENT_ID:-}"
fit_client_secret="${GOOGLE_FIT_CLIENT_SECRET:-}"

if [ -z "$external_home_input" ]; then
  fail 'SCALE2SHEET_EXTERNAL_HOME is required'
fi
if [ -z "$sheet_id" ]; then
  fail 'SCALE2SHEET_EXTERNAL_SHEET_ID is required'
fi
if [ -z "$credentials_path" ]; then
  fail 'SCALE2SHEET_EXTERNAL_SHEETS_CREDENTIALS is required'
fi

case "$external_home_input" in
  /*) ;;
  *) fail 'SCALE2SHEET_EXTERNAL_HOME must be an absolute path' ;;
esac
case "$credentials_path" in
  /*) ;;
  *) fail 'SCALE2SHEET_EXTERNAL_SHEETS_CREDENTIALS must be an absolute path' ;;
esac
case "$binary_input" in
  /*) ;;
  *) fail 'SCALE2SHEET_EXTERNAL_BINARY must be an absolute path' ;;
esac

if [ -z "${HOME:-}" ]; then
  fail 'current HOME is required to establish the safety boundary'
fi
current_home="$(cd "$HOME" 2>/dev/null && pwd -P)" || fail 'current HOME is not accessible'
external_home="$(cd "$external_home_input" 2>/dev/null && pwd -P)" || fail 'external HOME must already exist'
if [ "$external_home" = "$current_home" ]; then
  fail 'external HOME must differ from current HOME'
fi
case "$external_home" in
  "$current_home"/*) fail 'external HOME must not be inside current HOME' ;;
esac

python3 - "$external_home" <<'PY'
import pathlib
import stat
import sys

path = pathlib.Path(sys.argv[1])
mode = stat.S_IMODE(path.stat().st_mode)
if mode & 0o077:
    print("external HOME requires owner-only permissions", file=sys.stderr)
    raise SystemExit(1)
marker = path / ".scale2sheet-external-acceptance"
if marker.is_symlink() or not marker.is_file():
    print("external HOME marker is missing or invalid", file=sys.stderr)
    raise SystemExit(1)
if stat.S_IMODE(marker.stat().st_mode) & 0o077:
    print("external HOME marker requires owner-only permissions", file=sys.stderr)
    raise SystemExit(1)
if marker.read_text(encoding="utf-8").strip() != "scale2sheet-external-acceptance-v1":
    print("external HOME marker is missing or invalid", file=sys.stderr)
    raise SystemExit(1)
PY

case "$sheet_id" in
  *fixture*|*placeholder*|*not-a-real*|*acceptance*)
    fail 'Spreadsheet ID looks like a fixture'
    ;;
esac
if ! printf '%s' "$sheet_id" | LC_ALL=C grep -Eq '^[A-Za-z0-9_-]{20,}$'; then
  fail 'Spreadsheet ID has an invalid format'
fi

python3 - "$credentials_path" "$current_home" <<'PY'
import json
import pathlib
import stat
import sys

path = pathlib.Path(sys.argv[1])
current_home = pathlib.Path(sys.argv[2])
if path.is_symlink():
    print("credentials file must not be a symlink", file=sys.stderr)
    raise SystemExit(1)
try:
    resolved = path.resolve(strict=True)
except FileNotFoundError:
    print("credentials file is missing", file=sys.stderr)
    raise SystemExit(1)
try:
    resolved.relative_to(current_home)
except ValueError:
    pass
else:
    print("credentials file must not be under current HOME", file=sys.stderr)
    raise SystemExit(1)
mode = stat.S_IMODE(resolved.stat().st_mode)
if mode & 0o077:
    print("credentials file requires owner-only permissions", file=sys.stderr)
    raise SystemExit(1)
try:
    document = json.loads(resolved.read_text(encoding="utf-8"))
except (OSError, ValueError):
    print("credentials file is not valid JSON", file=sys.stderr)
    raise SystemExit(1)
if document.get("type") != "service_account" or not document.get("private_key"):
    print("credentials file is not a service-account key", file=sys.stderr)
    raise SystemExit(1)
PY

if [ ! -x "$binary_input" ]; then
  fail 'selected Go binary is missing or not executable'
fi
binary_path="$(cd "$(dirname "$binary_input")" && pwd -P)/$(basename "$binary_input")"

requires_input_dir() {
  case "$1" in
    at-01|at-02|at-03|at-05|all) return 0 ;;
    *) return 1 ;;
  esac
}

if requires_input_dir "$case_id"; then
  if [ -z "$input_dir_input" ]; then
    fail 'SCALE2SHEET_EXTERNAL_INPUT_DIR is required for this case'
  fi
  case "$input_dir_input" in
    /*) ;;
    *) fail 'SCALE2SHEET_EXTERNAL_INPUT_DIR must be an absolute path' ;;
  esac
  input_dir="$(cd "$input_dir_input" 2>/dev/null && pwd -P)" || fail 'external input directory must already exist'
  case "$input_dir" in
    "$current_home"|"$current_home"/*) fail 'external input directory must not be under current HOME' ;;
  esac
else
  input_dir=""
  if [ -n "$input_dir_input" ]; then
    case "$input_dir_input" in
      /*) ;;
      *) fail 'SCALE2SHEET_EXTERNAL_INPUT_DIR must be an absolute path' ;;
    esac
    input_dir="$(cd "$input_dir_input" 2>/dev/null && pwd -P)" || fail 'external input directory must already exist'
  fi
fi

valid_date() {
  python3 - "$1" <<'PY'
import datetime
import sys

try:
    datetime.date.fromisoformat(sys.argv[1])
except ValueError:
    raise SystemExit(1)
PY
}

if ! valid_date "$external_date"; then
  fail 'SCALE2SHEET_EXTERNAL_DATE must be YYYY-MM-DD'
fi
if [ "$case_id" = 'at-03' ] || [ "$case_id" = 'all' ]; then
  if [ -z "$past_date" ]; then
    fail 'SCALE2SHEET_EXTERNAL_PAST_DATE is required for AT-03'
  fi
  if ! valid_date "$past_date"; then
    fail 'SCALE2SHEET_EXTERNAL_PAST_DATE must be YYYY-MM-DD'
  fi
fi

if [ "$case_id" = 'at-05' ] || [ "$case_id" = 'all' ]; then
  if [ -z "$serve_cron" ]; then
    fail 'SCALE2SHEET_EXTERNAL_SERVE_CRON is required for AT-05'
  fi
  case "$serve_seconds" in
    ''|*[!0-9]*) fail 'SCALE2SHEET_EXTERNAL_SERVE_SECONDS must be a positive integer' ;;
    0) fail 'SCALE2SHEET_EXTERNAL_SERVE_SECONDS must be a positive integer' ;;
  esac
  if [ "$serve_seconds" -gt 3600 ]; then
    fail 'SCALE2SHEET_EXTERNAL_SERVE_SECONDS must not exceed 3600'
  fi
fi

config_dir="$external_home/.config/scale2sheet"
settings_path="$config_dir/settings.json"
token_path="$config_dir/google-fit-token.json"
results_path="$config_dir/external-acceptance-results.jsonl"
config_parent="$external_home/.config"
if [ -e "$config_parent" ]; then
  [ ! -L "$config_parent" ] || fail 'external config parent must not be a symlink'
  [ -d "$config_parent" ] || fail 'external config parent is not a directory'
else
  mkdir -m 700 "$config_parent"
fi
python3 - "$config_parent" <<'PY'
import pathlib
import stat
import sys

path = pathlib.Path(sys.argv[1])
if stat.S_IMODE(path.stat().st_mode) & 0o077:
    print("external config parent requires owner-only permissions", file=sys.stderr)
    raise SystemExit(1)
PY
if [ -e "$config_dir" ]; then
  [ ! -L "$config_dir" ] || fail 'external scale2sheet config path must not be a symlink'
  [ -d "$config_dir" ] || fail 'external scale2sheet config path is not a directory'
else
  mkdir -m 700 "$config_dir"
fi
python3 - "$config_dir" <<'PY'
import pathlib
import stat
import sys

path = pathlib.Path(sys.argv[1])
if stat.S_IMODE(path.stat().st_mode) & 0o077:
    print("external scale2sheet config directory requires owner-only permissions", file=sys.stderr)
    raise SystemExit(1)
PY

if [ -e "$settings_path" ]; then
  [ ! -L "$settings_path" ] || fail 'external settings file must not be a symlink'
  python3 - "$settings_path" "$sheet_id" "$credentials_path" "$input_dir" <<'PY'
import json
import pathlib
import stat
import sys

path = pathlib.Path(sys.argv[1])
expected_sheet_id = sys.argv[2]
expected_credentials = sys.argv[3]
expected_input = sys.argv[4]
if stat.S_IMODE(path.stat().st_mode) & 0o077:
    print("external settings file requires owner-only permissions", file=sys.stderr)
    raise SystemExit(1)
try:
    settings = json.loads(path.read_text(encoding="utf-8"))
except (OSError, ValueError):
    print("external settings file is not valid JSON", file=sys.stderr)
    raise SystemExit(1)
if settings.get("sheet-id") != str(expected_sheet_id):
    print("external settings sheet does not match the selected test Spreadsheet", file=sys.stderr)
    raise SystemExit(1)
if settings.get("sheets-credentials") != str(expected_credentials):
    print("external settings credential does not match the selected test key", file=sys.stderr)
    raise SystemExit(1)
if expected_input and settings.get("scale-exporter-output-dir") not in (expected_input, None):
    print("external settings input directory does not match the selected test input", file=sys.stderr)
    raise SystemExit(1)
PY
else
  python3 - "$settings_path" "$sheet_id" "$sheet_name" "$credentials_path" "$input_dir" <<'PY'
import json
import os
import pathlib
import sys

path, sheet_id, sheet_name, credentials, input_dir = sys.argv[1:]
settings = {
    "time-zone": "Asia/Tokyo",
    "source": "scale-exporter",
    "sheet-id": sheet_id,
    "sheet-name": sheet_name,
    "sheets-credentials": credentials,
}
if input_dir:
    settings["scale-exporter-output-dir"] = input_dir
encoded = json.dumps(settings, ensure_ascii=False, indent=2) + "\n"
pathlib.Path(path).write_text(encoded, encoding="utf-8")
os.chmod(path, 0o600)
PY
fi

validate_fit_credentials() {
  if [ -z "$fit_client_id" ] || [ -z "$fit_client_secret" ]; then
    fail 'GOOGLE_FIT_CLIENT_ID and GOOGLE_FIT_CLIENT_SECRET are required for this case'
  fi
}

validate_token() {
  python3 - "$token_path" <<'PY'
import json
import pathlib
import stat
import sys

path = pathlib.Path(sys.argv[1])
if not path.is_file():
    print("Google Fit token is missing in the isolated HOME", file=sys.stderr)
    raise SystemExit(1)
if path.is_symlink() or stat.S_IMODE(path.stat().st_mode) & 0o077:
    print("Google Fit token requires an owner-only regular file", file=sys.stderr)
    raise SystemExit(1)
try:
    document = json.loads(path.read_text(encoding="utf-8"))
except (OSError, ValueError):
    print("Google Fit token is not valid JSON", file=sys.stderr)
    raise SystemExit(1)
if not document.get("access_token") and not document.get("refresh_token"):
    print("Google Fit token has no usable token value", file=sys.stderr)
    raise SystemExit(1)
PY
}

if [ "$case_id" = 'at-04' ]; then
  validate_fit_credentials
  validate_token
elif [ "$case_id" = 'at-06' ]; then
  validate_fit_credentials
elif [ "$case_id" = 'all' ]; then
  validate_fit_credentials
fi

base_env=(
  "HOME=$external_home"
  'PATH=/usr/bin:/bin'
  'LANG=C'
  'TIME_ZONE=Asia/Tokyo'
  "GOOGLE_SHEET_ID=$sheet_id"
  "GOOGLE_SHEET_NAME=$sheet_name"
  "GOOGLE_APPLICATION_CREDENTIALS=$credentials_path"
  "GOOGLE_FIT_TOKEN_PATH=$token_path"
)
if [ -n "$input_dir" ]; then
  base_env+=("SCALE_EXPORTER_OUTPUT_DIR=$input_dir")
fi
if [ -n "$fit_client_id" ]; then
  base_env+=("GOOGLE_FIT_CLIENT_ID=$fit_client_id")
fi
if [ -n "$fit_client_secret" ]; then
  base_env+=("GOOGLE_FIT_CLIENT_SECRET=$fit_client_secret")
fi

record_result() {
  local label="$1"
  local state="$2"
  python3 - "$results_path" "$runner_version" "$label" "$state" <<'PY'
import datetime
import json
import os
import pathlib
import sys
from zoneinfo import ZoneInfo

path, version, label, state = sys.argv[1:]
pathlib.Path(path).parent.mkdir(mode=0o700, parents=True, exist_ok=True)
if pathlib.Path(path).exists() and os.stat(path).st_mode & 0o077:
    print("external acceptance result file requires owner-only permissions", file=sys.stderr)
    raise SystemExit(1)
record = {
    "runnerVersion": version,
    "case": label,
    "state": state,
    "recordedAt": datetime.datetime.now(ZoneInfo("Asia/Tokyo")).isoformat(timespec="seconds"),
}
with open(path, "a", encoding="utf-8") as handle:
    handle.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
os.chmod(path, 0o600)
PY
}

run_child() {
  local label="$1"
  shift
  local log="$root/${label}.log"
  set +e
  env -i "${base_env[@]}" "$binary_path" "$@" >"$log" 2>&1
  local status=$?
  set -e
  if [ "$status" -ne 0 ]; then
    record_result "$label" command-failed
    fail "$label command failed"
  fi
  record_result "$label" command-completed
  echo "PASS: $label command completed; external observation remains required"
}

run_at_05() {
  local log="$root/at-05.log"
  local serve_env=("${base_env[@]}" "MORNING_CRON=$serve_cron" "EVENING_CRON=$serve_cron")
  local termination_watchdog_pid=""
  env -i "${serve_env[@]}" "$binary_path" serve >"$log" 2>&1 &
  child_pid=$!

  local started=0
  for _ in $(seq 1 100); do
    if ! kill -0 "$child_pid" 2>/dev/null; then
      break
    fi
    if [ -f "$external_home/.config/scale2sheet/active-run.json" ]; then
      started=1
      break
    fi
    sleep 0.1
  done
  if [ "$started" -ne 1 ]; then
    kill -TERM "$child_pid" 2>/dev/null || true
    wait "$child_pid" 2>/dev/null || true
    child_pid=""
    record_result AT-05 startup-failed
    fail 'AT-05 serve did not publish an isolated active-run receipt'
  fi

  for _ in $(seq 1 "$serve_seconds"); do
    if ! kill -0 "$child_pid" 2>/dev/null; then
      child_pid=""
      record_result AT-05 process-exited
      fail 'AT-05 serve exited before the observation window ended'
    fi
    sleep 1
  done

  kill -TERM "$child_pid" 2>/dev/null || true
  (
    sleep 10
    if kill -0 "$child_pid" 2>/dev/null; then
      kill -KILL "$child_pid" 2>/dev/null || true
      touch "$root/at-05-termination-timeout"
    fi
  ) &
  termination_watchdog_pid=$!
  set +e
  wait "$child_pid"
  local status=$?
  set -e
  kill "$termination_watchdog_pid" 2>/dev/null || true
  wait "$termination_watchdog_pid" 2>/dev/null || true
  child_pid=""
  if [ -e "$root/at-05-termination-timeout" ]; then
    record_result AT-05 termination-timeout
    fail 'AT-05 serve did not terminate within the termination bound'
  fi
  if [ "$status" -ne 0 ]; then
    record_result AT-05 command-failed
    fail 'AT-05 serve did not terminate successfully'
  fi
  for _ in $(seq 1 50); do
    if [ ! -e "$external_home/.config/scale2sheet/active-run.json" ]; then
      break
    fi
    sleep 0.1
  done
  if [ -e "$external_home/.config/scale2sheet/active-run.json" ]; then
    record_result AT-05 lease-not-released
    fail 'AT-05 serve left an active-run receipt after SIGTERM'
  fi
  record_result AT-05 command-completed
  echo 'PASS: AT-05 serve started and released its lease; external cron observation remains required'
}

run_case() {
  case "$1" in
    at-01)
      run_child AT-01 run --period morning --date "$external_date"
      ;;
    at-02)
      run_child AT-02 run --period evening --date "$external_date"
      ;;
    at-03)
      run_child AT-03 run --period morning --date "$past_date"
      ;;
    at-04)
      run_child AT-04 run --period morning --source google-fit --date "$external_date"
      validate_token
      ;;
    at-05)
      run_at_05
      ;;
    at-06)
      run_child AT-06 auth
      validate_token
      ;;
    *)
      fail "unsupported case: $1"
      ;;
  esac
}

if [ "$case_id" = 'all' ]; then
  run_case at-06
  validate_token
  run_case at-04
  run_case at-01
  run_case at-02
  run_case at-03
  run_case at-05
else
  run_case "$case_id"
fi

echo 'PASS: requested external command boundaries completed; inspect the dedicated external system before marking AT PASS'
