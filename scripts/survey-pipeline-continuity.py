#!/usr/bin/env python3
"""pipeline の連続失敗に関する集計（Issue #46）。

docs/decisions/2026-08-04T184244_連続失敗に人が気づくための目標定義.md の
一次データ（E-1 〜 E-7）を再現する。

使い方:
    python3 scripts/survey-pipeline-continuity.py [ログディレクトリ] [入力ディレクトリ]

入力ディレクトリを省略した場合は ~/.config/scale2sheet/settings.json の
scale-exporter-output-dir を読む。入力を読めない場合は E-1 〜 E-4 だけを出す。

既定のログディレクトリは ~/Library/Logs/scale-pipeline
（scripts/run-pipeline.sh の出力先。launchd plist の StandardOutPath / StandardErrorPath）。

数え方の単位を必ず明示すること。同じ問いでも単位が違えば数が変わる。

    実行単位  pipeline start 1 回 = 1 実行（1 日 2 回ある）
    日単位    その日の全実行が done に至らなかった日を「全滅した日」とする

閾値は最長観測値 + 1 で決めないこと（案件A で確定した手順）。
本スクリプトは連続長の分布と、成功間隔の分布の両方を出力する。
"""

import collections
import datetime
import json
import os
import re
import sys

START = re.compile(r"^\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\] pipeline start")
DONE = re.compile(r"^\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\] pipeline done")
NOTIFY_TRIGGER = "attempt 3/3 failed"
DEFAULT_LOG_DIR = "~/Library/Logs/scale-pipeline"
TRANSFER_MARKER = "measurement cell(s)"
# src/sources/scale-exporter/reader.ts:38 の fileNamePattern と同一にすること。
INPUT_FILE_PATTERN = re.compile(
    r"^scale_exporter_(\d{4}-\d{2}-\d{2})_(apple-health|google-fit)_(\d{3})\.jsonl$"
)
# src/service/measurements.ts の measurementPeriodWindowMinutes と同一にすること。
PERIOD_WINDOW = {"morning": (5 * 60, 12 * 60), "evening": (20 * 60, 23 * 60 + 30)}
JST = datetime.timezone(datetime.timedelta(hours=9))


def resolve_input_dir(argv):
    if len(argv) > 2:
        return os.path.expanduser(argv[2])
    settings_path = os.path.expanduser("~/.config/scale2sheet/settings.json")
    try:
        with open(settings_path, encoding="utf8") as handle:
            return os.path.expanduser(json.load(handle)["scale-exporter-output-dir"])
    except Exception:
        return None


def read_weight_files(input_dir):
    """(対象日, period) -> [(mtime, ファイル名)]。window 内の体重を含むファイルだけを拾う。"""
    table = collections.defaultdict(list)
    for name in sorted(os.listdir(input_dir)):
        matched = INPUT_FILE_PATTERN.match(name)
        if not matched:
            continue
        day = matched.group(1)
        path = os.path.join(input_dir, name)
        modified = datetime.datetime.fromtimestamp(os.stat(path).st_mtime, JST)
        with open(path, encoding="utf8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                record = json.loads(line)
                if record["kind"] != "weight":
                    continue
                measured = datetime.datetime.fromisoformat(
                    record["measuredAt"].replace("Z", "+00:00")).astimezone(JST)
                minutes = measured.hour * 60 + measured.minute
                for period, (begin, end) in PERIOD_WINDOW.items():
                    if begin <= minutes <= end:
                        table[(day, period)].append((modified, name))
    return table


def read_runs(path):
    """[(日付, 成功したか)] を返す。start から次の start までを 1 実行とする。"""
    runs = []
    current = None
    with open(path, encoding="utf8", errors="replace") as handle:
        for line in handle:
            started = START.match(line)
            if started:
                if current:
                    runs.append(current)
                current = [started.group(1), False]
                continue
            if current and DONE.match(line):
                current[1] = True
    if current:
        runs.append(current)
    return runs


def read_transfers(path):
    """(転記した日の集合, 日 -> [start 時刻]) を返す。"""
    transferred = set()
    starts = collections.defaultdict(list)
    day = None
    with open(path, encoding="utf8", errors="replace") as handle:
        for line in handle:
            started = START.match(line)
            if started:
                day = started.group(1)
                starts[day].append(started.group(2))
                continue
            if day and TRANSFER_MARKER in line:
                transferred.add(day)
    return transferred, starts


def streaks(flags):
    """True/False の列から、False が連続した長さの列を返す。"""
    result = []
    count = 0
    for flag in flags:
        if flag:
            if count:
                result.append(count)
            count = 0
        else:
            count += 1
    if count:
        result.append(count)
    return result


def windows(days):
    """日付文字列の列を、連続した区間へまとめる。"""
    result = []
    start = previous = None
    for day in days:
        current = datetime.date.fromisoformat(day)
        if previous is None or (current - previous).days > 1:
            if start:
                result.append((start, previous))
            start = current
        previous = current
    if start:
        result.append((start, previous))
    return result


def main():
    log_dir = os.path.expanduser(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_LOG_DIR)
    input_dir = resolve_input_dir(sys.argv)
    print(f"# ログ: {log_dir}")
    print(f"# 入力: {input_dir if input_dir else '(解決できない。E-5 以降は出力しない)'}")
    weight_files = None
    if input_dir and os.path.isdir(input_dir):
        weight_files = read_weight_files(input_dir)

    for period in ("evening", "morning"):
        log_path = os.path.join(log_dir, f"{period}.log")
        if not os.path.exists(log_path):
            print(f"\n== {period}: ログが無い（{log_path}）")
            continue

        runs = read_runs(log_path)
        by_day = collections.defaultdict(list)
        for day, ok in runs:
            by_day[day].append(ok)
        days = sorted(by_day)
        dead_days = [d for d in days if not any(by_day[d])]
        success_days = [d for d in days if any(by_day[d])]

        print()
        print(f"== {period}")
        print(f"  E-2 実行単位: 実行 {len(runs)} / 失敗 {sum(1 for _, ok in runs if not ok)}"
              f" ({sum(1 for _, ok in runs if not ok) / max(len(runs), 1) * 100:.0f}%)")
        run_streaks = streaks([ok for _, ok in runs])
        print(f"      連続失敗の分布: {dict(sorted(collections.Counter(run_streaks).items()))}"
              f" 最長 {max(run_streaks) if run_streaks else 0}")

        print(f"  E-1 日単位: 記録のある日 {len(days)} / 全滅した日 {len(dead_days)}")
        day_streaks = streaks([d not in dead_days for d in days])
        print(f"      連続長の分布: {dict(sorted(collections.Counter(day_streaks).items()))}"
              f" 最長 {max(day_streaks) if day_streaks else 0}")
        print("      全滅期間:", [f"{a}〜{b}({(b - a).days + 1}日)" for a, b in windows(dead_days)])

        gaps = [(datetime.date.fromisoformat(b) - datetime.date.fromisoformat(a)).days
                for a, b in zip(success_days, success_days[1:])]
        print(f"  E-4 成功間隔の分布: {dict(sorted(collections.Counter(gaps).items()))}"
              f" 最大 {max(gaps) if gaps else 0}")
        print("      ※ 閾値はここから決める。連続失敗回数からは決めない（失敗が多数派のため）")
        # L 日続いた障害は、成功間隔を L+1 日にする。閾値 T は L+1 >= T のとき発火する。
        normal_gaps = [g for g in gaps if g == 1]
        for threshold in (2, 3, 7):
            false_positives = sum(1 for g in normal_gaps if g >= threshold)
            missed = [f"{a}〜{b}({(b - a).days + 1}日)" for a, b in windows(dead_days)
                      if (b - a).days + 1 + 1 < threshold]
            print(f"      閾値 {threshold} 日: 誤検知 {false_positives} 回 /"
                  f" 取り逃す障害 {missed if missed else 'なし'}")

        if weight_files is not None:
            transferred, starts = read_transfers(log_path)
            print(f"  E-5 転記した日: {len(transferred)} / done があった日"
                  f" {len({d for d, ok in runs if ok})}")
            # E-6 / E-7: 入力に window 内の体重があるのに転記していない日
            #
            # 選別規則を 2 つ出す。単位ではなく「いつの入力を当時あったとみなすか」の違いである。
            #   規則A  window 内の体重を含むファイルの mtime の日付が、対象日と同じ
            #   規則B  同ファイルの mtime が、その日の最後の実行開始時刻以前
            # 規則B の方が「実行時に読めたか」に近い。規則A は同日の実行後に公開された分を含む。
            rule_a, rule_b = [], []
            for day in days:
                if day in transferred:
                    continue
                candidates = weight_files.get((day, period), [])
                if not candidates:
                    continue
                if any(mtime.date() == datetime.date.fromisoformat(day)
                       for mtime, _ in candidates):
                    rule_a.append(day)
                if starts.get(day):
                    last_run = datetime.datetime.fromisoformat(
                        f"{day}T{max(starts[day])}").replace(tzinfo=JST)
                    if any(mtime <= last_run for mtime, _ in candidates):
                        rule_b.append(day)
            all_days = [d for d in days
                        if d not in transferred and weight_files.get((d, period))]
            print(f"  E-6 入力に window 内の体重があり転記なし（現在のコーパス基準）: {len(all_days)} 日")
            print(f"      規則A（mtime の日付 == 対象日）        : {len(rule_a)} 日 {rule_a}")
            print(f"      規則B（mtime <= その日の最終実行開始時刻）: {len(rule_b)} 日 {rule_b}")
            print("      ※ 規則B が『実行時に読めたか』に近い。差は同日でも実行後に公開された分。")
            print("      ※ E-7: 後から入力を読み直す判定は、バックフィルを当時あったと誤認する。")

        err_path = os.path.join(log_dir, f"{period}.err.log")
        if os.path.exists(err_path):
            with open(err_path, encoding="utf8", errors="replace") as handle:
                lines = handle.readlines()
            notifications = sum(1 for line in lines if NOTIFY_TRIGGER in line)
            causes = collections.Counter()
            for line in lines:
                for key in ("token refresh failed", "HTTP 400", "HTTP 503",
                            "No such file or directory", "ScaleExporterFileError"):
                    if key in line:
                        causes[key] += 1
            print(f"  E-3 notify が呼ばれた回数（3/3 失敗）: {notifications}")
            print(f"      原因内訳: {dict(causes)}")


if __name__ == "__main__":
    main()
