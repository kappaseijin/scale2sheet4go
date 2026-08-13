#!/usr/bin/env bash
set -euo pipefail

repo_root="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
if [ ! -d "$repo_root" ]; then
  echo "repository root does not exist: $repo_root" >&2
  exit 2
fi

failed=0
require_file() {
  local path="$1"
  if [ ! -f "$path" ]; then
    echo "FAIL: required Go toolchain file is missing: ${path#$repo_root/}" >&2
    failed=1
  fi
}

for path in "$repo_root/go.mod" "$repo_root/go.sum"; do
  require_file "$path"
done

for path in "$repo_root/package.json" "$repo_root/package-lock.json"; do
  if [ -e "$path" ]; then
    echo "FAIL: Node package metadata remains: ${path#$repo_root/}" >&2
    failed=1
  fi
done

readme="$repo_root/README.md"
for required in \
  'CGO_ENABLED=0 go build -o dist/scale2sheet ./cmd/scale2sheet' \
  'gofmt -w'; do
  if ! grep -Fq "$required" "$readme"; then
    echo "FAIL: README does not document the direct Go command: $required" >&2
    failed=1
  fi
done

for command in test vet; do
  if ! grep -Eq "go[[:space:]]+$command([[:space:]]+[^[:space:]]+)*[[:space:]]+\./\.\.\." "$readme"; then
    echo "FAIL: README does not document a direct Go $command command over ./..." >&2
    failed=1
  fi
done

for pattern in \
  '(^|[^[:alnum:]_])(npm[[:space:]]+(run|test|install|ci|exec)|npx[[:space:]]+|bun[[:space:]]+(build|run|x)|tsx[[:space:]]+|vitest[[:space:]]+)' ; do
  if grep -En "$pattern" "$readme" >/dev/null; then
    echo "FAIL: README contains a Node/Bun command: $pattern" >&2
    failed=1
  fi
done

for script in "$repo_root"/scripts/run-*.sh; do
  [ -f "$script" ] || continue
  for pattern in \
    '(^|[^[:alnum:]_])(npm[[:space:]]+(run|test|install|ci|exec)|npx[[:space:]]+|bun[[:space:]]+(build|run|x)|tsx[[:space:]]+|vitest[[:space:]]+)' ; do
    if grep -En "$pattern" "$script" >/dev/null; then
      echo "FAIL: current acceptance/operator script contains a Node/Bun command: ${script#$repo_root/}" >&2
      failed=1
    fi
  done
done

if [ "$failed" -ne 0 ]; then
  exit 1
fi

echo "PASS: Go Modules and direct Go CLI are the current toolchain contract"
