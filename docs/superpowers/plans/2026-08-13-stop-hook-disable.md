---
type: Plan
title: Issue #29 Stop hook 個別無効化計画
description: Codex の非互換 Stop hook だけを公式 state 経路で無効化し、他イベントを維持する。
tags:
  - plan
  - codex
  - hook
  - issue-29
timestamp: "2026-08-13T19:33:10+09:00"
status: completed
issue: 29
---

# Issue #29 Stop hook 個別無効化計画

> **For agentic workers:** この計画は `scale2sheet_owner_codex` がインライン実行する。対向 LLM エージェントは配置しない。

**Goal:** `invalid stop hook JSON output` の原因となる2つの Stop hook を無効化し、Stop 以外の hook とプラグインキャッシュを変更しない。

**Scope:** `/Users/kappa/.codex` の Codex ユーザー設定 state。リポジトリの Go source は変更しない。

**Method:** Codex 0.147.0 app-server の `hooks/list` で対象キーを確認し、`config/batchWrite` で `hooks.state` の2キーだけへ `enabled: false` を upsertする。

**Decision:** [Stop hook 個別無効化手段の検討書](../../decisions/2026-08-13T193310_Stop_hook個別無効化手段の検討書.md)

## Global Constraints

- 1 Issue 1目的、1 Issue 1 PRとする。
- `cc-status` と security-guidance の Stop だけを無効化する。
- Stop 以外の hook イベントを変更しない。
- プラグインキャッシュを直接編集しない。
- wrapper 化、全 hook 停止、Go アプリ変更は行わない。
- 設定変更は公式 app-server 経路で行い、同じキーでロールバック可能にする。

## Tasks

### Task 1: 事前状態を取得する

- [x] `codex --version` で対象 CLI を確認する。
- [x] `hooks/list` で2つの Stop key が enabled・非 managed であることを確認する。
- [x] Stop 以外の hook key の存在を記録する。

### Task 2: 公式 state 経路で無効化する

- [x] `config/batchWrite` で2つの Stop key に `enabled: false` を upsertする。
- [x] `reloadUserConfig: true` の結果を保存する。

### Task 3: 変更後の状態と非対象を確認する

- [x] `hooks/list` で2つの Stop key が disabled であることを確認する。
- [x] Stop 以外の key が enabled のままであることを確認する。
- [x] Stop 定義の `currentHash` が変更前後で同一であり、プラグインキャッシュと `hooks.json` を直接編集していないことを確認する。

### Task 4: 実行経路を確認する

- [x] 新しい Codex プロセスの `codex exec --ephemeral --json` 終了経路で `invalid stop hook JSON output` が再発しないことを確認する。
- [x] `codex exec` は exit `0`、最終応答 `OK`。現行セッションの再起動待ちではなく、新プロセスで確認した。

### Task 5: 記録と PR

- [x] 設定変更、検証、ロールバック方法を本計画へ記録する。
- [ ] Issue #29 だけを close する PR を作成する。

## ロールバック手順

同じ2つの key を `enabled: true` で `config/batchWrite` へ upsertし、`hooks/list` で enabled を確認する。

## 検証結果

### 実施記録（2026-08-13T19:35:04+09:00）

- CLI: `codex-cli 0.147.0`
- 事前 `hooks/list`: `/Users/kappa/.codex/hooks.json:stop:0:0` と `security-guidance@claude-plugins-official:hooks/hooks.json:stop:0:0` はともに `enabled: true`、`isManaged: false`。
- 変更: app-server の `config/batchWrite`、`keyPath=hooks.state`、`mergeStrategy=upsert`、`reloadUserConfig=true`。
- 結果: `status=ok`、対象2キーは `enabled: false`。
- 非対象: `preToolUse`、`postToolUse`、`sessionStart`、`sessionEnd`、`userPromptSubmit`、`permissionRequest` は `enabled: true` のまま。
- 定義 hash: `cc-status` の Stop は `sha256:754e71791b2e2e49aba0e8554f758a10cd7e4fb115d0d45ad5263bb1ce15edf4`、security-guidance の Stop は `sha256:5d8880157e747997146b5eb0443a43909e23fb0203e64ae4895eff5a1b0282fa` で変更前後に差がない。
- 新プロセス確認: `codex exec --ephemeral --json --color never -s read-only 'Reply with exactly OK and do not run tools.'` は exit `0`、最終応答は `OK`。出力に `invalid stop hook JSON output` は無かった。
- 既知の範囲外警告: app-server は hooks の二重表現（`hooks.json` と `config.toml`）について警告した。Stop エラーとは別課題であり、この Issue では変更しない。
