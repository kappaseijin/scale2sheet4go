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

scale2sheet_dir="/Users/kappa/Dropbox/data/dev/scale2sheet"
scale2sheet_bin="$scale2sheet_dir/dist/scale2sheet"
settings_path="$HOME/.config/scale2sheet/settings.json"

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

# 一時措置: 本番経路が run である間、入力途絶を検知する唯一の手段。
# run は入力0件でも exit 0 で終わる（2026-08-09 実測: 空の
# scale-exporter-output-dir で `run --period morning` を叩くと
# "No morning weight measurement found ... Nothing was written." を出して
# 正常終了する）。exporter を直接呼ばなくなった今、run 自身の終了コードは
# 「先方が今日の分を公開したか」を教えてくれない。
# 削除条件: cutover で本番経路が pipeline へ移行したら削除する（Issue #114）。
# pipeline は #134 で health 評価と通知を持ったため、この確認は不要になる。
#
# 何を確認するか: 今日の日付を含む google-fit タグの公開ファイルが
# 1件以上あるかどうか（ファイルの中身や更新時刻は見ない）。判定は
# 先方の命名規約 scale_exporter_YYYY-MM-DD_google-fit_NNN.jsonl に依存する
# ことに注意。命名規約が変わればこの確認も更新が要る。
#
# 既知の限定（2026-08-09 reviewer指摘、manager判断で先送り）: ここでの
# output_dir 解決は「プロセス環境 + settings.json」だけを見る。run 自体は
# dotenv/config で cd 後の .env も settings より優先して読む。いまの本番の
# .env には scale-exporter-output-dir 相当のキーが無いため実害は無いが、
# 将来 .env 側にこの値が足されると、run とこのスクリプトが異なる値を見る
# （run と同じ唯一の解決経路から値を取る方法を検討してから対応する）。
output_dir="${SCALE_EXPORTER_OUTPUT_DIR:-}"
if [ -z "$output_dir" ] && [ -f "$settings_path" ]; then
  output_dir=$(/usr/bin/env python3 -c '
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as f:
        settings = json.load(f)
except (OSError, json.JSONDecodeError):
    sys.exit(0)
value = settings.get("scale-exporter-output-dir")
if isinstance(value, str) and value:
    print(value)
' "$settings_path" 2>/dev/null || true)
fi
output_dir="${output_dir/#\~/$HOME}"
if [ -z "$output_dir" ]; then
  notify "scale-exporter-output-dirを解決できません（period=${period}）。settings.jsonまたはSCALE_EXPORTER_OUTPUT_DIRを確認してください"
elif [ ! -d "$output_dir" ]; then
  notify "scale-exporter-output-dirが存在しないかディレクトリではありません: ${output_dir}（period=${period}）。Dropboxの同期状態を確認してください"
else
  today=$(date '+%Y-%m-%d')
  if ! compgen -G "$output_dir/scale_exporter_${today}_google-fit_"'[0-9][0-9][0-9].jsonl' > /dev/null; then
    notify "google-fitの公開ファイルが本日ぶん見当たりません（period=${period}）。scale_exporter側のスケジュールを確認してください"
  fi
fi

cd "$scale2sheet_dir"
if [ ! -x "$scale2sheet_bin" ]; then
  echo "scale2sheet binary not found or not executable: $scale2sheet_bin" >&2
  notify "scale2sheetバイナリが見つからないか実行できません。npm run build:bun を実行してください"
  exit 1
fi

if ! "$scale2sheet_bin" run --period "$period"; then
  notify "シート転記が失敗しました（period=${period}）"
  exit 1
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] pipeline done (period=$period)"
