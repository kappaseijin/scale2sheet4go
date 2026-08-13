---
type: Plan
title: Issue #39 PreToolUse hook 失敗の解消計画
description: Codex の PreToolUse 出力契約に合わせ、allow 単独による失敗表示を解消する。
tags:
  - plan
  - codex
  - hook
  - issue-39
timestamp: "2026-08-13T21:47:41+09:00"
status: completed
issue: 39
---

# Issue #39 PreToolUse hook 失敗の解消計画

> **For agentic workers:** この計画は `codex_product_owner` の派生席が実行する。他のエージェントや LLM は配置しない。

## Goal

`PreToolUse hook (failed)` と `unsupported permissionDecision:allow` を発生させず、必要なリマインダーと現在の Codex 承認ポリシーを維持する。

## 現在の状態

- Issue #39 を起票済み。
- 原因調査と更新候補の評価を [互換性調査](../decisions/2026-08-13T214741_Codex_PreToolUse_hook互換性の調査.md) に記録済み。
- 対応方針はユーザー選択待ち。
- hook、Codex 設定、プラグインキャッシュは未変更。

## タスク

### Task 1: 発生源と契約を確定する

- [x] Codex CLI と `approval_policy` を確認する。
- [x] `~/.codex/hooks.json` の Bash hook 登録を確認する。
- [x] 2本の hook が `permissionDecision: "allow"` を返すことを直接再現する。
- [x] 現行 Codex の PreToolUse 契約と更新候補を照合する。

### Task 2: 対応方針を決める

- [x] Issue #39 を起票する。
- [x] 調査結果と候補を検討書へ記録する。
- [x] ユーザーが対応候補1（ローカル hook を契約準拠へ修正）を選択する。

### Task 3: 選択した対応を実施する

- [x] 選択範囲だけを変更する。
- [x] 既存の他 hook、Go 製品コード、未コミットの README／PLAN 差分を混ぜない。

### Task 4: 再現経路を検証する

- [x] 新しい Codex プロセスで対象 Bash コマンドを実行する。
- [x] `unsupported permissionDecision:allow` が出ないことを確認する。
- [x] retrospective reminder の `additionalContext` が必要な操作で保持されることを確認する。
- [x] 既存の Go quality gate と資料検査を再実行する。

## 実施記録

実施日時: 2026-08-13T21:55:11+09:00。

- `bash scripts/test-codex-pretooluse-hooks.sh`: PASS
- hook 2本と契約テストの `bash -n`: PASS
- 新しい `codex exec --ephemeral --json` の対象 command: exit 0
- `unsupported permissionDecision:allow` と `PreToolUse hook (failed)`: 不在
- `bash scripts/check-go-quality-gates.sh`: PASS
- `bash scripts/run-go-acceptance-matrix.sh`: PASS（8 scripts）
- README／資料参照／AC 台帳／`git diff --check`: PASS

Codex 起動時の未認証 MCP stderr は既存の別課題であり、本計画では変更しない。

## ロールバック

変更前の hook ファイルと `hooks.json` の差分を保存し、対象ファイルだけを元へ戻す。
Codex CLI、agmsg、security-guidance の更新を選んだ場合は、更新前のインストール版へ戻せる手順を別途記録する。
