#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
dry_run=false
if [[ "${1:-}" == "--dry-run" ]]; then
  dry_run=true
  shift
fi

output="${1:-dist/scale2sheet-macos.dmg}"
if [[ "$output" != /* ]]; then
  output="$repo_root/$output"
fi
case "$output" in
  *.dmg) ;;
  *)
    echo "FAIL: output must be a .dmg file: $output" >&2
    exit 2
    ;;
esac

required_commands=(go lipo file codesign hdiutil xcrun spctl plutil ditto)
for command_name in "${required_commands[@]}"; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "FAIL: required command is not available: $command_name" >&2
    exit 2
  fi
done

if [[ "$dry_run" == true ]]; then
  echo "DRY-RUN: build universal darwin/arm64 + darwin/amd64 binary"
  echo "DRY-RUN: codesign binary with Developer ID Application, timestamp, Hardened Runtime"
  echo "DRY-RUN: create and codesign UDZO DMG"
  echo "DRY-RUN: notarytool submit --wait, then notarytool log"
  echo "DRY-RUN: stapler staple/validate, hdiutil verify, spctl open/execute"
  echo "DRY-RUN: output $output and ${output}.notary.json"
  exit 0
fi

identity="${MACOS_SIGNING_IDENTITY:-}"
if [[ -z "$identity" ]]; then
  echo "FAIL: MACOS_SIGNING_IDENTITY is required" >&2
  exit 2
fi
case "$identity" in
  "Developer ID Application:"*) ;;
  *)
    echo "FAIL: MACOS_SIGNING_IDENTITY must name a Developer ID Application identity" >&2
    exit 2
    ;;
esac

identifier="${MACOS_SIGNING_IDENTIFIER:-jp.seijin.kappa.scale2sheet.cli}"
volume_name="${MACOS_DMG_VOLUME_NAME:-scale2sheet}"
notary_args=()
if [[ -n "${MACOS_NOTARY_KEY_PATH:-}" || -n "${MACOS_NOTARY_KEY_ID:-}" || -n "${MACOS_NOTARY_ISSUER_ID:-}" ]]; then
  for variable_name in MACOS_NOTARY_KEY_PATH MACOS_NOTARY_KEY_ID MACOS_NOTARY_ISSUER_ID; do
    if [[ -z "${!variable_name:-}" ]]; then
      echo "FAIL: API-key notarization requires $variable_name" >&2
      exit 2
    fi
  done
  if [[ ! -f "$MACOS_NOTARY_KEY_PATH" ]]; then
    echo "FAIL: notary API key file does not exist: $MACOS_NOTARY_KEY_PATH" >&2
    exit 2
  fi
  notary_args=(--key "$MACOS_NOTARY_KEY_PATH" --key-id "$MACOS_NOTARY_KEY_ID" --issuer "$MACOS_NOTARY_ISSUER_ID")
elif [[ -n "${MACOS_NOTARY_KEYCHAIN_PROFILE:-}" || -n "${MACOS_NOTARY_KEYCHAIN_PATH:-}" ]]; then
  if [[ -z "${MACOS_NOTARY_KEYCHAIN_PROFILE:-}" || -z "${MACOS_NOTARY_KEYCHAIN_PATH:-}" ]]; then
    echo "FAIL: Keychain-profile notarization requires MACOS_NOTARY_KEYCHAIN_PROFILE and MACOS_NOTARY_KEYCHAIN_PATH" >&2
    exit 2
  fi
  if [[ ! -f "$MACOS_NOTARY_KEYCHAIN_PATH" ]]; then
    echo "FAIL: notary keychain does not exist: $MACOS_NOTARY_KEYCHAIN_PATH" >&2
    exit 2
  fi
  notary_args=(--keychain-profile "$MACOS_NOTARY_KEYCHAIN_PROFILE" --keychain "$MACOS_NOTARY_KEYCHAIN_PATH")
else
  echo "FAIL: notarization credentials are required (API key or Keychain profile)" >&2
  exit 2
fi

tmp_root="$(mktemp -d "${TMPDIR:-/tmp}/scale2sheet-macos-distribution.XXXXXX")"
staged_output=""
staged_log=""
mount_point="$tmp_root/mount"
mounted=false
cleanup() {
  if [[ "$mounted" == true ]]; then
    hdiutil detach "$mount_point" -force >/dev/null 2>&1 || true
  fi
  if [[ -n "$staged_output" && -e "$staged_output" ]]; then
    rm -f -- "$staged_output"
  fi
  if [[ -n "$staged_log" && -e "$staged_log" ]]; then
    rm -f -- "$staged_log"
  fi
  rm -rf -- "$tmp_root"
}
trap cleanup EXIT

mkdir -p "$(dirname "$output")"
notary_output="${output}.notary.json"
staged_output="$output.tmp.$$"
staged_log="$notary_output.tmp.$$"
if [[ -e "$staged_output" || -e "$staged_log" ]]; then
  echo "FAIL: temporary distribution output already exists" >&2
  exit 2
fi

unsigned_binary="$tmp_root/scale2sheet-unsigned"
bash "$repo_root/scripts/build-macos-release.sh" "$unsigned_binary"

file_description="$(file -b "$unsigned_binary")"
[[ "$file_description" == *Mach-O* ]] || { echo "FAIL: unsigned binary is not Mach-O" >&2; exit 1; }
architectures="$(lipo -archs "$unsigned_binary")"
for required_architecture in arm64 x86_64; do
  found=false
  for architecture in $architectures; do
    if [[ "$architecture" == "$required_architecture" ]]; then
      found=true
      break
    fi
  done
  [[ "$found" == true ]] || { echo "FAIL: unsigned binary is missing $required_architecture" >&2; exit 1; }
done

volume_dir="$tmp_root/volume"
staged_binary="$volume_dir/scale2sheet"
mkdir -p "$volume_dir"
ditto "$unsigned_binary" "$staged_binary"
ditto "$repo_root/README.md" "$volume_dir/README.md"
chmod 0755 "$staged_binary"

echo "Signing binary with Developer ID Application"
codesign --force --sign "$identity" --timestamp --options runtime --identifier "$identifier" "$staged_binary"
codesign --verify --strict --verbose=2 "$staged_binary"
signature_details="$(codesign -d --verbose=4 "$staged_binary" 2>&1 || true)"
[[ "$signature_details" == *"Authority=Developer ID Application"* ]] || { echo "FAIL: binary is not Developer ID signed" >&2; exit 1; }
[[ "$signature_details" == *"flags=0x10000(runtime)"* ]] || { echo "FAIL: binary signature does not enable Hardened Runtime" >&2; exit 1; }

unsigned_dmg="$tmp_root/scale2sheet-macos.dmg"
echo "Creating DMG"
hdiutil create -quiet -ov -format UDZO -volname "$volume_name" -srcfolder "$volume_dir" "$unsigned_dmg"
echo "Signing DMG"
codesign --force --sign "$identity" --timestamp --identifier "${identifier}.dmg" "$unsigned_dmg"
codesign --verify --strict --verbose=2 "$unsigned_dmg"

submit_json="$tmp_root/notarytool-submit.json"
notary_log="$tmp_root/notarytool-log.json"
echo "Submitting DMG to Apple notary service"
set +e
xcrun notarytool submit "${notary_args[@]}" --wait --output-format json "$unsigned_dmg" >"$submit_json" 2>&1
submit_status=$?
set -e
request_id="$(plutil -extract id raw -o - "$submit_json" 2>/dev/null || true)"
if [[ "$submit_status" -ne 0 ]]; then
  if [[ -n "$request_id" ]]; then
    xcrun notarytool log "${notary_args[@]}" "$request_id" "$notary_log" >/dev/null 2>&1 || true
    [[ -f "$notary_log" ]] && cat "$notary_log" >&2
  fi
  cat "$submit_json" >&2
  echo "FAIL: notarytool submit failed (exit $submit_status)" >&2
  exit 1
fi
notary_status="$(plutil -extract status raw -o - "$submit_json" 2>/dev/null || true)"
if [[ "$notary_status" != "Accepted" || -z "$request_id" ]]; then
  cat "$submit_json" >&2
  echo "FAIL: notarytool did not return Accepted with a submission id" >&2
  exit 1
fi
xcrun notarytool log "${notary_args[@]}" "$request_id" "$notary_log"

echo "Stapling notarization ticket"
xcrun stapler staple -v "$unsigned_dmg"
xcrun stapler validate -v "$unsigned_dmg"
hdiutil verify "$unsigned_dmg"
spctl --assess --type open --verbose=4 "$unsigned_dmg"

mkdir -p "$mount_point"
hdiutil attach "$unsigned_dmg" -nobrowse -readonly -mountpoint "$mount_point" >/dev/null
mounted=true
codesign --verify --strict --verbose=2 "$mount_point/scale2sheet"
spctl --assess --type execute --verbose=4 "$mount_point/scale2sheet"
hdiutil detach "$mount_point" -force >/dev/null
mounted=false

ditto "$unsigned_dmg" "$staged_output"
ditto "$notary_log" "$staged_log"
mv -- "$staged_output" "$output"
staged_output=""
mv -- "$staged_log" "$notary_output"
staged_log=""
echo "PASS: $output"
echo "  notary log: $notary_output"
echo "  submission id: $request_id"
