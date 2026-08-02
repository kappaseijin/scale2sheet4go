#!/usr/bin/env bash
set -euo pipefail

# Compiled-Bun acceptance for the Darwin O_EXLOCK kernel contract.
# It never uses the real HOME, prefix, launchd, or network credentials.

root=$(mktemp -d /private/tmp/scale2sheet-runtime-safety.XXXXXX)
holder_pid=""

cleanup() {
  if [ -n "$holder_pid" ] && kill -0 "$holder_pid" 2>/dev/null; then
    kill -TERM "$holder_pid" 2>/dev/null || true
    wait "$holder_pid" 2>/dev/null || true
  fi
  rm -rf "$root"
}
trap cleanup EXIT

npm run build:bun >/dev/null
binary="$PWD/dist/scale2sheet"
home="$root/home"
mkdir -p "$home"

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

for _ in $(seq 1 100); do
  if grep -q 'Scheduler started' "$root/holder.log"; then
    break
  fi
  if ! kill -0 "$holder_pid" 2>/dev/null; then
    cat "$root/holder.log" >&2
    exit 1
  fi
  sleep 0.05
done

if ! grep -q 'Scheduler started' "$root/holder.log"; then
  echo 'holder did not acquire run lease' >&2
  exit 1
fi

set +e
run_compiled >"$root/conflict.log" 2>&1
conflict_status=$?
set -e
if [ "$conflict_status" -eq 0 ] || ! grep -Eq 'EAGAIN|EWOULDBLOCK|RunLeaseConflictError' "$root/conflict.log"; then
  echo 'second compiled process did not report lock conflict' >&2
  cat "$root/conflict.log" >&2
  exit 1
fi

kill -KILL "$holder_pid"
wait "$holder_pid" 2>/dev/null || true
holder_pid=""

start_compiled "$root/reacquired.log"
for _ in $(seq 1 100); do
  if grep -q 'Scheduler started' "$root/reacquired.log"; then
    break
  fi
  if ! kill -0 "$holder_pid" 2>/dev/null; then
    cat "$root/reacquired.log" >&2
    exit 1
  fi
  sleep 0.05
done

if ! grep -q 'Scheduler started' "$root/reacquired.log"; then
  echo 'compiled process did not acquire lease after SIGKILL release' >&2
  exit 1
fi

echo 'PASS: compiled Bun two-process EAGAIN/EWOULDBLOCK conflict and SIGKILL release'
