---
type: DecisionRecord
title: pipeline 実装判断（status・通知・件数 schema）
description: Slice 2 pipeline の実装で確定した status 書式、件数の未計測表現、通知文面を記録する。
status: proposed
timestamp: "2026-08-04T15:23:00+09:00"
---

# pipeline 実装判断

Slice 2 の実装で、既存検討書が実装へ委ねていた事項を次のとおり固定する。

- `pipeline-status.json` は一時ファイルへ mode `0600` で書き、`rename` で atomic replacement する。
- `outcome` は `PipelineOutcome` の文字列を schema として使用する。成功は `completed:no-data` または `completed:transferred`、失敗は `failed:input-missing`、`failed:input-unstable`、`failed:input-invalid-or-partial`、`failed:transfer`、引数不正は `failed:invalid-arguments` とする。
- 件数フィールドは `matchedFileCount`、`readLineCount`、`windowedReadingCount` とする。処理段階が到達していない件数はキーを欠落させ、`0` と区別する。
- macOS 通知は段階（`input` または `transfer`）と `period` を含む日本語文面とし、通知 port 経由で要求する。pipeline core は OS 実装を直接参照しない。

