#!/usr/bin/env bash
set -euo pipefail

# The Go source and the compiled artifact must expose the same command set.
# The source-side help is generated with `go run`, so this gate exercises the
# real command wiring rather than maintaining a second list in the script.
root=$(mktemp -d "${TMPDIR:-/tmp}/scale2sheet-binary-drift.XXXXXX")
trap 'rm -rf "$root"' EXIT

checker="$PWD/scripts/check-binary-source-drift.py"
fresh="$root/scale2sheet"
stale="$root/stale-scale2sheet"
source_help="$root/source-help.txt"

CGO_ENABLED=0 GOTOOLCHAIN=local go build -o "$fresh" ./cmd/scale2sheet
CGO_ENABLED=0 GOTOOLCHAIN=local go run ./cmd/scale2sheet --help >"$source_help"
if ! python3 "$checker" "$fresh" "$PWD/cmd/scale2sheet/main.go" --source-help-file "$source_help"; then
  echo 'fresh binary unexpectedly differs from Go source' >&2
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
if python3 "$checker" "$stale" "$PWD/cmd/scale2sheet/main.go" --source-help-file "$source_help"; then
  echo 'stale binary negative control unexpectedly passed' >&2
  exit 1
fi

# A checker that accidentally accepts an empty command set is a false pass.
zero_command_checker="$root/checker-zero-commands.py"
cp "$checker" "$zero_command_checker"
python3 - "$zero_command_checker" <<'PYEOF'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
old = 're.compile(r"^  ([a-z][a-z0-9-]*)", re.MULTILINE)'
new = 're.compile(r"^ZZZ  ([a-z][a-z0-9-]*)", re.MULTILINE)'
if old not in text:
    raise SystemExit("COMMAND_NAME_PATTERN mutation marker not found")
path.write_text(text.replace(old, new, 1))
PYEOF
if python3 "$zero_command_checker" "$fresh" "$PWD/cmd/scale2sheet/main.go" --source-help-file "$source_help"; then
  echo 'zero-command parser mutation unexpectedly passed' >&2
  exit 1
fi

# Keep the source provenance diagnostics covered after the TypeScript-to-Go
# cutover: a source outside Git is unknown, while an uncommitted source is
# marked dirty.
no_git_dir="$root/no-git-source"
mkdir -p "$no_git_dir"
cp cmd/scale2sheet/main.go "$no_git_dir/main.go"
output=$(python3 "$checker" "$fresh" "$no_git_dir/main.go" --source-help-file "$source_help")
grep -q 'source_head=unknown' <<<"$output" || {
  echo "source outside Git did not report source_head=unknown: $output" >&2
  exit 1
}

dirty_dir="$root/dirty-source"
mkdir -p "$dirty_dir"
cp cmd/scale2sheet/main.go "$dirty_dir/main.go"
git -C "$dirty_dir" init --quiet
git -C "$dirty_dir" -c user.name=acceptance -c user.email=acceptance@example.com add main.go
git -C "$dirty_dir" -c user.name=acceptance -c user.email=acceptance@example.com commit --quiet -m "acceptance fixture"
printf '\n// uncommitted change for the acceptance dirty-state check\n' >>"$dirty_dir/main.go"
output=$(python3 "$checker" "$fresh" "$dirty_dir/main.go" --source-help-file "$source_help")
grep -q -- '-dirty ' <<<"$output" || {
  echo "dirty source did not report a -dirty suffix: $output" >&2
  exit 1
}

echo 'PASS: Go source/binary drift gate passes fresh build and rejects stale command set'
echo 'PASS: source/binary drift gate reports source_head=unknown outside a git repo and -dirty with uncommitted changes'
