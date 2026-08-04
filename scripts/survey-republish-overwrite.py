#!/usr/bin/env python3
"""再公開と上書きに関する集計（Issue #62）。

docs/decisions/2026-08-04T173602_再公開による上書きの検出についての目標定義.md の
一次データ（R-1 〜 R-3）を再現する。

使い方:
    python3 scripts/survey-republish-overwrite.py [出力ディレクトリ]

選別規則は src/sources/scale-exporter/reader.ts:38 の fileNamePattern と同一にすること。
当方が読まないファイルを数えると、集計が実装の挙動から乖離する。
"""

import collections
import datetime
import json
import os
import re
import sys

FILE_NAME_PATTERN = re.compile(
    r"^scale_exporter_(\d{4}-\d{2}-\d{2})_(apple-health|google-fit)_(\d{3})\.jsonl$"
)
JST = datetime.timezone(datetime.timedelta(hours=9))


def resolve_output_dir(argv):
    if len(argv) > 1:
        return os.path.expanduser(argv[1])
    settings_path = os.path.expanduser("~/.config/scale2sheet/settings.json")
    with open(settings_path, encoding="utf8") as handle:
        return os.path.expanduser(json.load(handle)["scale-exporter-output-dir"])


def main():
    output_dir = resolve_output_dir(sys.argv)
    print(f"# 対象: {output_dir}")

    entries = []
    for name in sorted(os.listdir(output_dir)):
        matched = FILE_NAME_PATTERN.match(name)
        if not matched:
            continue
        day, platform, sequence = matched.groups()
        stat = os.stat(os.path.join(output_dir, name))
        entries.append((day, platform, int(sequence), name, stat.st_mtime))

    print(f"# 対象ファイル数: {len(entries)}")

    # R-1 / R-2: 再公開（2 つ以上の連番に現れた測定値）と、そのうち値が変わったもの
    #
    # 単位を必ず明示すること。初稿はレコードの出現件数で数え、
    # 同一ファイル内の重複により血圧を 50% 水増ししていた（reviewer_claude の指摘、2026-08-04）。
    #   distinct : 2 つ以上の連番に現れた (day, platform, measuredAt, kind) の個数 ← 本文はこちらを正とする
    #   records  : 最初の出現より後にある、連番の異なるレコードの件数
    sequences = collections.defaultdict(set)
    values = collections.defaultdict(set)
    record_occurrences = collections.Counter()
    seen_first = {}
    for day, platform, sequence, name, _ in entries:
        with open(os.path.join(output_dir, name), encoding="utf8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                record = json.loads(line)
                key = (day, platform, record["measuredAt"], record["kind"])
                sequences[key].add(sequence)
                values[key].add(record["value"])
                first = seen_first.get(key)
                if first is None:
                    seen_first[key] = sequence
                elif first != sequence:
                    record_occurrences[record["kind"]] += 1

    distinct = collections.Counter()
    changed = collections.Counter()
    for key, sequence_set in sequences.items():
        if len(sequence_set) > 1:
            distinct[key[3]] += 1
            if len(values[key]) > 1:
                changed[key[3]] += 1

    print()
    print("== R-1 / R-2 再公開（2 つ以上の連番に現れた測定値）")
    print("  distinct（測定値の数。本文はこちらを正とする):", dict(distinct))
    print("  records （レコードの出現件数。同一ファイル内の重複を含む):", dict(record_occurrences))
    print("  distinct のうち値が複数あったもの:", dict(changed))
    transfer_kinds = ("weight", "bodyTemperature", "bloodPressureSystolic",
                      "bloodPressureDiastolic", "heartRate")
    print("  転記に使う kind のうち、値が変わった再公開:",
          {k: changed[k] for k in transfer_kinds if changed[k]})

    # R-3: mtime が対象日より後のファイル
    late = []
    for day, platform, sequence, name, mtime in entries:
        target = datetime.datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=JST).date()
        modified = datetime.datetime.fromtimestamp(mtime, JST)
        if modified.date() > target:
            late.append((modified, name, (modified.date() - target).days))

    print()
    print("== R-3 producer 以外の書き手の痕跡（mtime が対象日より後）")
    print(f"  該当ファイル: {len(late)} / {len(entries)}")
    if late:
        buckets = collections.Counter(f"{m:%Y-%m-%d %H:%M}" for m, _, _ in late)
        print("  同一分に集中している上位:")
        for stamp, count in buckets.most_common(5):
            print(f"    {stamp}: {count} ファイル")
        print(f"  対象日から mtime までの最大日数: +{max(d for _, _, d in late)} 日")
        print("  ※ 実測できるのは mtime の変化であって内容の変化ではない。")
        print("    ただし『入力ファイルは producer だけが書く』という前提は成り立たない。")


if __name__ == "__main__":
    main()
