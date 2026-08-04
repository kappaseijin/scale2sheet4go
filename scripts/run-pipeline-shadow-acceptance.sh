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
mkdir -p "$home" "$output_dir" "$poison_bin"

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
    http_proxy="http://127.0.0.1:9" https_proxy="http://127.0.0.1:9" \
    "$binary" pipeline --period morning
}

start_pipeline() {
  env -i HOME="$1" PATH="$poison_bin:/usr/bin:/bin" \
    TIME_ZONE="Asia/Tokyo" SCALE_EXPORTER_OUTPUT_DIR="$2" \
    SCALE2SHEET_PRODUCER_MARKER="$root/producer-invoked" \
    http_proxy="http://127.0.0.1:9" https_proxy="http://127.0.0.1:9" \
    "$binary" pipeline --period morning >"$3" 2>&1 &
  started_pid=$!
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
  || ! grep -Eq '"outcome": "running"' "$status" \
  || ! grep -Eq '"startedAt":' "$status" \
  || grep -Eq '"completedAt"|"(matchedFileCount|readLineCount|windowedReadingCount)"' "$status"; then
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
if ! grep -Eq '"outcome": "completed:no-data"' "$status"; then
  echo 'completed pipeline did not persist completed:no-data status' >&2
  exit 1
fi
if ! grep -Eq '"startedAt":' "$status" \
  || ! grep -Eq '"completedAt":' "$status" \
  || ! grep -Eq '"matchedFileCount": 1' "$status" \
  || ! grep -Eq '"readLineCount": 1' "$status" \
  || ! grep -Eq '"windowedReadingCount": 0' "$status"; then
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
  || ! grep -Eq '"outcome": "failed:input-missing"' "$negative_pipeline_status" \
  || ! grep -Eq '"startedAt":' "$negative_pipeline_status" \
  || ! grep -Eq '"completedAt":' "$negative_pipeline_status" \
  || ! grep -Eq '"matchedFileCount": 0' "$negative_pipeline_status" \
  || grep -Eq '"(readLineCount|windowedReadingCount)"' "$negative_pipeline_status" \
  || [ "$(stat -f '%Lp' "$negative_pipeline_status")" != '600' ]; then
  echo 'missing-input negative control did not produce bounded exit 1 and failed:input-missing status' >&2
  cat "$root/negative.log" >&2
  exit 1
fi

echo 'PASS: compiled pipeline shadow path rejects producer invocation, recovers a SIGKILL lease, and records statuses'
