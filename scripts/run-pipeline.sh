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

# Google API の一時障害（HTTP 503 等）に備えたリトライ（2026-07-02 21:00 の初回
# launchd 実行が 503 で失敗した実績への対策）
run_exporter() {
  local attempts=3 delay=60 i
  for i in $(seq 1 "$attempts"); do
    if "$exporter" --source google-fit; then
      return 0
    fi
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] exporter attempt $i/$attempts failed" >&2
    if [ "$i" -lt "$attempts" ]; then
      sleep "$delay"
    fi
  done
  return 1
}
run_exporter

# Apple Health は HealthKit 署名後に有効化する（scale_exporter/APPLE_HEALTH_SETUP.md 参照）
# "$exporter" --source apple-health

cd "$scale2sheet_dir"
"$node_bin" dist/index.js run --period "$period"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] pipeline done (period=$period)"
