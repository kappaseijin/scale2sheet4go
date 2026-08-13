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

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
scale2sheet_dir="$(cd "$script_dir/.." && pwd)"
scale2sheet_bin="${SCALE2SHEET_BINARY:-$scale2sheet_dir/dist/scale2sheet}"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] pipeline start (period=$period)"

# exporter の呼び出しは 2026-08-09 に撤去した（cutover gate G-2: 「exporter
# 自身のスケジュールだけで」morning/evening 両方に google-fit の JSONL が
# 公開されることを連続2日確認する。当方が呼び続ける限りこの条件を満たせない。
# 先方は flock + exit 6 + 監査で対応済み: 62b6ace）。
#
# apple-health は iPhone のショートカットが出力するため、元々ここでは
# 呼んでいない（2026-08-03 のユーザー決定。
# docs/decisions/2026-08-02T120800_scale_exporterとの責任境界の設計監査.md 参照）。

notify() {  # 失敗を macOS 通知（LLM やログ監視に頼らない OS 完結の異常検知）
  /usr/bin/osascript -e "display notification \"$1\" with title \"scale-pipeline\" sound name \"Basso\"" 2>/dev/null || true
}

if [ ! -x "$scale2sheet_bin" ]; then
  echo "scale2sheet Go binary not found or not executable: $scale2sheet_bin" >&2
  notify "scale2sheet Go バイナリが見つからないか実行できません。npm run build:go を実行してください"
  exit 1
fi

if ! "$scale2sheet_bin" pipeline --period "$period"; then
  notify "シート転記が失敗しました（period=${period}）"
  exit 1
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] pipeline done (period=$period)"
