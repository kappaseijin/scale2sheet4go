---
type: Plan
title: Issue #35 PostToolUse hook 失敗の抑制計画
description: Codex と互換性のない security-guidance PostToolUse だけを公式 state 経路で停止する。
tags:
  - plan
  - codex
  - hook
  - issue-35
timestamp: "2026-08-13T19:50:57+09:00"
status: in_progress
issue: 35
---

# Issue #35 PostToolUse hook 失敗の抑制計画

> **For agentic workers:** この計画は `scale2sheet_owner_codex` が実行する。対向 LLM エージェントは配置しない。

**Goal:** Codex の PostToolUse 出力契約に適合しない security-guidance hook を停止し、`PostToolUse hook (failed)` の表示を抑制する。

**Scope:** `/Users/kappa/.codex` の hook state と、原因および検証結果を記録するリポジトリ資料。

**Decision:** [PostToolUse hook の互換性に関する対応方針](../decisions/2026-08-13T195057_PostToolUse_hook互換性の検討書.md)

## 制約

- 1 Issue 1 目的、1 Issue 1 PRとする。
- security-guidance の PostToolUse 6 件だけを無効化する。
- グローバルの PostToolUse と security-guidance の非 PostToolUse を維持する。
- Stop hook、Go アプリ、プラグインキャッシュをこの Issue で変更しない。
- 設定変更は Codex app-server `config/batchWrite` を使う。
- 変更前後の hook key、状態、`currentHash`、実行結果を記録する。

## タスク

### Task 1: 原因と対象を確定する

- [x] Issue #35 を起票する。
- [x] Codex 0.147.0 の `hooks/list` で現在の hook key を取得する。
- [x] security-guidance の Bash hook が 5 件に展開されることを確認する。
- [x] `metrics` 出力と Codex schema の不一致を確認する。
- [x] `cc-status` と `save-plan-log.sh` が原因でないことを確認する。

### Task 2: 対応方針を保存する

- [x] 検討書へ原因、採用範囲、非対象、外部資料、ロールバックを記録する。
- [x] 本計画へ実行手順と検証条件を記録する。

### Task 3: 公式 state 経路で停止する

- [x] `hooks/list` から対象 6 件の最新 key と hash を取得する。
- [x] `config/batchWrite` の `hooks.state` へ対象 6 件を `enabled: false` で upsertする。
- [x] `status=ok` と `reloadUserConfig=true` を確認する。

### Task 4: 非対象と再現経路を検証する

- [x] 対象 6 件が disabled であることを確認する。
- [x] グローバルの PostToolUse と security-guidance の SessionStart、UserPromptSubmit が enabled のままであることを確認する。
- [x] 対象 6 件の `currentHash` が変更前後で同一であることを確認する。
- [x] 新しい Codex プロセスで Bash の PostToolUse を実行し、`PostToolUse hook (failed)` が出ないことを確認する。
- [x] `git commit` の synthetic test で security-guidance の PostToolUse 実行が 0 件であり、失敗表示が出ないことを確認する。

### Task 5: PR と Issue を完了する

- [x] 検証結果を本計画と Issue #35 へ記録する。
- [x] Issue #35 だけを close する PR #36 を作成する。
- [ ] 必要なチェックが通ったら PR #36 をマージする。

## 実行手順

1. `hooks/list` で対象 key と変更前状態を取得する。
2. `config/batchWrite` の `keyPath=hooks.state` と `mergeStrategy=upsert` で 6 件へ `enabled: false` を書く。
3. `hooks/list` を再取得し、対象と非対象の状態を比較する。
4. `codex exec --ephemeral --json` で新しいプロセスを起動して PostToolUse を通過させる。
5. リポジトリの資料検査と Go quality gate を実行する。

## ロールバック

同じ 6 件の key へ `enabled: true` を upsertし、`hooks/list` で enabled に戻ったことを確認する。

## 検証結果

### 実施記録（2026-08-13T19:55:36+09:00）

- CLI: `codex-cli 0.147.0`。
- 変更経路: Codex app-server の `config/batchWrite`。
- 変更値: `keyPath=hooks.state`、`mergeStrategy=upsert`、対象 6 件に `enabled=false`、`reloadUserConfig=true`。
- 結果: `status=ok`。
- 対象 6 件: security-guidance の PostToolUse Edit 系 1 件と Bash 系 5 件が disabled。
- 非対象: グローバルの PostToolUse `cc-status` と `save-plan-log.sh`、security-guidance の SessionStart と UserPromptSubmit は enabled のまま。
- Stop: グローバルと security-guidance の Stop は Issue #29 の disabled 状態を維持。
- hash: Edit 系は `sha256:e1f574c07fd492df4de2ceb615c3b0a2a3eca27329bf0929ff9095650c7174bf`、Bash 系 5 件は `sha256:ff051adf363232a355758bbc96941b87ab8b38bd47e6c5940b1232827a68b6d6` で変更前後に差がない。
- 新しい Codex プロセスの Bash echo test: exit `0`、コマンド実行を確認、`PostToolUse hook (failed)` は出なかった。
- 新しい Codex プロセスの synthetic git commit test: exit `0`、commit 実行を確認、測定区間の security-guidance PostToolUse ログは `0` 件、`PostToolUse hook (failed)` は出なかった。
- 既知の範囲外警告: `hooks.json` と `config.toml` の二重表現警告は残るが、PostToolUse failure とは別課題なので変更しない。

現行 Codex セッションは起動時に読み込んだ hook registry を保持する可能性がある。
設定変更後の確認には新しい Codex プロセスを使った。
