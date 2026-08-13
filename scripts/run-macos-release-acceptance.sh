#!/usr/bin/env bash
set -euo pipefail

# End-to-end acceptance for the production macOS artifact. It uses an isolated
# HOME, a fake launchctl, and unroutable proxies; it never changes the real
# user's install, launchd domain, credentials, or network state.

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
root="$(mktemp -d "${TMPDIR:-/tmp}/scale2sheet-release-acceptance.XXXXXX")"
root="$(cd "$root" && pwd)"
cleanup() {
  rm -rf "$root"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

for command_name in bash file grep lipo plutil; do
  command -v "$command_name" >/dev/null 2>&1 || fail "required command is not available: $command_name"
done

binary="$root/scale2sheet"
bash "$repo_root/scripts/build-macos-release.sh" "$binary" || fail "universal release build failed"
[ -x "$binary" ] || fail "release artifact is not executable"
file_description="$(file -b "$binary")"
[[ "$file_description" == *Mach-O* ]] || fail "release artifact is not Mach-O: $file_description"
architectures="$(lipo -archs "$binary")"
for required_architecture in arm64 x86_64; do
  [[ " $architectures " == *" $required_architecture "* ]] || fail "release artifact is missing $required_architecture: $architectures"
done
version="$("$binary" --version)"
[ "$version" = "0.1.0" ] || fail "release artifact version = $version"

fake_bin="$root/fake-bin"
launchctl_log="$root/launchctl.log"
mkdir -p "$fake_bin"
: >"$launchctl_log"
cat >"$fake_bin/launchctl" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >>"$launchctl_log"
case "\$1" in
  print) exit 1 ;;
  bootout|bootstrap) exit 0 ;;
  *) exit 1 ;;
esac
EOF
chmod 0700 "$fake_bin/launchctl"

isolated_path="$fake_bin:/usr/bin:/bin"
run_isolated() {
  local command_path="$1"
  shift
  env -i HOME="$home" PATH="$isolated_path" \
    http_proxy="http://127.0.0.1:9" https_proxy="http://127.0.0.1:9" \
    "$command_path" "$@"
}

home="$root/home"
prefix="$home/custom"
config_dir="$home/.config/scale2sheet"
credentials="$config_dir/google-sheets-service-account.json"
output_dir="$root/scale-exporter-output"
mkdir -p "$config_dir" "$output_dir"
cat >"$config_dir/settings.json" <<EOF
{
  "source": "scale-exporter",
  "sheet-id": "release-acceptance-fixture-sheet",
  "sheets-credentials": "$credentials",
  "scale-exporter-output-dir": "$output_dir"
}
EOF
printf '{}\n' >"$credentials"
chmod 0600 "$config_dir/settings.json" "$credentials"

install_log="$root/install.log"
run_isolated "$binary" install --prefix "$prefix" --launchd >"$install_log" 2>&1 || {
  cat "$install_log" >&2
  fail "install --launchd failed"
}
installed_binary="$prefix/bin/scale2sheet"
[ -x "$installed_binary" ] || fail "installed universal binary is missing"
installed_architectures="$(lipo -archs "$installed_binary")"
for required_architecture in arm64 x86_64; do
  [[ " $installed_architectures " == *" $required_architecture "* ]] || fail "installed binary is missing $required_architecture: $installed_architectures"
done

morning_plist="$home/Library/LaunchAgents/jp.seijin.kappa.scale-pipeline.morning.plist"
evening_plist="$home/Library/LaunchAgents/jp.seijin.kappa.scale-pipeline.evening.plist"
plutil -lint "$morning_plist" >/dev/null || fail "morning LaunchAgent plist is invalid"
plutil -lint "$evening_plist" >/dev/null || fail "evening LaunchAgent plist is invalid"
grep -Fq "bootstrap gui/" "$launchctl_log" || fail "install did not bootstrap LaunchAgents"

doctor_log="$root/doctor.log"
run_isolated "$installed_binary" doctor --prefix "$prefix" >"$doctor_log" 2>&1 || {
  cat "$doctor_log" >&2
  fail "doctor --prefix failed"
}
doctor_output="$(<"$doctor_log")"
case "$doctor_output" in
  *"[PASS] prefix: $prefix"*) ;;
  *) cat "$doctor_log" >&2; fail "doctor did not validate the custom prefix" ;;
esac
case "$doctor_output" in
  *"[PASS] binary-placement: $installed_binary"*) ;;
  *) cat "$doctor_log" >&2; fail "doctor did not validate installed binary placement" ;;
esac
case "$doctor_output" in
  *"[PASS] plist-syntax: $morning_plist"*) ;;
  *) cat "$doctor_log" >&2; fail "doctor did not inspect morning plist" ;;
esac
case "$doctor_output" in
  *"[PASS] plist-syntax: $evening_plist"*) ;;
  *) cat "$doctor_log" >&2; fail "doctor did not inspect evening plist" ;;
esac

run_isolated "$installed_binary" uninstall --prefix "$prefix" --dry-run >/dev/null || fail "uninstall --dry-run failed"
run_isolated "$installed_binary" uninstall --prefix "$prefix" >/dev/null || fail "uninstall failed"
[ ! -e "$installed_binary" ] || fail "uninstall left the installed binary"
[ ! -e "$morning_plist" ] || fail "uninstall left the morning plist"
[ ! -e "$evening_plist" ] || fail "uninstall left the evening plist"
[ ! -e "$config_dir/install-manifest.json" ] || fail "uninstall left the install manifest"
[ -f "$config_dir/settings.json" ] || fail "uninstall removed settings.json"
[ -f "$credentials" ] || fail "uninstall removed credentials"
[ -d "$output_dir" ] || fail "uninstall changed the source output directory"

echo "PASS: universal macOS build, version, install --launchd, plist lint, doctor --prefix, and uninstall"
echo "  file: $file_description"
echo "  lipo architectures: $architectures"
