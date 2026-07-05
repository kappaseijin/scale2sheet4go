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
scale2sheet_bin="$scale2sheet_dir/dist/scale2sheet"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] pipeline start (period=$period)"

# Google API の一時障害（HTTP 503 等）対策: exporter を最大3回まで試行する
# （初回実行を含めて計3回・60秒間隔。2026-07-02 21:00 の launchd 初回実行が
# 503 で失敗した実績への対策）
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
notify() {  # 失敗を macOS 通知（LLM やログ監視に頼らない OS 完結の異常検知）
  /usr/bin/osascript -e "display notification \"$1\" with title \"scale-pipeline\" sound name \"Basso\"" 2>/dev/null || true
}

if ! run_exporter; then
  notify "exporter が3回失敗しました（period=$period）。~/Library/Logs/scale-pipeline/ を確認してください"
  exit 1
fi

# Apple Health は HealthKit 署名後に有効化する（scale_exporter/APPLE_HEALTH_SETUP.md 参照）
# "$exporter" --source apple-health

cd "$scale2sheet_dir"
if [ ! -x "$scale2sheet_bin" ]; then
  echo "scale2sheet binary not found or not executable: $scale2sheet_bin" >&2
  notify "scale2sheetバイナリが見つからないか実行できません。npm run build:bun を実行してください"
  exit 1
fi

if ! "$scale2sheet_bin" run --period "$period"; then
  notify "シート転記が失敗しました（period=$period）"
  exit 1
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] pipeline done (period=$period)"
