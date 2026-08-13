---
type: Decision
title: Codex PreToolUse hook の permissionDecision:allow 互換性調査
description: Codex の PreToolUse hook が allow 単独を拒否する原因と、更新を含む対応候補を整理する。
tags:
  - decision
  - codex
  - hook
  - issue-39
timestamp: "2026-08-13T21:47:41+09:00"
status: accepted
issue: 39
---

# Codex PreToolUse hook の permissionDecision:allow 互換性調査

## 調査結果

現象は、Codex が Claude Code 互換の `permissionDecision: "allow"` を、Codex の PreToolUse 契約で許される形ではない出力として拒否していることで発生する。

現在の Codex 公式契約では、PreToolUse の `allow` は `updatedInput` を伴う入力書き換えに限って使用する。
単に「この入力は許可済み」と伝えるための `allow` 単独は非対応であり、承認不要の場合は exit 0 かつ stdout 無出力で継続する。
リマインダーなどの情報注入は `hookSpecificOutput.additionalContext` のみを返す。

## 現在の発生源

- `/Users/kappa/.codex/hooks.json` の `Bash` matcher が次の2本を登録している。
  - `/Users/kappa/.agents/bin/auto-allow-agent-cmds.sh`
  - `/Users/kappa/.codex/hooks/retrospective-reminder.sh`
- 前者は許可対象コマンドで `permissionDecision: "allow"` を返す。
- 後者はリマインダーを注入する場合にも `permissionDecision: "allow"` を返す。
- 直接実行すると、両方とも exit 0 で `permissionDecision: "allow"` を出力する。
- `approval_policy = "never"` のため、現行 Codex 設定では auto-allow hook の承認回避機能は冗長である。

参照:

- [Codex hooks の PreToolUse 契約](https://developers.openai.com/codex/hooks/)
- [Codex hooks の現行 parser](https://github.com/openai/codex/blob/main/codex-rs/hooks/src/engine/output_parser.rs)
- [Issue #39](https://github.com/kappaseijin/scale2sheet4go/issues/39)

## 更新候補の評価

### Codex CLI の更新

現行 CLI は `codex-cli 0.147.0` である。
ただし upstream の現行 parser と公式 docs も allow 単独を拒否しているため、Codex CLI の更新だけでは解消を期待できない。
更新する場合も、hook 出力を契約に合わせた後の再検証を目的とする。

### agmsg スキルの更新

インストール済み agmsg は `v1.1.12`、upstream `main` は `1.1.13` である。
しかし今回の `allow` 出力を返す2本は agmsg 本体の Codex bridge ではなく、ローカル Codex hook と `/Users/kappa/.agents/bin` の補助 hook である。
agmsg 更新単独では直接の修正にならない。

### security-guidance プラグインの更新

インストール済み security-guidance は `2.0.7` である。
同プラグインの hook 定義は SessionStart、UserPromptSubmit、PostToolUse、Stop であり、今回の PreToolUse 出力元ではない。
したがって更新単独では直接の修正にならない。

## 対応候補

1. ローカル hook を Codex 契約へ合わせる（推奨）。
   auto-allow は許可時に無出力で終了し、retrospective reminder は `additionalContext` のみ返す。
   現在の承認ポリシーとリマインダーを保ちながら、最小範囲で直す。
2. Codex CLI を更新してから再検証する。
   本体の更新を先に確認できるが、現行 upstream 仕様上、更新単独では解消しない可能性が高い。
3. agmsg を `1.1.13` 以降へ更新する。
   Codex bridge の改善は取り込めるが、今回の2本の hook は対象外であり、エラー解消とは分離して扱う。
4. Codex hooks 全体を無効化する。
   エラーは止まるが、code-discovery gate、状態表示、計画保存、リマインダーも失われるため最後の手段とする。

## 採用方針と実施結果

ユーザーは候補1を選択した。
次の2本だけを Codex の現行契約へ合わせた。

- `/Users/kappa/.agents/bin/auto-allow-agent-cmds.sh`
  - 許可対象コマンドでは `permissionDecision` を出力せず、exit 0 で継続する。
- `/Users/kappa/.codex/hooks/retrospective-reminder.sh`
  - リマインダー時は `hookSpecificOutput.additionalContext` のみを返す。

Codex 設定、agmsg 本体、security-guidance プラグイン、その他の hook は変更していない。

## 検証結果

2026-08-13T21:55:11+09:00 に次を確認した。

| 検査 | 結果 |
| --- | --- |
| `bash scripts/test-codex-pretooluse-hooks.sh` | PASS |
| hook 2本と契約テストの `bash -n` | PASS |
| 新しい `codex exec --ephemeral --json` で agmsg read-only command | exit 0、対象 command exit 0 |
| 同 Codex 実行の `unsupported permissionDecision:allow` | 不在 |
| 同 Codex 実行の `PreToolUse hook (failed)` | 不在 |
| `bash scripts/check-go-quality-gates.sh` | PASS |
| `bash scripts/run-go-acceptance-matrix.sh` | PASS（8 scripts） |
| README／文書参照／AC 台帳／diff 検査 | PASS |

なお、新しい Codex プロセスの起動時には未認証 MCP に関する既存の stderr エラーが出た。
対象 Bash command は正常に完了しており、PreToolUse エラーとは別系統であるため本 Issue の対象外とする。
