#!/usr/bin/env bash
set -euo pipefail

repo_root="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
if [ ! -d "$repo_root" ]; then
  echo "FAIL: repository root does not exist: $repo_root" >&2
  exit 2
fi

cd "$repo_root"

run_gate() {
  local name="$1"
  shift
  echo "RUN: $name"
  if "$@"; then
    echo "PASS: $name"
    return 0
  fi
  echo "FAIL: $name" >&2
  exit 1
}

check_gofmt() {
  local files
  files="$(gofmt -l cmd internal)"
  if [ -n "$files" ]; then
    echo "unformatted Go files:" >&2
    printf '%s\n' "$files" >&2
    return 1
  fi
}

mkdir -p dist
run_gate "gofmt" check_gofmt
run_gate "go mod verify" env GOTOOLCHAIN=local go mod verify
run_gate "go test" env GOTOOLCHAIN=local CGO_ENABLED=0 go test -count=1 ./...
run_gate "go vet" env GOTOOLCHAIN=local CGO_ENABLED=0 go vet ./...
run_gate "go build" env GOTOOLCHAIN=local CGO_ENABLED=0 go build -o dist/scale2sheet ./cmd/scale2sheet
run_gate "Go toolchain contract" bash scripts/check-go-toolchain-contract.sh "$repo_root"

echo "PASS: all Go quality gates"
