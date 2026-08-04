#!/usr/bin/env python3
"""測定の同一性に関する集計（Issue #63）。

docs/decisions/2026-08-04T154921_測定の同一性と件数の単位の目標定義.md の
一次データ（H-1 〜 H-4）を再現する。

使い方:
    python3 scripts/survey-measurement-identity.py [出力ディレクトリ]

出力ディレクトリを省略した場合は ~/.config/scale2sheet/settings.json の
scale-exporter-output-dir を読む。

数え方の単位を必ず明示すること。同じ問いでも単位が違えば数が変わる。

    K  両経路に存在する (day, measuredAt, kind) キーの個数
    R  apple 側のレコード数
    P  値ペア（経路をまたぐ組み合わせ、または経路内の隣接値ペア）

旧命名 `apple-health-file`（2026-07-09 のみ）を apple 経路に含めるかで
weight の K が 6 と 5 に分かれる。本スクリプトは含める（--exclude-legacy で除外できる）。
"""

import collections
import json
import os
import re
import sys

FILE_NAME_PATTERN = re.compile(
    r"^scale_exporter_(\d{4}-\d{2}-\d{2})_(apple-health|apple-health-file|google-fit)_(\d{3})\.jsonl$"
)
TOLERANCES = (1e-6, 1e-5, 1e-4, 1e-3)
# 測定機器の分解能（相対差ではなく絶対値）。AC-56 の負のコントロールで使う。
RESOLUTION = {
    "weight": 0.05,
    "bodyTemperature": 0.1,
    "bloodPressureSystolic": 1.0,
    "bloodPressureDiastolic": 1.0,
    "heartRate": 1.0,
}


def resolve_output_dir(argv):
    positional = [a for a in argv[1:] if not a.startswith("--")]
    if positional:
        return os.path.expanduser(positional[0])
    settings_path = os.path.expanduser("~/.config/scale2sheet/settings.json")
    with open(settings_path, encoding="utf8") as handle:
        return os.path.expanduser(json.load(handle)["scale-exporter-output-dir"])


def load(output_dir, include_legacy):
    """(platform, day, record) の列を返す。platform は "apple" か "google"。"""
    for name in sorted(os.listdir(output_dir)):
        matched = FILE_NAME_PATTERN.match(name)
        if not matched:
            continue
        day, raw_platform, _ = matched.groups()
        if raw_platform == "apple-health-file" and not include_legacy:
            continue
        platform = "google" if raw_platform == "google-fit" else "apple"
        with open(os.path.join(output_dir, name), encoding="utf8") as handle:
            for line in handle:
                if line.strip():
                    yield platform, day, json.loads(line)


def relative_difference(a, b):
    return abs(b - a) / max(abs(a), abs(b), 1e-9)


def main():
    include_legacy = "--exclude-legacy" not in sys.argv
    output_dir = resolve_output_dir(sys.argv)
    print(f"# 対象: {output_dir}")
    print(f"# 旧命名 apple-health-file を含める: {include_legacy}")

    by_platform = {"apple": collections.defaultdict(list), "google": collections.defaultdict(list)}
    for platform, day, record in load(output_dir, include_legacy):
        by_platform[platform][(day, record["measuredAt"], record["kind"])].append(record["value"])

    apple, google = by_platform["apple"], by_platform["google"]
    shared = sorted(set(apple) & set(google))

    print()
    print("== H-1 経路をまたいだ同一測定")
    print(f"  K（両経路に存在するキー）      = {len(shared)}")
    print(f"  R（apple 側のレコード数）      = {sum(len(apple[k]) for k in shared)}")
    print(f"  P（経路をまたぐ値ペア）        = {sum(len(apple[k]) * len(google[k]) for k in shared)}")
    print("  K の kind 別:", dict(collections.Counter(k[2] for k in shared)))

    buckets = collections.Counter()
    max_cross = 0.0
    for key in shared:
        for value in apple[key]:
            difference = min(abs(other - value) for other in google[key])
            max_cross = max(max_cross, difference)
            if difference == 0:
                buckets["完全一致"] += 1
            elif difference < 1e-3:
                buckets["差 <1e-3"] += 1
            else:
                buckets["中間帯（差 >=1e-3）"] += 1
    print("  値の一致:", dict(buckets))
    print(f"  経路をまたぐ差の最大値 = {max_cross:.6g}")

    print()
    print("== H-2 / H-2b 負のコントロール（経路の内側の同キー・値相違）")
    for platform, table in (("google", google), ("apple", apple)):
        keys = [k for k, v in table.items() if len(set(v)) > 1]
        pairs = []
        for key in keys:
            values = sorted(set(table[key]))
            pairs.extend(zip(values, values[1:]))
        print(f"  {platform}: K = {len(keys)} / P = {len(pairs)}"
              f" / kind 別 {dict(collections.Counter(k[2] for k in keys))}")
        if not pairs:
            continue
        relative = sorted(relative_difference(a, b) for a, b in pairs)
        absolute = sorted(b - a for a, b in pairs)
        print(f"    絶対差: 最小 {absolute[0]:.6g} / 中央 {absolute[len(absolute) // 2]:.6g}"
              f" / 最大 {absolute[-1]:.6g}")
        print(f"    相対差: 最小 {relative[0]:.6g}")
        print("    許容差を経路内へ適用したとき誤って併合されるペア数:")
        for tolerance in TOLERANCES:
            merged = sum(1 for r in relative if r < tolerance)
            print(f"      相対 {tolerance:>7.0e}: {merged}")

    print()
    print("== 判定")
    intra = [relative_difference(a, b)
             for table in (google,)
             for key, values in table.items()
             if len(set(values)) > 1
             for a, b in zip(sorted(set(values)), sorted(set(values))[1:])]
    if intra and max_cross > min(intra):
        print("  経路内の最小相対差 < 経路をまたぐ最大差:"
              f" {min(intra):.6g} < {max_cross:.6g}")
        print("  → 値の大きさでは分離できない。経路軸で限定しない限り本物の測定を併合する（H-2b）")
    else:
        print("  値の大きさで分離できている。経路軸の限定が不要か再検討すること")

    print()
    print("== H-3 重複を消すと何を失うか")
    only_apple = set(apple) - set(google)
    print(f"  apple 側にしか無いキー: {len(only_apple)} / {len(apple)}")
    print("  kind 別:", dict(collections.Counter(k[2] for k in only_apple)))


if __name__ == "__main__":
    main()
