#!/usr/bin/env python3
"""scale_exporter 出力コーパスの集計。

docs/decisions/2026-08-04T151338_pipeline入力段階の失敗と部分成功の目標定義.md の
一次データ（F-1 〜 F-3）を再現するためのスクリプト。

使い方:
    python3 scripts/survey-input-corpus.py [出力ディレクトリ]

出力ディレクトリを省略した場合は ~/.config/scale2sheet/settings.json の
scale-exporter-output-dir を読む。

集計するもの:
  - ファイル数・行数・parse 不能行数（F-1）
  - source の値域（AC-50 の根拠）
  - 日ごとの体重件数（朝 window / 夜 window / 全体）（F-3）
  - 連続 no-data の**分布**と最長、および N ごとの空振り見積もり（B-3 の閾値 N の根拠）

閾値 N を決めるときは最長ではなく分布を見ること。
2026-08-04 の起草では最長だけを見て「2 連続は 1 回・他は単発」と誤り、
実際には 2 連続が 4 回起きていた（reviewer_claude の独立再集計で判明）。

period window は src/service/measurements.ts の
measurementPeriodWindowMinutes と同じ値を使う（morning 05:00-12:00 / evening 20:00-23:30）。
実装を変更したらこの値も追従させること。
"""

import collections
import datetime
import json
import os
import re
import sys

FILE_NAME_PATTERN = re.compile(
    r"^scale_exporter_(\d{4}-\d{2}-\d{2})_(apple-health|apple-health-file|google-fit)_(\d{3})\.jsonl$"
)
JST = datetime.timezone(datetime.timedelta(hours=9))
MORNING = (5 * 60, 12 * 60)
EVENING = (20 * 60, 23 * 60 + 30)
REQUIRED_KEYS = ("measuredAt", "kind", "value", "unit", "source")


def resolve_output_dir(argv):
    if len(argv) > 1:
        return os.path.expanduser(argv[1])
    settings_path = os.path.expanduser("~/.config/scale2sheet/settings.json")
    with open(settings_path, encoding="utf8") as handle:
        settings = json.load(handle)
    return os.path.expanduser(settings["scale-exporter-output-dir"])


def parse_line(line):
    """1 行を読む。読めなければ None を返す（reader.ts の検証と同等の範囲）。"""
    record = json.loads(line)
    for key in REQUIRED_KEYS:
        if key not in record:
            raise ValueError(f"missing key: {key}")
    if not isinstance(record["value"], (int, float)):
        raise ValueError("value is not a number")
    if not isinstance(record["source"], str) or not record["source"].strip():
        raise ValueError("source is empty")
    return record


def minutes_of(measured_at):
    parsed = datetime.datetime.fromisoformat(measured_at.replace("Z", "+00:00"))
    local = parsed.astimezone(JST)
    return local.hour * 60 + local.minute


def main():
    output_dir = resolve_output_dir(sys.argv)
    days = collections.defaultdict(
        lambda: {
            "files": 0,
            "lines": 0,
            "bad": 0,
            "bad_files": set(),
            "platforms": collections.Counter(),
            "weight_all": 0,
            "weight_morning": 0,
            "weight_evening": 0,
        }
    )
    sources = collections.Counter()
    unmatched = []

    for name in sorted(os.listdir(output_dir)):
        matched = FILE_NAME_PATTERN.match(name)
        if not matched:
            unmatched.append(name)
            continue
        day, platform, _ = matched.groups()
        bucket = days[day]
        bucket["files"] += 1
        bucket["platforms"][platform] += 1

        with open(os.path.join(output_dir, name), encoding="utf8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                bucket["lines"] += 1
                try:
                    record = parse_line(line)
                except Exception:
                    bucket["bad"] += 1
                    bucket["bad_files"].add(name)
                    continue
                sources[record["source"]] += 1
                if record["kind"] != "weight":
                    continue
                try:
                    minutes = minutes_of(record["measuredAt"])
                except Exception:
                    continue
                bucket["weight_all"] += 1
                if MORNING[0] <= minutes <= MORNING[1]:
                    bucket["weight_morning"] += 1
                if EVENING[0] <= minutes <= EVENING[1]:
                    bucket["weight_evening"] += 1

    print(f"# 対象ディレクトリ: {output_dir}")
    print(f"# 命名規約に一致しないエントリ（読み込まれない）: {unmatched}")
    print()
    header = f"{'day':12} {'files':>5} {'lines':>6} {'bad':>4} {'W':>3} {'Wm':>3} {'We':>3}  platforms"
    print(header)

    totals = collections.Counter()
    no_evening_streak = 0
    max_no_evening_streak = 0
    evening_streaks = []
    for day in sorted(days):
        bucket = days[day]
        totals["days"] += 1
        totals["files"] += bucket["files"]
        totals["lines"] += bucket["lines"]
        totals["bad"] += bucket["bad"]
        if bucket["weight_morning"] == 0:
            totals["days_without_morning_weight"] += 1
        if bucket["weight_evening"] == 0:
            totals["days_without_evening_weight"] += 1
            no_evening_streak += 1
            max_no_evening_streak = max(max_no_evening_streak, no_evening_streak)
        else:
            if no_evening_streak:
                evening_streaks.append(no_evening_streak)
            no_evening_streak = 0
        print(
            f"{day:12} {bucket['files']:5} {bucket['lines']:6} {bucket['bad']:4} "
            f"{bucket['weight_all']:3} {bucket['weight_morning']:3} {bucket['weight_evening']:3}"
            f"  {dict(bucket['platforms'])}"
        )

    if no_evening_streak:
        evening_streaks.append(no_evening_streak)

    print()
    print("TOTALS:", dict(totals))
    print("source の値域:", dict(sources))
    print()
    print("夜 window に体重が無い日の連続長の分布:",
          dict(sorted(collections.Counter(evening_streaks).items())))
    print("同 最長:", max_no_evening_streak)
    print()
    print("判定:")
    print(f"  parse 不能行が 0 か: {'YES' if totals['bad'] == 0 else 'NO'}"
          "（NO の場合、目標定義の A-2〈行単位スキップ〉を再検討すること）")

    total_days = max(totals["days"], 1)
    p = totals["days_without_evening_weight"] / total_days
    print(f"  夜 0 件率 p = {p:.3f}（{totals['days_without_evening_weight']}/{total_days} 日）")
    print("  B-3 の閾値 N ごとの空振り見積もり（各日が独立という粗い仮定。相関があれば実際はもっと早い）:")
    print(f"    {'N':>3} {'N連続の確率':>12} {'30日あたり期待空振り':>22} {'#46相当の検知まで':>18}")
    for n in range(2, 8):
        prob = p ** n
        per_month = prob * max(30 - n + 1, 0)
        print(f"    {n:>3} {prob:>12.4f} {per_month:>22.2f} {str(n) + ' 日':>18}")
    print("  ※ 最長連続 + 1 で N を決めないこと。標本に余裕ゼロで貼り付くため、次の N 連続で必ず空振りする")


if __name__ == "__main__":
    main()
