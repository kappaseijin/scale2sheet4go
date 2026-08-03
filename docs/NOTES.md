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
