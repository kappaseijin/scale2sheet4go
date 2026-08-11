#!/usr/bin/env bash
set -euo pipefail

# Compiled-Bun acceptance for #280. It proves the production GoogleAuth
# transport is reached through a TCP blackhole, the 30-second adapter deadline
# aborts that request, and the pipeline's finally releases its run lease.

root=$(mktemp -d /private/tmp/scale2sheet-google-sheets-deadline.XXXXXX)
child_pid=""
blackhole_pid=""
watchdog_pid=""
phase_log="$root/phases.tsv"

stop_process() {
  local pid=${1:-}
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
}

cleanup() {
  stop_process "$child_pid"
  stop_process "$watchdog_pid"
  stop_process "$blackhole_pid"
  rm -rf "$root"
}
trap cleanup EXIT

dump_file() {
  local label="$1"
  local path="$2"
  echo "--- ${label} ---" >&2
  if [ -e "$path" ]; then
    cat "$path" >&2
  else
    echo "(absent: ${path})" >&2
  fi
}

monotonic_now() {
  python3 - <<'PY'
import time
print(time.monotonic())
PY
}

elapsed_since() {
  python3 - "$1" "$2" <<'PY'
import sys
print(float(sys.argv[2]) - float(sys.argv[1]))
PY
}

record_phase() {
  printf '%s=%s\n' "$1" "$2" >>"$phase_log"
}

wait_for_startup() {
  python3 - "$child_pid" "$receipt" "$status" "$accepted_file" "$1" <<'PY'
import json
import os
import sys
import time

pid = int(sys.argv[1])
receipt_path, status_path, accepted_path = sys.argv[2:5]
deadline_seconds = float(sys.argv[5])
started_at = time.monotonic()

while time.monotonic() - started_at < deadline_seconds:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        raise SystemExit(2)

    try:
        with open(receipt_path, encoding="utf-8") as handle:
            receipt = json.load(handle)
        with open(status_path, encoding="utf-8") as handle:
            pipeline_status = json.load(handle)
        active_run = pipeline_status["periods"]["morning"].get("activeRun")
        receipt_ready = (
            receipt.get("kind") == "pipeline"
            and receipt.get("period") == "morning"
            and receipt.get("pid") == pid
        )
        status_ready = isinstance(active_run, dict) and "lastTerminal" not in pipeline_status["periods"]["morning"]
        if receipt_ready and status_ready and os.path.getsize(accepted_path) > 0:
            raise SystemExit(0)
    except (FileNotFoundError, json.JSONDecodeError, KeyError, OSError):
        pass

    time.sleep(0.1)

raise SystemExit(3)
PY
}

start_process_watchdog() {
  local watched_pid="$1"
  local started_at="$2"
  local deadline_seconds="$3"
  local timeout_marker="$4"
  python3 - "$watched_pid" "$started_at" "$deadline_seconds" "$timeout_marker" <<'PY' &
import os
import pathlib
import signal
import sys
import time

pid = int(sys.argv[1])
started_at = float(sys.argv[2])
deadline_seconds = float(sys.argv[3])
timeout_marker = pathlib.Path(sys.argv[4])
remaining = started_at + deadline_seconds - time.monotonic()
if remaining > 0:
    time.sleep(remaining)
try:
    os.kill(pid, 0)
except ProcessLookupError:
    raise SystemExit(0)
os.kill(pid, signal.SIGKILL)
timeout_marker.write_text("deadline watchdog killed child\n", encoding="utf-8")
PY
  watchdog_pid=$!
}

wrapper_started_at=$(monotonic_now)

if ! command -v bun >/dev/null 2>&1; then
  echo 'bun is required to run acceptance:google-sheets-deadline.' >&2
  exit 1
fi
if ! command -v openssl >/dev/null 2>&1; then
  echo 'openssl is required to create an isolated fake service-account key.' >&2
  exit 1
fi

binary="$root/scale2sheet"
build_started_at=$(monotonic_now)
bun build ./src/index.ts --compile --outfile "$binary" >/dev/null
build_finished_at=$(monotonic_now)
record_phase build "$(elapsed_since "$build_started_at" "$build_finished_at")"
record_phase wrapper_to_build "$(elapsed_since "$wrapper_started_at" "$build_finished_at")"

home="$root/home"
output_dir="$root/output"
empty_output_dir="$root/empty-output"
credentials="$root/service-account.json"
private_key="$root/private-key.pem"
target_date=$(TZ=Asia/Tokyo date +%F)
mkdir -p "$home/.config/scale2sheet" "$output_dir" "$empty_output_dir"

openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$private_key" 2>/dev/null
python3 - "$private_key" "$credentials" "$home/.config/scale2sheet/settings.json" "$output_dir" <<'PY'
import json
import pathlib
import sys

private_key_path, credentials_path, settings_path, output_dir = map(pathlib.Path, sys.argv[1:])
credentials = {
    "type": "service_account",
    "project_id": "scale2sheet-acceptance",
    "private_key_id": "acceptance-only",
    "private_key": private_key_path.read_text(encoding="utf-8"),
    "client_email": "acceptance@scale2sheet-acceptance.iam.gserviceaccount.com",
    "client_id": "000000000000000000000",
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
    "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/acceptance",
}
pathlib.Path(credentials_path).write_text(json.dumps(credentials), encoding="utf-8")
settings = {
    "time-zone": "Asia/Tokyo",
    "source": "scale-exporter",
    "sheet-name": "測定値",
    "sheet-id": "acceptance-fixture-not-a-real-spreadsheet",
    "sheets-credentials": str(credentials_path),
    "scale-exporter-output-dir": str(output_dir),
}
pathlib.Path(settings_path).write_text(json.dumps(settings), encoding="utf-8")
PY

cat >"$output_dir/scale_exporter_${target_date}_google-fit_001.jsonl" <<EOF
{"measuredAt":"${target_date}T06:30:00+09:00","kind":"weight","value":68.4,"unit":"kg","source":"google_fit"}
EOF

port_file="$root/blackhole-port"
accepted_file="$root/blackhole-accepted"
python3 - "$port_file" "$accepted_file" <<'PY' &
import socket
import pathlib
import sys
import time

port_file = pathlib.Path(sys.argv[1])
accepted_file = pathlib.Path(sys.argv[2])
listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
listener.bind(("127.0.0.1", 0))
listener.listen(1)
port_file.write_text(str(listener.getsockname()[1]), encoding="utf-8")
connection, _address = listener.accept()
accepted_file.write_text(f"{time.monotonic()}\n", encoding="utf-8")
try:
    try:
        while connection.recv(4096):
            pass
    except ConnectionResetError:
        pass
finally:
    connection.close()
    listener.close()
PY
blackhole_pid=$!

for _ in $(seq 1 100); do
  if [ -s "$port_file" ]; then
    break
  fi
  if ! kill -0 "$blackhole_pid" 2>/dev/null; then
    echo 'blackhole proxy exited before publishing its port' >&2
    exit 1
  fi
  sleep 0.05
done
if ! [ -s "$port_file" ]; then
  echo 'blackhole proxy did not publish its port' >&2
  exit 1
fi
proxy_url="http://127.0.0.1:$(cat "$port_file")"

run_pipeline() {
  local selected_output_dir="$1"
  env -i \
    HOME="$home" \
    PATH="/usr/bin:/bin" \
    TIME_ZONE="Asia/Tokyo" \
    SCALE_EXPORTER_OUTPUT_DIR="$selected_output_dir" \
    HTTPS_PROXY="$proxy_url" \
    HTTP_PROXY="$proxy_url" \
    https_proxy="$proxy_url" \
    http_proxy="$proxy_url" \
    NO_PROXY="" \
    no_proxy="" \
    "$binary" pipeline --period morning --date "$target_date"
}

receipt="$home/.config/scale2sheet/active-run.json"
status="$home/.config/scale2sheet/pipeline-status.json"
startup_bound_seconds=60
deadline_watchdog_seconds=45
startup_started_at=$(monotonic_now)
run_pipeline "$output_dir" >"$root/timeout.log" 2>&1 &
child_pid=$!
child_lstart=$(ps -o lstart= -p "$child_pid" 2>/dev/null | sed 's/^[[:space:]]*//' || true)
record_phase child_pid "$child_pid"
record_phase child_lstart "${child_lstart:-unavailable}"

if wait_for_startup "$startup_bound_seconds"; then
  :
else
  startup_wait_status=$?
  startup_finished_at=$(monotonic_now)
  record_phase startup "$(elapsed_since "$startup_started_at" "$startup_finished_at")"
  stop_process "$child_pid"
  child_pid=""
  if [ "$startup_wait_status" -eq 2 ]; then
    echo 'pipeline exited before publishing fresh receipt/status and reaching the blackhole proxy' >&2
  else
    echo 'startup positive control exceeded its monotonic bound before the blackhole proxy was reached' >&2
  fi
  dump_file "phase metrics" "$phase_log"
  dump_file "active-run receipt" "$receipt"
  dump_file "pipeline status" "$status"
  dump_file "pipeline log" "$root/timeout.log"
  exit 1
fi

startup_finished_at=$(monotonic_now)
record_phase startup "$(elapsed_since "$startup_started_at" "$startup_finished_at")"
deadline_started_at=$(cat "$accepted_file")
if ! receipt_started_at=$(python3 - "$receipt" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as handle:
    print(json.load(handle)["started-at"])
PY
); then
  echo 'startup receipt lacks started-at after positive control' >&2
  dump_file "phase metrics" "$phase_log"
  dump_file "active-run receipt" "$receipt"
  exit 1
fi
if ! pipeline_started_at=$(python3 - "$status" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as handle:
    print(json.load(handle)["periods"]["morning"]["activeRun"]["startedAt"])
PY
); then
  echo 'running pipeline status lacks activeRun.startedAt after positive control' >&2
  dump_file "phase metrics" "$phase_log"
  dump_file "pipeline status" "$status"
  exit 1
fi
record_phase receipt_started_at "$receipt_started_at"
record_phase pipeline_started_at "$pipeline_started_at"
record_phase blackhole_accept_monotonic "$deadline_started_at"
deadline_timeout_marker="$root/deadline-watchdog-timeout"
start_process_watchdog "$child_pid" "$deadline_started_at" "$deadline_watchdog_seconds" "$deadline_timeout_marker"

if wait "$child_pid"; then
  child_status=0
else
  child_status=$?
fi
child_pid=""
stop_process "$watchdog_pid"
watchdog_pid=""
deadline_finished_at=$(monotonic_now)
elapsed_seconds=$(elapsed_since "$deadline_started_at" "$deadline_finished_at")
record_phase deadline "$elapsed_seconds"
record_phase child_exit_monotonic "$deadline_finished_at"

if [ -e "$deadline_timeout_marker" ]; then
  echo 'deadline watchdog killed a pipeline that exceeded the post-connection bound' >&2
  dump_file "phase metrics" "$phase_log"
  dump_file "pipeline log" "$root/timeout.log"
  exit 1
fi

if ! python3 - "$elapsed_seconds" "$deadline_watchdog_seconds" <<'PY'
import sys
elapsed, bound = map(float, sys.argv[1:])
if not 28 <= elapsed <= bound:
    raise SystemExit(f"deadline elapsed {elapsed:.3f}s is outside the 28-{bound:.0f}s acceptance interval")
PY
then
  dump_file "phase metrics" "$phase_log"
  dump_file "pipeline log" "$root/timeout.log"
  exit 1
fi
if [ "$child_status" -ne 1 ] || ! grep -qx 'failed:transfer' "$root/timeout.log"; then
  echo 'blackhole-backed pipeline did not exit 1 with failed:transfer' >&2
  dump_file "phase metrics" "$phase_log"
  dump_file "pipeline log" "$root/timeout.log"
  exit 1
fi

post_started_at=$(monotonic_now)
if ! python3 - "$status" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    terminal = json.load(handle)["periods"]["morning"]["lastTerminal"]
if terminal.get("outcome") != "failed:transfer":
    raise SystemExit("terminal outcome is not failed:transfer")
if terminal.get("diagnostic") != "google-sheets-operation-timeout stage=auth-or-header-read deadlineMilliseconds=30000 writeConfirmation=not-attempted":
    raise SystemExit("terminal diagnostic does not identify the auth-or-header-read deadline")
if terminal.get("v3", {}).get("transfer") != {"state": "failed"}:
    raise SystemExit("terminal V3 transfer state is not failed")
PY
then
  dump_file "phase metrics" "$phase_log"
  dump_file "pipeline status" "$status"
  exit 1
fi
if [ -e "$receipt" ]; then
  echo 'pipeline left active-run.json after its timeout terminal path' >&2
  dump_file "phase metrics" "$phase_log"
  dump_file "active-run receipt" "$receipt"
  exit 1
fi
if ! terminal_completed_at=$(python3 - "$status" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as handle:
    print(json.load(handle)["periods"]["morning"]["lastTerminal"]["completedAt"])
PY
); then
  echo 'terminal pipeline status lacks completedAt' >&2
  dump_file "phase metrics" "$phase_log"
  dump_file "pipeline status" "$status"
  exit 1
fi
record_phase terminal_completed_at "$terminal_completed_at"

post_timeout_seconds=30
post_timeout_marker="$root/post-reacquire-timeout"
record_phase post_bound_seconds "$post_timeout_seconds"
run_pipeline "$empty_output_dir" >"$root/reacquired.log" 2>&1 &
second_pid=$!
start_process_watchdog "$second_pid" "$post_started_at" "$post_timeout_seconds" "$post_timeout_marker"
if wait "$second_pid"; then
  second_status=0
else
  second_status=$?
fi
stop_process "$watchdog_pid"
watchdog_pid=""
if [ -e "$post_timeout_marker" ]; then
  echo 'post-reacquire-timeout: next pipeline exceeded the bounded post interval' >&2
  dump_file "phase metrics" "$phase_log"
  dump_file "reacquired pipeline log" "$root/reacquired.log"
  exit 1
fi
if [ "$second_status" -ne 1 ] \
  || ! grep -qx 'failed:input-missing' "$root/reacquired.log" \
  || grep -q 'RunLeaseConflictError' "$root/reacquired.log"; then
  echo 'next pipeline did not reacquire the released lease before its isolated input failure' >&2
  dump_file "phase metrics" "$phase_log"
  dump_file "reacquired pipeline log" "$root/reacquired.log"
  exit 1
fi

post_finished_at=$(monotonic_now)
record_phase post "$(elapsed_since "$post_started_at" "$post_finished_at")"
record_phase lease_reacquire_monotonic "$post_finished_at"
cat "$phase_log"
echo "PASS: blackhole accepted a connection; pipeline timed out after ${elapsed_seconds}s, recorded failed:transfer, and released its lease"
