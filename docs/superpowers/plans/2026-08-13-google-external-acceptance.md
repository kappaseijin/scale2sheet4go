---
type: Plan
title: 専用検証環境向け Google 外部受入 runner 実装計画
description: Issue #18 の隔離境界、ケース実行、秘密値非露出、資料更新を実装する計画。
tags:
  - plan
  - go
  - acceptance
  - google
  - scale2sheet
timestamp: "2026-08-13T16:46:49+09:00"
updated: "2026-08-13T17:09:41+09:00"
status: completed
issue: 18
---

# 専用検証環境向け Google 外部受入 runner 実装計画

## Goal

専用 Google 検証環境で AT-01〜AT-06 を安全に再実行できる Go 外部受入 runner を追加し、資格情報や本番設定が無い場合は実行前に fail-closed する。

## Constraints

- 一つの Issue・一つの PR とする。
- 実作業は `scale2sheet_owner_codex` 一席で行い、対向 LLM は配置しない。
- 実ユーザーの HOME、production credential、production Spreadsheet を使わない。
- fake／blackhole の成功を実 Google API の成功として扱わない。
- AT-10a の入力異常ポリシーは Issue #14 の決定なしに変更しない。
- README は利用者向け手順の正本、検討・設計・実装経緯は docs に記録する。

## Task 1: 仕様と既存経路を固定する

- [x] Issue #18 の目的、スコープ、完了条件を起票する。
- [x] Go config、Sheets client、Google Fit OAuth、serve scheduler の既存経路をコードグラフで確認する。
- [x] Google 公式 API／OAuth／service-account 運用資料を確認する。
- [x] [外部受入 runner 設計](../specs/2026-08-13-google-external-acceptance.md) を保存する。

## Task 2: 失敗する契約テストを先に追加する

- [x] opt-in 不足、現在の HOME 指定、marker 不足、credential 不足／権限不備、placeholder Spreadsheet ID を child 起動前に拒否する。
- [x] 専用 HOME への settings 生成・既存 settings の一致検査を確認する。
- [x] fake binary を使い、case ごとの引数と秘密値非露出を検証する。ただし fake binary の PASS は実外部受入の証跡にしない。

## Task 3: 外部受入 runner を実装する

- [x] `scripts/run-google-external-acceptance.sh` を追加する。
- [x] AT-01〜03 の Sheets `run`、AT-04 の Google Fit `run`、AT-05 の bounded `serve`、AT-06 の対話 `auth` を case 単位で実行する。
- [x] AT-05 は SIGTERM、lease 回収、bounded timeout を確認する。
- [x] raw stdout/stderr を結果へ転記せず、ケース・終了コード・ローカル状態だけを記録する。
- [x] 実 Spreadsheet のセル値など自動確認できない項目は `OBSERVATION_REQUIRED` として明示する。

## Task 4: README と受入資料を更新する

- [x] README に専用 Google 検証環境の作成前提、環境変数、marker、設定、各 case、判定、後片付けを記載する。
- [x] `docs/EXTERNAL_TEST_DESIGN.md` に runner と AT-01〜06 の外部判定を記載する。
- [x] `docs/ACCEPTANCE_TEST_REPORT.md` に runner の未実施／実施結果の記録形式を追加する。
- [x] `docs/PLAN.md` に Issue #18 の進捗と残存 external blocker を記録する。

## Task 5: 検証する

- [x] runner の shell syntax と contract test を実行する。
- [x] `bash scripts/check-go-quality-gates.sh`
- [x] `bash scripts/run-go-acceptance-matrix.sh`
- [x] `node scripts/verify-readme-config-keys.mjs`
- [x] `python3 scripts/check-doc-refs.py`
- [x] `python3 scripts/check-ac-ledger.py`
- [x] `git diff --check`
- [x] 実 credential が無い状態で、runner が child を起動せず fail-closed することを確認する。

## Task 6: PR と同期

- [x] 差分が Issue #18 の目的だけであることを確認する。
- [x] Issue #18 の一つの PR（PR #21）を作成する。
- [x] 対向 LLM を配置しないユーザー方針に従い、`scale2sheet_owner_codex` の自己レビュー、ローカル検査、GitHub Actions の全 gate 成功を確認する。
- [x] PR merge 後に main を origin と同期し、作業 branch を削除する。
- [x] Issue #18 を完了条件に従って close する。

## 完了記録

- Issue: [#18](https://github.com/kappaseijin/scale2sheet4go/issues/18)
- PR: [#21](https://github.com/kappaseijin/scale2sheet4go/pull/21)
- merge commit: `7deb919`
- main: `origin/main` と一致、作業 branch は削除済み
- CI: `Go quality gates` PASS
- ローカル: runner contract、Go quality gates、現行 Go acceptance 8本、README／docs／AC検査 PASS

## 完了時の残存ブロッカー

- AT-01〜AT-06 の実 PASS は、専用 Google 検証環境と手動観測が揃うまで確定しない。
- AT-10a は Issue #14 のユーザー決定待ちである。
- 公開配布の署名・公証正常系は Apple=3 により対象外であり、Issue #10 の credentials 待ちではない。秘密情報なしの fail-closed 契約 acceptance は別途維持する。
