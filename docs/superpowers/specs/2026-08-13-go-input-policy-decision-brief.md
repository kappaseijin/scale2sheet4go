---
type: Spec
title: Go版AT-10a入力異常ポリシー決定資料
description: Issue #14 で確定したA-0入力異常契約を、現行Go実装・受入証跡・scale_exporter外部契約へ対応付ける。
tags:
  - spec
  - go
  - acceptance
  - input-policy
  - issue-14
timestamp: "2026-08-13T17:26:47+09:00"
status: accepted
issue: 14
---

# Issue #14 Go版AT-10a入力異常ポリシー決定資料

## 目的の妥当性

AT-10a は、scale_exporter の対象日入力に一部異常がある場合の転記可否を決める受入契約である。
この契約は入力読込、pipeline の終了 outcome、status の診断、受入マトリクスにまたがるため、Go ポートの受入テスト全件成功を判定する前に確定する必要がある。

Issue #14 ではユーザー決定を受領し、現行Goの採用契約と、採用しないA-1の変更範囲を確定する。

## 決定概要

ユーザーは **AT-10a=3=A-0** を選択した。

対象日の入力に1ファイルでも1行でも不正がある場合、その日の値全体を疑わしいものとして扱い、transferしない。通知では入力全体を信用できないため転記しない旨を警告する。

決定の正本は [Go版AT-10a入力異常ポリシーをA-0へ確定](../../decisions/2026-08-13T190240_Go版AT-10a入力異常ポリシーをA-0へ確定.md) である。通知文のruntime変更は [Issue #31](https://github.com/kappaseijin/scale2sheet4go/issues/31) の別PRで扱う。

## 外部調査

scale_exporter の外部出力契約を確認した。

- [JSONLFormatter.swift](https://github.com/kappaseijin/scale_exporter/blob/main/Sources/ExportCore/JSONLFormatter.swift) は、非空出力をUTF-8のJSON object行へ変換し、各行と最終recordの後へLFを付ける。
- [OutputWriter.swift](https://github.com/kappaseijin/scale_exporter/blob/main/Sources/ExportCore/OutputWriter.swift) は、file出力を同一directory内の一時fileからatomic renameする。
- 先方の出力契約は、公開fileの構文・終端・公開原子性を定めるが、consumerが不正行を含むfileを全体失敗またはfile単位除外のどちらで扱うかは定めていない。

したがって、外部producerの既存機能でAT-10aの採否を解決することはできない。
producer側の契約は前提として利用し、consumerの入力異常ポリシーは本プロジェクトのユーザー決定として残す。

## 現行Go実装の事実

コードグラフで `ReadStableInputSnapshot`、`readSnapshot`、`pipeline.Run`、不正行テストを確認した。

| 確認対象 | 現行の事実 | 根拠 |
| --- | --- | --- |
| 安定snapshot | 最大3回のattemptでtarget file集合を安定確認する | `internal/pipeline/input_snapshot.go:77-162` |
| file読込 | `readSnapshot` はfileを順に読み、最初のparse errorで全体を返す | `internal/pipeline/input_snapshot.go:225-246` |
| 失敗情報 | `InputSnapshotError` は `Outcome`、`Diagnostic`、matched/read line count、命名異常候補を持つが、除外file一覧は持たない | `internal/pipeline/input_snapshot.go:22-32` |
| pipeline連携 | snapshot errorを `failed:input-invalid-or-partial`、exit `1`、transfer未実行としてstatusへ書く | `internal/pipeline/pipeline.go:35-177` |
| 回帰テスト | 不正行1件で `input-invalid-or-partial` と read line count `1` を期待する | `internal/pipeline/input_snapshot_test.go:46-61` |

このため、現行mainの挙動はA-0であり、A-1を既に満たしているとは判定しない。

## 選択肢

| 選択肢 | 入力契約 | 必要な変更 | 受入判定 |
| --- | --- | --- | --- |
| **A-0（採用）** | 対象fileの一つでもparse不能なら、その安定snapshot全体を失敗にする | 現行runtimeを採用契約として固定し、設計書・AT-10a・GoテストをA-0へ整合させる | `failed:input-invalid-or-partial`、exit `1`、transferなしをPASSにする |
| **A-1（不採用）** | parse不能fileをfile単位で除外し、included fileだけで処理する。全file除外時は失敗する | file-local result、除外理由・file名・最初の失敗行・除外行数、partial status/log/doctor、テスト、definition version、導入計画が必要 | 現行GoのAT-10a契約には含めない |

A-1は行単位の黙ったスキップではない。
不正fileの既読行をincluded結果へ混ぜず、除外事実を構造化して記録する必要がある。

## 参考: A-1を選ぶ場合の導入時期

以下は比較検討の履歴であり、現行Goの契約ではない。A-1を採用しないため、I-before / I-afterの導入時期は発生しない。

| 選択肢 | 有効化境界 | 帰結 |
| --- | --- | --- |
| **I-before** | cutover gate判定前にA-1を有効化 | gateで使う観測履歴の意味がA-1へ変わる。partial診断をgate前から観測できる |
| **I-after** | cutover gate判定後にA-1を有効化 | gateはA-0の一貫した意味で判定できる。A-1は別の観測期間を必要とする |

ここでいうbefore/afterはmerge日ではなく、A-1を対象経路の実行体で有効化する時点である。

## 決定済み項目

ユーザー決定は次のとおりである。

1. **入力異常ポリシー**: A-0
2. **通知**: 入力全体を信用できず転記しない旨を警告する
3. **A-1の導入時期**: A-1不採用のため該当なし

Issue #14では現行Go実装を採用契約として設計書・受入表へ反映する。
通知文の実装はIssue #31・別PRへ分ける。

## 非目標

- A-1の比較表は採用しなかった案の検討記録として残す。
- このIssueではruntime code、status schema、doctor、実行体のcutoverを変更しない。
- このIssueでは通知文のruntime実装を変更しない。
- AT-01〜AT-06の実Google受入判定を変更しない。
- fake、blackhole、scale_exporterのproducer出力契約を実Google成功の根拠にしない。

## 検証記録

- codebase-memoryのindex status: `ready`（main `9eb0040` を含む現行グラフ）。
- `ReadStableInputSnapshot`、`readSnapshot`、`pipeline.Run`、不正行テストをgraph search / snippetで確認した。
- `bash scripts/check-go-quality-gates.sh`: PASS。
- `bash scripts/run-go-acceptance-matrix.sh`: 8本すべてPASS。
- 実Google AT-01〜AT-06は専用環境未提供のため `BLOCKED_EXTERNAL` のまま保持する。
