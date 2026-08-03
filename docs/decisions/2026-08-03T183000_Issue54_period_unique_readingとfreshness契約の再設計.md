---
type: DecisionRecord
title: Issue #54 period unique reading と freshness 契約の再設計
description: 測定なし日・producer障害・重複公開を区別するための入力契約と通知方針の再設計案。
status: proposed
timestamp: "2026-08-03T18:30:00+09:00"
tags:
  - scale2sheet
  - issue-54
  - exporter-contract
  - freshness
  - slice-2
---

# Issue #54 period unique reading と freshness 契約の再設計

## 要旨

`scale_exporter` は対象日に測定が無い場合、対象日の JSONL file を出力しない。
したがって、対象日の file 不在を `failed:input-missing` とする現行設計は、正常な未測定日と producer 障害を同じ失敗として通知し、偽陽性を生む。

また、closed boundary による再出力では file 数・mtime・inode・size の変化が新しい測定を意味しない。
これらは書きかけ検出には使えるが、freshness の証明にはならない。

本書は、入力の存在ではなく period ごとの unique reading を契約の中心に置き、producer が Application Support 配下へ atomic publish する status の `newUniqueRecordCount` を freshness の判定に使う案を提示する。
JSONL の bounded stable snapshot は廃止せず、役割を「freshness 判定」から「consumer が読む JSONL の整合性・書きかけ検出」へ限定する。

## 前提と契約境界

- `scale2sheet` は exporter を同期起動せず、公開済み JSONL と status を読む consumer である。
- 測定なし日は正常な no-data であり、対象日の JSONL file が存在しないこと自体は失敗ではない。
- producer は period と同一キーの status を Application Support 配下へ atomic publish する。
- status のキーは少なくとも `targetDate`, `period`, `source` を含み、`newUniqueRecordCount` は今回の publish で増えた exact-unique reading 数を表す。
- file 数、mtime、inode、size は freshness の判定材料にしない。
- status が欠落・壊れている・キー不一致の場合、consumer は freshness を判定できない。これは no-data とは異なる契約不成立である。

## 提案する状態分類

consumer は period ごとに次の順で判定する。

1. 対象キーの atomic status を読む。
2. status の契約/schema、対象日、period、source、`newUniqueRecordCount` を検証する。
3. `newUniqueRecordCount = 0` なら `completed:no-data` とし、転記せず終了コード 0 とする。
4. `newUniqueRecordCount > 0` なら JSONL を bounded stable snapshot で読み、period window と exact dedup 後の usable reading を得る。
5. usable reading が 1 件以上なら転記へ進み、0 件なら `failed:input-contract` とする。status が新規を示すのに consumer が読めないためである。
6. status が無い、atomic publish 前の不完全な status、キー不一致、schema 不正、または status と JSONL の整合が取れない場合は `failed:input-contract` とし、転記しない。

`newUniqueRecordCount` は producer が計算した freshness の根拠であり、consumer が file の更新時刻から推測する値ではない。
consumer は独自に period 内の unique reading 数を計算して status の値と照合するが、照合値は freshness の代替ではなく、公開内容の整合性検査である。

## bounded stable snapshot の位置づけ

snapshot は維持するが、契約上の責務を限定する。

- 維持する責務: JSONL の列挙、読取前後の file 集合・path・device・inode・size・mtime の一致確認、strict parse、書きかけや部分公開の検出。
- 廃止する責務: 「新しい測定が公開された」「対象 period が fresh である」「file 不在は producer 失敗である」という推論。
- status が atomic でも JSONL 本体が atomic とは限らないため、`newUniqueRecordCount > 0` の後に JSONL の整合性を検査する必要がある。
- snapshot 不一致は `failed:input-unstable`、parse不能・statusとの不整合は `failed:input-contract` として記録する。

従来の 3 回 × 5 秒は暫定の実装パラメータとして残すが、freshness の保証値とは文書化しない。

## 通知方針

通知は「測定が無かった」ことではなく、「consumer が入力契約を満たすデータを消費できなかった」ことに対して要求する。

| 状態 | outcome | 終了コード | 転記 | 入力段階通知 |
| --- | --- | ---: | --- | --- |
| status の `newUniqueRecordCount = 0` | `completed:no-data` | 0 | しない | しない |
| status > 0、usable reading あり | `completed:input-ready` | 0 | 実施 | しない |
| status > 0、JSONL が不安定 | `failed:input-unstable` | 1 | しない | する |
| status > 0、JSONL parse不能/部分公開 | `failed:input-contract` | 1 | しない | する |
| status 欠落・不正・キー不一致 | `failed:input-contract` | 1 | しない | する |
| status と JSONL の unique 件数不一致 | `failed:input-contract` | 1 | しない | する |

producer が status を公開できない場合は、正常な no-data として黙って終了しない。
status 不在は no-data の証明ではなく、producer の公開契約を検証できない状態だからである。
これにより、file 不在を毎回通知する偽陽性を減らしつつ、producer 停止が長期間沈黙する問題も避ける。

連続観測では `completed:no-data` を正常な観測として記録する。
これにより「実行され、測定が無かった」と「観測不能」を区別でき、10 日連続の失敗が誰にも届かない問題を再発させない。
通知の抑制・集約は Slice 6 の通知実装で行い、Slice 2 は period ごとの outcome と status schema を欠落なく保存する。

## status 最小 schema 案

同一キーの status に次を持たせる。

```json
{
  "schemaVersion": 1,
  "targetDate": "2026-08-03",
  "period": "morning",
  "source": "google_fit",
  "publishId": "…",
  "publishedAt": "2026-08-03T07:10:00+09:00",
  "newUniqueRecordCount": 1,
  "periodUniqueRecordCount": 1,
  "files": [{"path": "…", "size": 1234, "digest": "…"}]
}
```

`newUniqueRecordCount` は freshness 判定用、`periodUniqueRecordCount` は対象 period の公開内容との照合用である。
`publishId` と `files` は、consumer が status と JSONL の世代を照合するために必要である。
status は一時 file へ書き、同一 filesystem 上の rename で atomic publish する。

## AC と正本への反映案

- AC-26: bounded stable snapshot は書きかけ検出として維持し、freshness 判定を含めない。
- AC-27 / AC-28: `completed:no-data` は通知しない。status 欠落・不正、unstable、contract mismatch は入力段階通知対象とする。
- AC-30: 「missing failure / present-zero no-op」を `status=0` の no-data と status 不在の contract failure に置換する。
- AC-29 / AC-31 / AC-36: status schema、outcome、status history に status key、`newUniqueRecordCount`、no-data、contract failure を記録する。
- outcome 表、通知方針、Slice 2 の入力ポートに status reader と atomic publish fixture を追加する。
- 目標定義・設計書・実装分割・受け入れ報告の4箇所へ同じ分類を反映し、定義と検証方法の片方だけが更新される漏れを防ぐ。

## 移行順序

Slice 2 の実装と同時に次の順序を守る。

1. 両 job 停止
2. `scale2sheet` の同期 exporter 起動を除去
3. exporter 側の GF lock / exit 6
4. exporter 側の status / heartbeat / 到達 channel
5. exporter 側 LaunchAgent
6. 手動確認
7. scheduled 再開

逆順の再開および二重 producer は禁止する。
status 契約が未実装の間は Slice 2 の consumer 実装を開始せず、既存の file 不在判定を新契約として扱わない。

## 未決定事項

本書は提案であり、次をユーザー決定の対象とする。

1. `newUniqueRecordCount` / `periodUniqueRecordCount` / `publishId` を必須契約とするか。
2. status と JSONL の世代照合に digest を必須とするか。
3. status 欠落を即時通知するか、連続回数による集約を Slice 6 で行うか。
4. producer が `newUniqueRecordCount = 0` の status を毎回 publish することを先方契約へ含めるか。

status: proposed のまま reviewer の判定基準を先に受け、ユーザー決定後に6正本へ反映する。
