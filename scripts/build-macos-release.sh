#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
output="${1:-dist/scale2sheet}"
if [[ "$output" != /* ]]; then
  output="$repo_root/$output"
fi

for command_name in go lipo file; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "FAIL: required command is not available: $command_name" >&2
    exit 2
  fi
done

tmp_root="$(mktemp -d "${TMPDIR:-/tmp}/scale2sheet-macos-build.XXXXXX")"
staged_output=""
cleanup() {
  if [[ -n "$staged_output" && -e "$staged_output" ]]; then
    rm -f -- "$staged_output"
  fi
  rm -rf -- "$tmp_root"
}
trap cleanup EXIT

mkdir -p "$(dirname "$output")"
staged_output="$output.tmp.$$"
if [[ -e "$staged_output" ]]; then
  echo "FAIL: temporary output already exists: $staged_output" >&2
  exit 2
fi

cd "$repo_root"
echo "Go: $(go version)"
echo "Building darwin/arm64"
env GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 GOTOOLCHAIN=local \
  go build -trimpath -o "$tmp_root/scale2sheet-arm64" ./cmd/scale2sheet
echo "Building darwin/amd64"
env GOOS=darwin GOARCH=amd64 CGO_ENABLED=0 GOTOOLCHAIN=local \
  go build -trimpath -o "$tmp_root/scale2sheet-amd64" ./cmd/scale2sheet

echo "Combining universal binary"
lipo -create \
  "$tmp_root/scale2sheet-arm64" \
  "$tmp_root/scale2sheet-amd64" \
  -output "$staged_output"
chmod 0755 "$staged_output"

file_description="$(file -b "$staged_output")"
if [[ "$file_description" != *Mach-O* ]]; then
  echo "FAIL: output is not a Mach-O executable: $file_description" >&2
  exit 1
fi

lipo_description="$(lipo -info "$staged_output")"
architectures="$(lipo -archs "$staged_output")"
for required_architecture in arm64 x86_64; do
  found=false
  for architecture in $architectures; do
    if [[ "$architecture" == "$required_architecture" ]]; then
      found=true
      break
    fi
  done
  if [[ "$found" != true ]]; then
    echo "FAIL: universal output is missing $required_architecture: $lipo_description" >&2
    exit 1
  fi
done

mv -- "$staged_output" "$output"
staged_output=""
echo "PASS: $output"
echo "  file: $file_description"
echo "  lipo: $lipo_description"
