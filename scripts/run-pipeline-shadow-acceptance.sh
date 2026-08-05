#!/usr/bin/env bash
set -euo pipefail

# Compiled-Bun acceptance for the pipeline shadow path.  It uses only an
# isolated HOME, published fixture JSONL, a poison producer, and denied proxies.
# The exercised paths do not transfer, so this harness does not prove network denial.

root=$(mktemp -d /private/tmp/scale2sheet-pipeline-shadow.XXXXXX)
holder_pid=""
negative_pid=""

cleanup() {
  for pid in "$negative_pid" "$holder_pid"; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill -TERM "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
  rm -rf "$root"
}
trap cleanup EXIT

npm run build:bun >/dev/null
binary="$PWD/dist/scale2sheet"
home="$root/home"
output_dir="$root/published"
poison_bin="$root/bin"
fake_osascript="$root/fake-osascript"
osascript_log="$root/osascript.log"
mkdir -p "$home" "$output_dir" "$poison_bin"

cat >"$fake_osascript" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$SCALE2SHEET_OSASCRIPT_LOG"
EOF
chmod 700 "$fake_osascript"

cat >"$poison_bin/scale_exporter" <<'EOF'
#!/usr/bin/env bash
touch "$SCALE2SHEET_PRODUCER_MARKER"
exit 99
EOF
chmod 700 "$poison_bin/scale_exporter"

target_date=$(TZ=Asia/Tokyo date +%F)
cat >"$output_dir/scale_exporter_${target_date}_google-fit_001.jsonl" <<EOF
{"measuredAt":"${target_date}T12:01:00+09:00","kind":"weight","value":68.4,"unit":"kg","source":"google_fit"}
EOF

run_pipeline() {
  env -i HOME="$1" PATH="$poison_bin:/usr/bin:/bin" \
    TIME_ZONE="Asia/Tokyo" SCALE_EXPORTER_OUTPUT_DIR="$2" \
    SCALE2SHEET_PRODUCER_MARKER="$root/producer-invoked" \
    SCALE2SHEET_OSASCRIPT_PATH="$fake_osascript" SCALE2SHEET_OSASCRIPT_LOG="$osascript_log" \
    http_proxy="http://127.0.0.1:9" https_proxy="http://127.0.0.1:9" \
    "$binary" pipeline --period morning
}

start_pipeline() {
  env -i HOME="$1" PATH="$poison_bin:/usr/bin:/bin" \
    TIME_ZONE="Asia/Tokyo" SCALE_EXPORTER_OUTPUT_DIR="$2" \
    SCALE2SHEET_PRODUCER_MARKER="$root/producer-invoked" \
    SCALE2SHEET_OSASCRIPT_PATH="$fake_osascript" SCALE2SHEET_OSASCRIPT_LOG="$osascript_log" \
    http_proxy="http://127.0.0.1:9" https_proxy="http://127.0.0.1:9" \
    "$binary" pipeline --period morning >"$3" 2>&1 &
  started_pid=$!
}

assert_status_shape() {
  python3 - "$1" "$2" "$3" <<'PY'
import json
import sys

status_path, phase, expected_outcome = sys.argv[1:]
with open(status_path, encoding="utf-8") as handle:
    document = json.load(handle)

periods = document["periods"]
morning = periods["morning"]
evening = periods["evening"]

if phase == "running":
    if not isinstance(morning.get("activeRun"), dict):
        raise SystemExit("morning.activeRun is missing")
    if "lastTerminal" in morning or "activeRun" in evening or "lastTerminal" in evening:
        raise SystemExit("running status was recorded under the wrong terminal/period")
    if "completedAt" in morning["activeRun"] or "counts" in morning["activeRun"]:
        raise SystemExit("running status contains terminal fields")
elif phase == "terminal":
    terminal = morning.get("lastTerminal")
    if not isinstance(terminal, dict) or terminal.get("outcome") != expected_outcome:
        raise SystemExit("morning.lastTerminal outcome is incorrect")
    if "activeRun" in morning or "activeRun" in evening or "lastTerminal" in evening:
        raise SystemExit("terminal status was recorded under the wrong period")
    if evening["consecutiveFailureCount"] != 0 or evening["consecutiveNoDataCount"] != 0:
        raise SystemExit("opposite period counters changed")
    if evening["health"] != {"state": "unobserved", "causes": []}:
        raise SystemExit("opposite period health changed")
else:
    raise SystemExit(f"unknown status phase: {phase}")
PY
}

assert_missing_input_status() {
  python3 - "$1" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    terminal = json.load(handle)["periods"]["morning"]["lastTerminal"]
if terminal.get("startedAt") is None or terminal.get("completedAt") is None:
    raise SystemExit("negative terminal timestamps missing")
if terminal.get("counts") != {"matchedFileCount": 0}:
    raise SystemExit("negative terminal counts missing or incorrect")
PY
}

start_pipeline "$home" "$output_dir" "$root/holder.log"
holder_pid=$started_pid
receipt="$home/.config/scale2sheet/active-run.json"
status="$home/.config/scale2sheet/pipeline-status.json"

for _ in $(seq 1 100); do
  if [ -f "$receipt" ] \
    && grep -Eq '"kind":"pipeline"' "$receipt" \
    && grep -Eq '"period":"morning"' "$receipt" \
    && grep -Eq "\"pid\":${holder_pid}" "$receipt" \
    && [ -f "$status" ]; then
    break
  fi
  if ! kill -0 "$holder_pid" 2>/dev/null; then
    cat "$root/holder.log" >&2
    exit 1
  fi
  sleep 0.05
done

if ! [ -f "$receipt" ] \
  || ! grep -Eq '"kind":"pipeline"' "$receipt" \
  || ! grep -Eq '"period":"morning"' "$receipt" \
  || ! grep -Eq "\"pid\":${holder_pid}" "$receipt"; then
  echo 'pipeline holder did not publish the expected active-run receipt' >&2
  [ -f "$receipt" ] && cat "$receipt" >&2
  cat "$root/holder.log" >&2
  exit 1
fi

if ! [ -f "$status" ] \
  || ! assert_status_shape "$status" running unused; then
  echo 'pipeline holder did not write an incomplete running status before reading input' >&2
  exit 1
fi
before_inode=$(stat -f '%i' "$status")

kill -KILL "$holder_pid"
wait "$holder_pid" 2>/dev/null || true
holder_pid=""

run_pipeline "$home" "$output_dir" >"$root/reacquired.log" 2>&1
if ! grep -qx 'completed:no-data' "$root/reacquired.log"; then
  echo 'reacquired compiled pipeline did not finish with completed:no-data' >&2
  cat "$root/reacquired.log" >&2
  exit 1
fi
if ! assert_status_shape "$status" terminal completed:no-data; then
  echo 'completed pipeline did not persist completed:no-data status' >&2
  exit 1
fi
if ! python3 - "$status" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as handle:
    terminal = json.load(handle)["periods"]["morning"]["lastTerminal"]
if terminal.get("startedAt") is None or terminal.get("completedAt") is None:
    raise SystemExit("terminal timestamps missing")
if terminal.get("counts") != {"matchedFileCount": 1, "readLineCount": 1, "windowedReadingCount": 0}:
    raise SystemExit("terminal counts missing or incorrect")
PY
then
  echo 'completed pipeline status lacks timestamps or required counts' >&2
  cat "$status" >&2
  exit 1
fi
if [ "$(stat -f '%Lp' "$status")" != '600' ]; then
  echo 'pipeline status is not mode 0600' >&2
  exit 1
fi
if [ "$before_inode" = "$(stat -f '%i' "$status")" ]; then
  echo 'pipeline status was not atomically replaced' >&2
  exit 1
fi
if [ -e "$root/producer-invoked" ]; then
  echo 'pipeline invoked the poison producer executable' >&2
  exit 1
fi

negative_home="$root/negative-home"
mkdir -p "$negative_home"
start_pipeline "$negative_home" "$root/missing" "$root/negative.log"
negative_pid=$started_pid
negative_status=""
for _ in $(seq 1 250); do
  if ! kill -0 "$negative_pid" 2>/dev/null; then
    if wait "$negative_pid"; then
      negative_status=0
    else
      negative_status=$?
    fi
    break
  fi
  sleep 0.1
done
if [ -z "$negative_status" ]; then
  kill -KILL "$negative_pid" 2>/dev/null || true
  wait "$negative_pid" 2>/dev/null || true
  negative_pid=""
  echo 'missing-input negative control exceeded its bounded interval' >&2
  exit 1
fi
negative_pid=""
negative_pipeline_status="$negative_home/.config/scale2sheet/pipeline-status.json"
if [ "$negative_status" -ne 1 ] \
  || ! grep -qx 'failed:input-missing' "$root/negative.log" \
  || ! assert_status_shape "$negative_pipeline_status" terminal failed:input-missing \
  || ! assert_missing_input_status "$negative_pipeline_status" \
  || grep -Eq '"(readLineCount|windowedReadingCount)"' "$negative_pipeline_status" \
  || [ "$(stat -f '%Lp' "$negative_pipeline_status")" != '600' ]; then
  echo 'missing-input negative control did not produce bounded exit 1 and failed:input-missing status' >&2
  cat "$root/negative.log" >&2
  exit 1
fi
if [ "$(wc -l <"$osascript_log" 2>/dev/null || true)" -ne 1 ] \
  || ! grep -Fq '入力に失敗しました（period=morning）' "$osascript_log"; then
  echo 'missing-input negative control did not invoke the fake osascript notification exactly once' >&2
  [ -f "$osascript_log" ] && cat "$osascript_log" >&2
  exit 1
fi

echo 'PASS: compiled pipeline shadow path rejects producer invocation, recovers a SIGKILL lease, and records statuses'
