#!/usr/bin/env bash
set -euo pipefail

# #128: bun is required to build the binary this check compares against the
# source. Fail loudly with install guidance rather than skipping -- a skip
# here would mean "no binary was checked," not "the binary matched the
# source" (Issue #126).
if ! command -v bun >/dev/null 2>&1; then
  echo 'bun is required to run acceptance:binary-drift (part of `npm test`).' >&2
  echo 'Install it with: curl -fsSL https://bun.sh/install | bash' >&2
  echo 'Then restart your shell so `bun` is on PATH, and re-run `npm test`.' >&2
  exit 1
fi

root=$(mktemp -d /private/tmp/scale2sheet-binary-drift.XXXXXX)
trap 'rm -rf "$root"' EXIT

checker="$PWD/scripts/check-binary-source-drift.py"
# #128 follow-up: the checker runs this through tsx and reads its own
# --help output, rather than regex-scanning one file, so it must be a
# runnable entry point (src/index.ts), not src/cli/index.ts (which only
# exports runCli and never calls it).
source_entry="$PWD/src/index.ts"
fresh="$root/scale2sheet"
stale="$root/stale-scale2sheet"

bun build ./src/index.ts --compile --outfile "$fresh" >/dev/null
if ! python3 "$checker" "$fresh" "$source_entry"; then
  echo 'fresh binary unexpectedly differs from source' >&2
  exit 1
fi

cat >"$stale" <<'EOF'
#!/usr/bin/env bash
cat <<'HELP'
Usage: scale2sheet [options] [command]

Commands:
  auth                Run the installed app OAuth flow for Google Fit.
  run                 Append the latest measurements.
  serve               Run scheduled sync.
  help                display help for command
HELP
EOF
chmod 700 "$stale"
if python3 "$checker" "$stale" "$source_entry"; then
  echo 'stale binary negative control unexpectedly passed' >&2
  exit 1
fi

# Copies the whole src/ tree (not just index.ts) into an isolated
# directory, since the checker now runs the source through tsx and needs
# its own imports to resolve. node_modules/package.json/tsconfig.json are
# symlinked in (not copied) purely so Node's module resolution and esbuild's
# "type": "module" detection work from the isolated path -- none of them
# carry a .git of their own, so they don't affect the git-outside/dirty
# detection this block exists to test.
isolated_source_tree() {
  local dir="$1"
  mkdir -p "$dir"
  cp -R "$PWD/src" "$dir/src"
  ln -s "$PWD/node_modules" "$dir/node_modules"
  ln -s "$PWD/package.json" "$dir/package.json"
  ln -s "$PWD/tsconfig.json" "$dir/tsconfig.json"
}

# #123 N-1 / #128: source_head must fall back to "unknown" (no traceback) when
# the source file has no ancestor git repo, instead of crashing.
no_git_dir="$root/no-git-source"
isolated_source_tree "$no_git_dir"
status=0
output=$(python3 "$checker" "$fresh" "$no_git_dir/src/index.ts" 2>&1) || status=$?
if [ "$status" -ne 0 ]; then
  echo "git-outside source unexpectedly failed (exit $status): $output" >&2
  exit 1
fi
if ! grep -q 'source_head=unknown' <<<"$output"; then
  echo "git-outside source did not report source_head=unknown: $output" >&2
  exit 1
fi
if grep -qi 'traceback' <<<"$output"; then
  echo "git-outside source crashed instead of falling back: $output" >&2
  exit 1
fi

# #123 N-1 / #128: source_head must carry a "-dirty" suffix when the source
# file's git worktree has uncommitted changes.
dirty_dir="$root/dirty-source"
isolated_source_tree "$dirty_dir"
git -C "$dirty_dir" init --quiet
git -C "$dirty_dir" -c user.name=acceptance -c user.email=acceptance@example.com add src
git -C "$dirty_dir" -c user.name=acceptance -c user.email=acceptance@example.com commit --quiet -m "acceptance fixture"
printf '\n// uncommitted change for the acceptance dirty-state check\n' >>"$dirty_dir/src/index.ts"
status=0
output=$(python3 "$checker" "$fresh" "$dirty_dir/src/index.ts" 2>&1) || status=$?
if [ "$status" -ne 0 ]; then
  echo "dirty source unexpectedly failed (exit $status): $output" >&2
  exit 1
fi
if ! grep -q -- '-dirty ' <<<"$output"; then
  echo "dirty source did not report a -dirty suffix: $output" >&2
  exit 1
fi

# #128 follow-up (reviewer, main-merge red): the earlier regex-based
# `expected` set only ever read src/cli/index.ts, so it silently missed any
# command registered by a helper called from there (registerInstallationCommands
# -> install/uninstall). Confirms the tsx-based rewrite actually closes that
# hole, by adding a throwaway extra command via such a helper and checking
# the drift is detected.
helper_mutation_dir="$root/helper-mutation-source"
isolated_source_tree "$helper_mutation_dir"
helper_file="$helper_mutation_dir/src/cli/installation.ts"
if ! grep -q 'registerInstallationCommands' "$helper_file"; then
  echo "expected registerInstallationCommands in $helper_file" >&2
  exit 1
fi
python3 - "$helper_file" <<'PYEOF'
import re
import sys

path = sys.argv[1]
text = open(path, encoding="utf-8").read()
marker = re.search(
    r'export function registerInstallationCommands\([\s\S]*?\): void \{',
    text,
)
if marker is None:
    raise SystemExit(f"marker not found in {path}")
injected = marker.group(0) + '\n  program.command("acceptance-mutation-only").action(() => {});'
open(path, "w", encoding="utf-8").write(
    text[:marker.start()] + injected + text[marker.end():]
)
PYEOF
if python3 "$checker" "$fresh" "$helper_mutation_dir/src/index.ts"; then
  echo 'helper-registered command mutation went undetected (regex-shaped hole reopened)' >&2
  exit 1
fi

echo 'PASS: source/binary drift gate passes fresh build and rejects stale command set'
echo 'PASS: source/binary drift gate reports source_head=unknown outside a git repo and -dirty with uncommitted changes'
echo 'PASS: source/binary drift gate detects a command registered only through a helper (registerInstallationCommands)'
