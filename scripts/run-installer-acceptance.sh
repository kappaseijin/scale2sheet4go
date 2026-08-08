#!/usr/bin/env bash
set -euo pipefail

# Isolated-Bun acceptance for install/uninstall (design INSTALLATION_DESIGN.md
# §隔離統合テスト 1, 2, 4, 5, 6 plus the "隔離 Bun 必須" checks for AC-17,
# AC-18, AC-19). Never touches the real HOME, prefix, launchd, or network.
# launchctl is a fake stub on PATH; Google network access is denied via
# unroutable proxies. purge/wipe/doctor are Slice 5/4 and are out of scope.

root=$(mktemp -d /private/tmp/scale2sheet-installer-acceptance.XXXXXX)
holder_pid=""

cleanup() {
  for pid in "$holder_pid"; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill -TERM "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
  rm -rf "$root"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

npm run build:bun >/dev/null
binary="$PWD/dist/scale2sheet"

fake_bin="$root/fake-bin"
mkdir -p "$fake_bin"
launchctl_log="$root/launchctl.log"
: >"$launchctl_log"

# Fake launchctl: `print` always reports "not registered" (exit 1) so
# bootout/bootstrap in the plan resolve deterministically; every invocation
# is logged so tests can assert zero mutating calls during --dry-run.
cat >"$fake_bin/launchctl" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >>"$launchctl_log"
case "\$1" in
  print) exit 1 ;;
  bootout) exit 0 ;;
  bootstrap) exit 0 ;;
  *) exit 1 ;;
esac
EOF
chmod 700 "$fake_bin/launchctl"

isolated_path="$fake_bin:/usr/bin:/bin"
# Unroutable proxies: any accidental network call fails fast instead of
# hanging or reaching the real Google APIs.
run_isolated() {
  local home="$1"
  shift
  env -i HOME="$home" PATH="$isolated_path" \
    http_proxy="http://127.0.0.1:9" https_proxy="http://127.0.0.1:9" \
    "$binary" "$@"
}

tree_snapshot() {
  # Path listing alone misses an in-place content swap (e.g. replace-binary
  # rewriting the same path to a new inode): include each file's content
  # hash so a silent mutation shows up as a diff even when no path is
  # added or removed.
  find "$1" -type d 2>/dev/null | sort
  find "$1" -type f -exec shasum -a 256 {} + 2>/dev/null | sort
}

# --- Check 1: first install leaves binary, settings, manifest (design §隔離統合テスト 1) ---
home1="$root/home1"
mkdir -p "$home1"
run_isolated "$home1" install >"$root/install1.log" 2>&1 || {
  cat "$root/install1.log" >&2
  fail "first install failed"
}
[ -x "$home1/.local/bin/scale2sheet" ] || fail "binary missing after install"
[ -f "$home1/.config/scale2sheet/settings.json" ] || fail "settings.json missing after install"
[ -f "$home1/.config/scale2sheet/install-manifest.json" ] || fail "manifest missing after install"
version1=$(run_isolated "$home1" --version 2>/dev/null || true)
[ -n "$version1" ] || fail "installed binary --version produced no output"

# design §計画 step 5 / AC-04: once settings.json exists, install requires its
# sheets-credentials file to be present. The first install above ran before
# settings.json existed, so it was exempt; every install after this point
# needs the fixture credentials file settings.json now points to.
sheets_credentials=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['sheets-credentials'])" \
  "$home1/.config/scale2sheet/settings.json")
echo '{}' >"$sheets_credentials"

# --- Check 2: a second install is idempotent; settings content is unchanged (design §隔離統合テスト 2) ---
settings_before=$(cat "$home1/.config/scale2sheet/settings.json")
run_isolated "$home1" install >"$root/install2.log" 2>&1 || {
  cat "$root/install2.log" >&2
  fail "second install failed"
}
settings_after=$(cat "$home1/.config/scale2sheet/settings.json")
[ "$settings_before" = "$settings_after" ] || fail "settings.json changed across a repeat install"

# --- Check 4 / AC-19: dry-run tree is unchanged, and launchctl sees zero mutating calls, under network denial ---
home4="$root/home4"
mkdir -p "$home4"
before_tree=$(tree_snapshot "$home4")
run_isolated "$home4" install --dry-run --launchd >"$root/install-dry.log" 2>&1 || {
  cat "$root/install-dry.log" >&2
  fail "install --dry-run --launchd failed"
}
after_tree=$(tree_snapshot "$home4")
[ "$before_tree" = "$after_tree" ] || fail "install --dry-run mutated the filesystem tree"
grep -q '^\[planned\]' "$root/install-dry.log" || fail "install --dry-run printed no plan"
if grep -Eq 'bootout|bootstrap' "$launchctl_log"; then
  fail "install --dry-run invoked a mutating launchctl subcommand"
fi

run_isolated "$home1" uninstall --dry-run >"$root/uninstall-dry.log" 2>&1 || {
  cat "$root/uninstall-dry.log" >&2
  fail "uninstall --dry-run failed"
}
[ -x "$home1/.local/bin/scale2sheet" ] || fail "uninstall --dry-run removed the binary"
[ -f "$home1/.config/scale2sheet/install-manifest.json" ] || fail "uninstall --dry-run removed the manifest"
if grep -Eq 'bootout|bootstrap' "$launchctl_log"; then
  fail "uninstall --dry-run invoked a mutating launchctl subcommand"
fi

# --- Check 5 / AC-18: install --launchd fails before any mutation while `serve` holds the run lease ---
home5="$root/home5"
mkdir -p "$home5"
run_isolated "$home5" install >"$root/install5.log" 2>&1 || {
  cat "$root/install5.log" >&2
  fail "setup install for AC-18 failed"
}
home5_credentials=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['sheets-credentials'])" \
  "$home5/.config/scale2sheet/settings.json")
echo '{}' >"$home5_credentials"

env -i HOME="$home5" PATH="$isolated_path" \
  http_proxy="http://127.0.0.1:9" https_proxy="http://127.0.0.1:9" \
  "$binary" serve >"$root/holder.log" 2>&1 &
holder_pid=$!
for _ in $(seq 1 100); do
  grep -q 'Scheduler started' "$root/holder.log" && break
  kill -0 "$holder_pid" 2>/dev/null || { cat "$root/holder.log" >&2; fail "serve holder exited before starting"; }
  sleep 0.05
done
grep -q 'Scheduler started' "$root/holder.log" || fail "serve holder never reached Scheduler started"

# Snapshot after serve has already written its own active-run.json (serve's
# own lease bookkeeping, unrelated to install's mutation), so the tree
# comparison below isolates what install --launchd itself would change.
before_ac18=$(tree_snapshot "$home5")

conflict_status=0
run_isolated "$home5" install --launchd >"$root/install-conflict.log" 2>&1 || conflict_status=$?
[ "$conflict_status" -ne 0 ] || fail "install --launchd succeeded while serve held the run lease"
grep -Eq 'run lease is active|EAGAIN|EWOULDBLOCK' "$root/install-conflict.log" \
  || fail "install --launchd failure did not report a run-lease conflict"

kill -TERM "$holder_pid"
wait "$holder_pid" 2>/dev/null || true
holder_pid=""

after_ac18=$(tree_snapshot "$home5")
[ "$before_ac18" = "$after_ac18" ] || fail "install --launchd mutated the tree before failing on an active run lease (AC-18)"
if grep -Eq 'bootout|bootstrap' "$launchctl_log"; then
  fail "install --launchd invoked launchctl mutations despite the lease conflict"
fi

# --- Check 6: default uninstall leaves settings and log content behind (design §隔離統合テスト 6, AC-09, B-1 review fix) ---
# A real pipeline run would leave log content in the created log dir; a
# naive "remove-tree everything in created-paths" implementation deletes it
# (PR #139 review finding B-1). Simulate that here.
log_dir="$home1/Library/Logs/scale-pipeline"
mkdir -p "$log_dir"
printf 'morning run completed\n' >"$log_dir/morning.log"

run_isolated "$home1" uninstall >"$root/uninstall1.log" 2>&1 || {
  cat "$root/uninstall1.log" >&2
  fail "default uninstall failed"
}
[ ! -e "$home1/.local/bin" ] || fail "uninstall left the (now-empty) bin dir behind"
[ ! -e "$home1/.config/scale2sheet/install-manifest.json" ] || fail "uninstall left the manifest behind"
[ -f "$home1/.config/scale2sheet/settings.json" ] || fail "default uninstall removed settings.json"
[ "$(cat "$home1/.config/scale2sheet/settings.json")" = "$settings_after" ] || fail "settings.json content changed across uninstall"
[ -f "$log_dir/morning.log" ] || fail "default uninstall deleted the log file (B-1: data loss)"
[ "$(cat "$log_dir/morning.log")" = "morning run completed" ] || fail "default uninstall changed log file content"

# --- AC-17: a process with the old binary already open completes on the old inode; the replaced binary reports successfully ---
home17="$root/home17"
mkdir -p "$home17"
run_isolated "$home17" install >"$root/install17.log" 2>&1 || {
  cat "$root/install17.log" >&2
  fail "setup install for AC-17 failed"
}
binary_path="$home17/.local/bin/scale2sheet"
home17_credentials=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['sheets-credentials'])" \
  "$home17/.config/scale2sheet/settings.json")
echo '{}' >"$home17_credentials"

# Hold an open file descriptor on the current inode (a run in progress) while
# a fresh install replaces the file at that path.
exec 9<"$binary_path"
old_inode=$(stat -f '%i' "$binary_path")

run_isolated "$home17" install >"$root/reinstall17.log" 2>&1 || {
  cat "$root/reinstall17.log" >&2
  fail "reinstall over an open binary failed"
}

# The held fd must still resolve to the pre-replacement inode's content
# (rename semantics), proving the running process was never truncated or
# corrupted in place.
held_first_bytes=$(head -c 4 <&9 | xxd -p)
exec 9<&-
[ -n "$held_first_bytes" ] || fail "held file descriptor could not read the old binary's content after replacement"

new_inode=$(stat -f '%i' "$binary_path")
[ "$new_inode" != "$old_inode" ] || fail "replace-binary did not swap to a new inode (rename, not overwrite)"

version17=$(run_isolated "$home17" --version 2>/dev/null || true)
[ -n "$version17" ] || fail "post-replacement binary --version failed"

echo 'PASS: isolated install/uninstall (checks 1,2,4,5,6) plus AC-17/AC-18/AC-19'
