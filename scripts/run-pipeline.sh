#!/usr/bin/env bash
set -euo pipefail

# scale_exporter → scale2sheet 日次パイプライン
# 仕様: README.md「launchd による日次自動実行」参照
#
# usage: scripts/run-pipeline.sh <morning|evening>

period=${1:?usage: run-pipeline.sh <morning|evening>}
case "$period" in
  morning|evening) ;;
  *)
    echo "invalid period: $period (morning|evening)" >&2
    exit 2
    ;;
esac

exporter="/Users/kappa/Dropbox/data/dev/scale_exporter/.build/release/scale_exporter"
scale2sheet_dir="/Users/kappa/Dropbox/data/dev/scale2sheet"
node_bin="/Users/kappa/.nvm/versions/node/v24.3.0/bin/node"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] pipeline start (period=$period)"

"$exporter" --source google-fit

# Apple Health は HealthKit 署名後に有効化する（scale_exporter/APPLE_HEALTH_SETUP.md 参照）
# "$exporter" --source apple-health

cd "$scale2sheet_dir"
"$node_bin" dist/index.js run --period "$period"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] pipeline done (period=$period)"
