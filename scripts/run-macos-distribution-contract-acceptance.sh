#!/usr/bin/env bash
set -euo pipefail

# Contract acceptance for the public-distribution path. It proves that the
# workflow is fail-closed without credentials and that dry-run does not create
# an artifact. It deliberately does not contact Apple or use real secrets.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
root="$(mktemp -d "${TMPDIR:-/tmp}/scale2sheet-distribution-contract.XXXXXX")"
root="$(cd "$root" && pwd)"
cleanup() {
  rm -rf "$root"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

bash -n "$repo_root/scripts/build-macos-distribution.sh"
bash "$repo_root/scripts/build-macos-release.sh" "$root/unsigned"
[ -x "$root/unsigned" ] || fail "unsigned universal fixture is missing"

dry_log="$root/dry-run.log"
bash "$repo_root/scripts/build-macos-distribution.sh" --dry-run "$root/dry-run.dmg" >"$dry_log"
for expected_step in codesign notarytool stapler spctl; do
  grep -Fq "$expected_step" "$dry_log" || fail "dry-run omitted $expected_step"
done
[ ! -e "$root/dry-run.dmg" ] || fail "dry-run created a DMG"

missing_log="$root/missing-credentials.log"
set +e
(
  unset MACOS_SIGNING_IDENTITY MACOS_NOTARY_KEY_PATH MACOS_NOTARY_KEY_ID MACOS_NOTARY_ISSUER_ID
  unset MACOS_NOTARY_KEYCHAIN_PROFILE MACOS_NOTARY_KEYCHAIN_PATH
  bash "$repo_root/scripts/build-macos-distribution.sh" "$root/missing.dmg"
) >"$missing_log" 2>&1
missing_status=$?
set -e
[ "$missing_status" -ne 0 ] || fail "missing-credentials path unexpectedly succeeded"
grep -Fq "MACOS_SIGNING_IDENTITY is required" "$missing_log" || fail "missing identity error was not explicit"
[ ! -e "$root/missing.dmg" ] || fail "missing-credentials path left a DMG"

invalid_identity_log="$root/invalid-identity.log"
set +e
(
  unset MACOS_NOTARY_KEY_PATH MACOS_NOTARY_KEY_ID MACOS_NOTARY_ISSUER_ID
  unset MACOS_NOTARY_KEYCHAIN_PROFILE MACOS_NOTARY_KEYCHAIN_PATH
  MACOS_SIGNING_IDENTITY="Apple Development: fixture" \
    bash "$repo_root/scripts/build-macos-distribution.sh" "$root/invalid-identity.dmg"
) >"$invalid_identity_log" 2>&1
invalid_identity_status=$?
set -e
[ "$invalid_identity_status" -ne 0 ] || fail "invalid identity path unexpectedly succeeded"
grep -Fq "must name a Developer ID Application" "$invalid_identity_log" || fail "invalid identity error was not explicit"
[ ! -e "$root/invalid-identity.dmg" ] || fail "invalid identity path left a DMG"

missing_key_log="$root/missing-api-key.log"
set +e
(
  unset MACOS_NOTARY_KEYCHAIN_PROFILE MACOS_NOTARY_KEYCHAIN_PATH
  MACOS_SIGNING_IDENTITY="Developer ID Application: fixture (TEAMID)" \
  MACOS_NOTARY_KEY_PATH="$root/missing.p8" \
  MACOS_NOTARY_KEY_ID="fixture-key-id" \
  MACOS_NOTARY_ISSUER_ID="fixture-issuer-id" \
    bash "$repo_root/scripts/build-macos-distribution.sh" "$root/missing-key.dmg"
) >"$missing_key_log" 2>&1
missing_key_status=$?
set -e
[ "$missing_key_status" -ne 0 ] || fail "missing API key path unexpectedly succeeded"
grep -Fq "notary API key file does not exist" "$missing_key_log" || fail "missing API key error was not explicit"
[ ! -e "$root/missing-key.dmg" ] || fail "missing API key path left a DMG"

echo "PASS: macOS distribution dry-run, missing credentials, invalid identity, and partial-output negative controls"
