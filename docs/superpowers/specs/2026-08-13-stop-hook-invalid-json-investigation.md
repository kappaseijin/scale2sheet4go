---
type: Spec
title: Stop hook invalid JSON 出力の原因調査
description: Codex の Stop hook が invalid JSON output になる原因を、現行設定・実行結果・公式契約から特定する。
tags:
  - spec
  - codex
  - hook
  - diagnosis
  - issue-28
timestamp: "2026-08-13T17:51:17+09:00"
status: implemented
issue: 28
---

# Stop hook invalid JSON 出力の原因調査

## 目的の妥当性

`Stop hook (failed) error: hook returned invalid stop hook JSON output` は、Go ポートの実装不具合ではなく、Codex のターン終了処理を毎回失敗させる実行環境の不具合である。
原因を確定せずに Go コードや agmsg の配送処理を変更すると、対象を誤るため、先に hook の登録元と stdout 契約を確定する。

## 調査範囲

- 現在有効な Codex の Stop hook 登録
- Stop hook コマンドの終了コード、stdout、stderr
- Codex 0.147.0 の Stop hook 出力契約
- プロジェクト固有設定および agmsg との関係

## 調査結果

### 実行経路

1. プロジェクト `/Users/kappa/Dropbox/data/dev/scale2sheet4go` には `.codex/` が存在しない。
2. Codex のグローバル設定 `/Users/kappa/.codex/hooks.json` の `Stop` に、次のコマンドが登録されている。

   `/Users/kappa/.config/iterm2/cc-status`

3. 有効な `security-guidance@claude-plugins-official` プラグインにも `Stop` hook があり、次の Python hook を実行する。

   `security_reminder_hook.py`

4. agmsg の配送状態はこのプロジェクトで `mode: off` であり、今回の Stop hook の直接原因ではない。
5. `cc-status` はプロジェクト内スクリプトではなく、macOS arm64 の Mach-O 実行ファイルである。

### 再現結果

`cc-status` へ `{}`、`{"event":"stop"}`、空入力を渡した結果は、いずれも次のとおりだった。

| 入力 | 終了コード | stdout | stderr |
| --- | ---: | ---: | ---: |
| `{}` | 0 | 0 byte | 0 byte |
| `{"event":"stop"}` | 0 | 0 byte | 0 byte |
| 空入力 | 0 | 0 byte | 0 byte |

Codex 0.147.0 の Stop hook 実行時と同じ「終了コード0」のまま stdout が空であるため、Stop hook の JSON 応答として解釈できない。

`security_reminder_hook.py` へ Stop payload を渡し、LLMレビューを無効化した安全な分岐を実行した結果は次のとおりだった。

```text
exit 0
{"metrics":{"pv":20007,"skipped":true,"skip_reason":3,"fire_index":1,"diff_strategy_v2":true}}
```

この出力は JSON 構文自体は正しいが、Codex Stop hook が受け付ける共通フィールドではない。

### 契約との照合

Codex 公式仕様は、Stop hook が終了コード0で終わる場合、stdout に JSON を返すことを要求している。
継続要求は `{"decision":"block","reason":"..."}` で表し、通常継続の情報は共通 JSON フィールドで表す。

参照: [Codex Hooks](https://developers.openai.com/codex/hooks/)

## 原因

現在は、Codex の Stop hook 出力契約に適合しない hook が2つ有効である。

1. **`cc-status`**: 終了コード0だが stdout が空である。
2. **security-guidance プラグイン**: Claude Code 向けの `metrics`、`skip_reason`、`fire_index`、`diff_strategy_v2` などを stdout へ返す。Stop の Codex schema はイベント固有の未知フィールドを拒否するため、JSONとしては正しくても不正な Stop output になる。

どちらも Codex が Stop hook の stdout を検証する時点で `invalid stop hook JSON output` になり得る。
したがって、`cc-status` だけを Stop から外しても、security-guidance の Stop hook が残る限り同じエラーが継続する可能性がある。

Codex の公式 source でも Stop parser は専用 wire schema を使い、未知フィールドを許可しない実装になっている。
参照: [Codex Stop output parser](https://github.com/openai/codex/blob/main/codex-rs/hooks/src/engine/output_parser.rs)、[Stop hook の未知フィールドに関する公式 Issue #18887](https://github.com/openai/codex/issues/18887)

これは次の問題ではない。

- Go ポートのコード、`go.mod`、受入テスト
- scale2sheet4go のプロジェクト固有 `.codex/hooks.json`
- agmsg の現在の配送モード

## 修正案（実施前）

| 案 | 内容 | 影響 |
| --- | --- | --- |
| **非互換Stopを無効化** | `cc-status` の Stop hook を state で無効化し、security-guidance の Stop hook も無効化する。他イベントは維持する | エラーを止める最小の運用変更。Stop 時の状態表示とsecurity-guidanceの最終レビューは失われる |
| **Codex用wrapperへ変換** | 両hookをwrapper経由で実行し、許可された `continue` / `decision` / `reason` / `systemMessage` だけをstdoutへ出す | 既存機能を残せるが、global wrapperの設計・JSON変換・回帰確認が必要 |
| **Codex hooks を停止** | グローバル hook 機能または全登録を停止する | エラーは止まるが、状態表示・計画保存・自動許可・コード探索 gateも失われる |

## ユーザー決定

ユーザーは **Stop=1「非互換Stopを無効化」** を選択した。

- `cc-status` の Stop hook を、宣言を保持したまま Codex の state で無効化する。
- `security-guidance@claude-plugins-official` の Stop hook を、Codexが提供する個別hook無効化手段で無効化する。
- Stop以外のhookイベントは維持する。
- wrapper変換や全hook停止へは変更しない。

実装と実行経路の再現確認は [Issue #29](https://github.com/kappaseijin/scale2sheet4go/issues/29) で行う。

## Issue #29 実施結果

Codex 0.147.0 の app-server `config/batchWrite` を使い、次の2つの `hooks.state` だけを `enabled: false` として upsertした。

- `/Users/kappa/.codex/hooks.json:stop:0:0`
- `security-guidance@claude-plugins-official:hooks/hooks.json:stop:0:0`

`hooks/list` の再取得で対象2件が disabled、Stop以外のイベントが enabled のままであることを確認した。
対象 hook 定義の `currentHash` は変更前後で同一であり、`hooks.json` とプラグインキャッシュは直接編集していない。
新しい `codex exec --ephemeral --json` プロセスは exit `0` で完了し、`invalid stop hook JSON output` の再発は観測されなかった。

設定変更の詳細とロールバックは [Issue #29 計画](../plans/2026-08-13-stop-hook-disable.md) と [個別無効化手段の検討書](../../decisions/2026-08-13T193310_Stop_hook個別無効化手段の検討書.md) に記録した。

## 未決事項

- Issue #14: Go 版 AT-10a の A-0/A-1 と、A-1 を選ぶ場合の I-before/I-after
- Issue #10: Apple=3 により Developer ID / notarytool / Gatekeeper の正常系受入を対象外とする判断を反映済み。契約 acceptance は継続する
