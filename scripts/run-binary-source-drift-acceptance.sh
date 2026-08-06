#!/usr/bin/env bash
set -euo pipefail

root=$(mktemp -d /private/tmp/scale2sheet-binary-drift.XXXXXX)
trap 'rm -rf "$root"' EXIT

checker="$PWD/scripts/check-binary-source-drift.py"
source_cli="$PWD/src/cli/index.ts"
fresh="$root/scale2sheet"
stale="$root/stale-scale2sheet"

bun build ./src/index.ts --compile --outfile "$fresh" >/dev/null
if ! python3 "$checker" "$fresh" "$source_cli"; then
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
if python3 "$checker" "$stale" "$source_cli"; then
  echo 'stale binary negative control unexpectedly passed' >&2
  exit 1
fi

echo 'PASS: source/binary drift gate passes fresh build and rejects stale command set'
