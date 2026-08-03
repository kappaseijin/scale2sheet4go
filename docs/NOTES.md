---
type: Notes
title: scale2sheet 作業ログ・調査メモ
description: 決定書（decisions/）にも計画（PLAN.md）にも属さない作業記録を時系列で残す。
tags:
  - notes
timestamp: "2026-08-03T10:30:00+09:00"
---

# NOTES

決定は `docs/decisions/`、計画は `docs/PLAN.md`、ユーザー依頼の受付は GitHub Issue が正本。
本ファイルはそれらに属さない作業記録・引き継ぎ・調査メモを時系列（新しいものが上）で残す。

---

## 2026-08-03 reviewer を 1 席へ統合（前項の判断の揺れと確定）

Issue #32 で `scale2sheet_reviewer_codex` を「Claude 系ロールの codex 代替」として終了したあと、
manager が一度その判断を誤りとみなして復席させ、約 30 分後に再終了した。経緯と確定内容を記録する。

### 何が起きたか

前項の終了後、Claude 作成の PR #33 / #36 のレビュー先が不明になった。
manager が `scale2sheet_architect_codex` へ回したところ、次の理由で正当に差し戻された。

> AGENT.md に「PR レビューは担当しない」「Claude 作成物は `scale2sheet_reviewer_codex` が検証」と明記。
> `agent-role.rule.md` も PR review を reviewer 工程としている。

architect は起草ロールでレビュー工程を持たないため、差し戻し自体は正しい。

manager はこれを見て「`reviewer_codex` は Claude 起草物を検証する常設のベンダー跨ぎ検証席であり、
閉じたのは誤りだった」と判断し復席させた。**この判断が誤りだった。**

### 確定内容（ユーザー決定）

> reviewer は Claude が既定。`reviewer_codex` はフォールバック専用。

正本（`~/.agents/rules/model-orchestration.rule.md`）の役割表でも reviewer は claude-code の 1 席のみで、
codex 版は列挙されていない。architect の AGENT.md にあった記述は、フォールバック期間中に
`reviewer_codex` が実在していた時期のものであり、常設の役割分担ではなかった。

**前項の「代替として終了した」という判断は、結果として正しかった。**

### 誤りの原因

manager が、他エージェントの AGENT.md に残っていた記述を常設の役割分担として一般化した。
席の要否は役割表（正本）で判断すべきで、他エージェントの人格定義は常設の根拠にならない。

そもそもこの問いは、manager が PR を起草したことで生まれた。PLAN / NOTES の記録は manager の
担当範囲だが、その成果物を誰が検証するかという問題を自分で作り出す点は意識しておく。

### 反映（PR #42、merge commit b0099cd）

- `docs/PLAN.md`: 役割表の reviewer を 1 行へ統合、開発フローの「別ロールかつ別ベンダー」を「別ロール」へ、
  `reviewer_codex` をフォールバック専用と明記、体制表のラベルを修正
- `~/.agents/rules/agent-role.rule.md`: 検証者条項を「別ロールは必須・ベンダー跨ぎは必須条件としない」へ改訂。
  同一ベンダー時の緩和策と PR 作成アカウント条項を新設
- `~/.agents/rules/model-orchestration.rule.md`: 役割別モデル配置の説明を同趣旨へ更新
- `codex_monitor_agents/scale2sheet_architect_codex/AGENT.md`: 差し戻しの原因になった記述 2 箇所を訂正

### 副次的に判明したこと

reviewer 統合にともない **PR の approve 経路が閉じる**問題が出た。

PLAN は「Claude 成果物の PR は `gh-4claude` で作成する」と定めていたが、これは Claude 成果物を
`reviewer_codex`（4codex）が検証する前提でのみ成立していた。検証先を `reviewer_claude`（4claude）へ
移すと作成者も検証者も 4claude になる。GitHub はセッションやロールではなく**アカウント単位**で判定する。

```
$ GH_CONFIG_DIR=~/.config/gh-4claude gh pr review 41 --approve
failed to create review: GraphQL: Review Can not approve your own pull request
```

PR 作成アカウントの基準を「成果物の作成者側」から「**検証者と別**」へ変更し、
全成果物の PR 作成を `kappaseijin4codex` へ寄せることで解消した。
最初に出した PR #41 自体が 4claude 作成でこの問題の実例になっていたため、
4codex で作り直して PR #42 とした。

### 前項の記述について

前項に「`scale2sheet_reviewer_codex` を代替として終了した」とあるのは正しい記述である。
本項は、その後に manager が判断を揺らした経緯と、ユーザー決定による確定を記録するもの。

## 2026-08-03 codex 代替エージェント（pm_codex / reviewer_codex）の引き継ぎと終了

Issue #32。Claude 系ロールを codex ハーネスで代替していた 2 名を終了し、本来の claude-code 構成へ戻した。

### 背景

Claude がトークン上限で利用不能だった期間、`agent-role.rule.md` の代替条項に基づき
manager と reviewer を codex で立てていた。2026-08-03 に Claude が復帰したため代替を解消する。
同日、scale_exporter チームでも同じ移行が行われた（先方 manager も codex → claude へ復帰）。

### 終了時点の状態（実測）

未 push のコミットは両者ともゼロ。作業消失なし。

- `scale2sheet_pm_codex` 作業ディレクトリ = `dev/scale2sheet`
  - `git log --all --not --remotes` が空。全コミット push 済み
  - 未 push だった `docs/dedicated-agent-tabs`（2 コミット）は PR #33 として push 済み
- `scale2sheet_reviewer_codex` 作業ディレクトリ = `codex_monitor_agents/scale2sheet-reviewer-codex`
  - detached HEAD `6bf25112a8960a9bdb4a943bf86280fadfc92699`
  - この commit は `origin/feat/installer-implementation`（PR #30 の head）に含まれる。ローカル固有のコミットなし
  - 未追跡の `projects/` にレビュー記録あり。**削除せず保持**
    （`projects/scale2sheet/kaizen/2026-08-02_16-09-34-pr30-pr31-single-llm-review.md`）

### 引き継いだ作業内容

両者とも agmsg の引き継ぎ依頼に応答しなかったため、pane の出力から復元した。

**pm_codex**

- 各メンバーへ再開指示を出していた（programmer に PR #30 修正、reviewer_codex に PR #31 formal approve と PR #30 再レビュー、architect に PR #31 最終状態確認、worker に Slice 1 ゲート照合）
- **agmsg だけでなく herdr の各 pane へ直接 `pane send-text` していた**。agmsg を経由しない指示は履歴に残らず追跡不能になるため、以後は行わない
- 実行モデルは `gpt-5.6-luna`（`model-orchestration.rule.md` の manager 配置は `claude-opus-5`。代替時の暫定）

**reviewer_codex**

Claude reviewer 利用不能を前提とした「単独 LLM failover」レビューを実施していた。

- PR #30（head `6bf2511`）: REQUEST_CHANGES
  - `RunLeaseHandle.release()` の cleanup 途中で例外が出ると descriptor が close されず kernel lock が残留
  - owner socket 作成後に receipt write が失敗すると acquire rollback が server と socket を回収しない
  - Acceptance Test Report に Slice 1 の証跡が未記録
  - typecheck / test（10 files 46 tests）/ build:bun / acceptance:runtime-safety / diff --check はいずれも PASS
- PR #31（head `af4dd2a`）: APPROVE
  - PR author と同一アカウント（kappaseijin4codex）のため formal review 投稿は manager へ委ねられ、**未投稿のまま**

### 代替解消にともなう前提の変更

`scale2sheet_reviewer_claude` の復帰により、単独 LLM failover の例外条件は消滅した。
PR #30 / #31 は本来のクロスベンダー検証を reviewer_claude が独立に実施する。
reviewer_codex の所見は参考情報として扱い、追認も引き写しもしない。

reviewer_claude による PR #30 の再検証は同日実施され、REQUEST_CHANGES（blocking 1 件）となった。
指摘は production コードではなく acceptance harness の失敗検知にあり、
排他が壊れた状態を負のコントロールで再現すると harness が FAIL せず無限待機する、という内容。
reviewer_codex が挙げた 3 点とは異なる欠陥であり、単独 LLM 検証では捕捉されていなかった。

### 実施した操作

- agmsg: `leave.sh` で 2 名を scale2sheet チームから離脱
- herdr: tab `w29:tC`（pm_codex、監視ペイン 2 枚を同居）と `w29:tM`（reviewer_codex）を close
  - 監視ペインは事前に `w29:tN`（pm_claude tab）へ再構築済みのため失われていない
- 作業ディレクトリ・クローン・未追跡の作業メモは削除していない

### 現在のチーム構成

| ロール | エージェント | ハーネス | 常駐 |
| --- | --- | --- | --- |
| manager | `scale2sheet_pm_claude` | claude-code | 常駐 |
| innovator | `scale2sheet_innovator_claude` | claude-code | 短命（都度起動） |
| architect | `scale2sheet_architect_codex` | codex | 短命 |
| programmer | `scale2sheet_programmer_codex` | codex | 常駐 |
| reviewer | `scale2sheet_reviewer_claude` | claude-code | 常駐 |
| worker | `scale2sheet_worker_codex` | codex | 短命 |

### 付随して判明した運用上の問題

- `build-up-prj-team.sh` はエージェント種別を接頭辞 `claude_*` / `codex_*` で判定するため、
  `agent-team.rule.md` の派生命名（`scale2sheet_pm_claude` 等）では動かない
- `pr-flow.sh` の `create` は agmsg 送信者・宛先を主人格名（`claude_product_manager` /
  `codex_senior_architect`）でハードコードしており、同じ理由で失敗する。
  `gh pr create` と push は先に完了するため、失敗するのはレビュー依頼の送信のみ
- `agmsg spawn.sh` で新しい tab に起動するには **`--window` と環境変数 `HERDR_WORKSPACE_ID` の両方**が要る。
  `spawn.sh` の `launch_in_herdr()` は `--window` 指定時に `HERDR_WORKSPACE_ID` を読み、
  設定されていれば `herdr tab create --workspace <ws> --label <name>` を実行する。
  未設定なら警告を出して pane 分割へフォールバックし、`--window` 無指定なら常に
  `herdr pane split <呼び出し元 pane>` になる。
  `AGMSG_SPAWN_WORKSPACE` / `AGMSG_SPAWN_LABEL` は `agmsg-spawn-herdr.sh`（非 tmux 経路の
  ターミナル起動ラッパー）向けの変数で、herdr 内から `spawn.sh` を直接叩く経路では参照されない。
  この違いを取り違えて `AGMSG_SPAWN_WORKSPACE` だけを指定したため、呼び出し元 tab が分割された。
  事後に是正する場合は `herdr pane move <pane> --new-tab --label <name>` で分離できる
  （エージェントの再起動は不要）。
  なお `spawn.sh` の usage には「`--window` は tmux 専用」と書かれているが、実装は herdr にも対応している。
  ドキュメントと実装が食い違っている
