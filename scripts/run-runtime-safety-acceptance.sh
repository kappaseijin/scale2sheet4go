#!/usr/bin/env bash
set -euo pipefail

# Compiled-Go acceptance for the Darwin O_EXLOCK kernel contract.
# It never uses the real HOME, prefix, launchd, or network credentials.

root=$(mktemp -d /private/tmp/scale2sheet-runtime-safety.XXXXXX)
holder_pid=""
conflict_pid=""
# #188: a concurrent full test run observed startup at 9.25s. 60 seconds is
# an abnormality bound for a living holder, not the expected startup speed.
holder_startup_attempts=1200

cleanup() {
  stop_process "$conflict_pid"
  stop_process "$holder_pid"
  rm -rf "$root"
}
trap cleanup EXIT

stop_process() {
  local pid=${1:-}
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
}

dump_diagnostic_file() {
  local label="$1"
  local file_path="$2"
  echo "--- ${label} ---" >&2
  if [ -e "$file_path" ]; then
    cat "$file_path" >&2
  else
    echo "(absent: ${file_path})" >&2
  fi
}

# Keep this freshly compiled acceptance binary isolated from checkout dist/.
binary="$root/scale2sheet"
CGO_ENABLED=0 GOTOOLCHAIN=local go build -o "$binary" ./cmd/scale2sheet
home="$root/home"
scale_exporter_output_dir="$root/scale-exporter-output"
mkdir -p "$home" "$scale_exporter_output_dir"

# #168: `serve` now validates both the Sheets config and the selected
# source's own config at startup (#47/#51, #148), before ever scheduling
# anything -- this harness never reaches a real Sheets write or a real
# scale_exporter read (it only exercises the O_EXLOCK lease contract), but
# without a settings.json it now fails before "Scheduler started" is ever
# printed. Neither value here is real: the Spreadsheet ID is not the
# production one (163Lc0YeN5Zn...), and the output dir is an empty,
# isolated directory serve's scheduled cron never actually fires against
# in this harness's short lifetime.
mkdir -p "$home/.config/scale2sheet"
cat >"$home/.config/scale2sheet/settings.json" <<SETTINGSEOF
{
  "sheet-id": "acceptance-fixture-not-a-real-spreadsheet",
  "sheets-credentials": "/nonexistent/acceptance-fixture-credentials.json",
  "scale-exporter-output-dir": "$scale_exporter_output_dir"
}
SETTINGSEOF

run_compiled() {
  env -i HOME="$home" PATH="/usr/bin:/bin" \
    http_proxy="http://127.0.0.1:9" https_proxy="http://127.0.0.1:9" \
    "$binary" serve
}

start_compiled() {
  env -i HOME="$home" PATH="/usr/bin:/bin" \
    http_proxy="http://127.0.0.1:9" https_proxy="http://127.0.0.1:9" \
    "$binary" serve >"$1" 2>&1 &
  holder_pid=$!
}

start_compiled "$root/holder.log"

for _ in $(seq 1 "$holder_startup_attempts"); do
  if grep -q 'Scheduler started' "$root/holder.log"; then
    break
  fi
  if ! kill -0 "$holder_pid" 2>/dev/null; then
    dump_diagnostic_file "serve holder log" "$root/holder.log"
    exit 1
  fi
  sleep 0.05
done

if ! grep -q 'Scheduler started' "$root/holder.log"; then
  echo 'holder did not acquire run lease' >&2
  dump_diagnostic_file "serve holder log" "$root/holder.log"
  exit 1
fi

run_compiled >"$root/conflict.log" 2>&1 &
conflict_pid=$!
conflict_status=""
for _ in $(seq 1 100); do
  if ! kill -0 "$conflict_pid" 2>/dev/null; then
    if wait "$conflict_pid"; then
      conflict_status=0
    else
      conflict_status=$?
    fi
    break
  fi
  sleep 0.1
done
if [ -z "$conflict_status" ]; then
  kill -KILL "$conflict_pid" 2>/dev/null || true
  wait "$conflict_pid" 2>/dev/null || true
  conflict_pid=""
  echo 'second compiled process kept running: exclusive lock is not enforced' >&2
  exit 1
fi
conflict_pid=""
if [ "$conflict_status" -eq 0 ] || ! grep -Eq 'run lease is active|EAGAIN|EWOULDBLOCK|RunLeaseConflictError' "$root/conflict.log"; then
  echo 'second compiled process did not report lock conflict' >&2
  cat "$root/conflict.log" >&2
  exit 1
fi

kill -KILL "$holder_pid"
wait "$holder_pid" 2>/dev/null || true
holder_pid=""

start_compiled "$root/reacquired.log"
for _ in $(seq 1 "$holder_startup_attempts"); do
  if grep -q 'Scheduler started' "$root/reacquired.log"; then
    break
  fi
  if ! kill -0 "$holder_pid" 2>/dev/null; then
    dump_diagnostic_file "reacquired serve log" "$root/reacquired.log"
    exit 1
  fi
  sleep 0.05
done

if ! grep -q 'Scheduler started' "$root/reacquired.log"; then
  echo 'compiled process did not acquire lease after SIGKILL release' >&2
  dump_diagnostic_file "reacquired serve log" "$root/reacquired.log"
  exit 1
fi

echo 'PASS: compiled Go two-process EAGAIN/EWOULDBLOCK conflict and SIGKILL release'
