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

## 2026-08-09

### マージ（6 本、reviewer による判定）

| PR | 内容 | main |
| --- | --- | --- |
| #134 | 通知遷移。notification-state-loss が配送されない欠陥を修正 | 26e4e96 |
| #146 | Google Fit OAuth クライアントを settings.json から読む | 40ab8af |
| #143 | 行決定の characterization（3 往復） | 6e473a4 |
| #147 | exit code の分離（--help が 2 を返す欠陥を修正） | 039c378 |
| #148 | sheet-id / scale-exporter-output-dir の既定値を廃止（5 回差し戻し） | c27c84c |
| #154 | pipeline.test.ts の実時計依存を除去（main を緑へ） | 8725c04 |

tests 203 → 252

### 確立した exit code の規則（PR #147）

- exit 2: CLI の構文・引数エラー（Commander 由来）
- exit 1: 設定・環境・実行時のエラー（必須設定の欠落、入力の読み取り失敗、転記の失敗など）
- exit 0: 正常終了（--help / --version を含む）

### 判定の実績

APPROVED 7 / CHANGES_REQUESTED 10 / 空振り 0（計 17 回）。

差し戻し 10 件はすべて、tsc・Vitest・diff-check が全通過した状態で見つかった。

### 新規 Issue

- #150: エージェント体制の並列増員（reviewer2 / programmer2 / worker2）
- #151: run-pipeline.sh が scale_exporter のビルド生成物を呼んでいる
- #153: pipeline.test.ts の実時計依存（PR #154 で解決）
- #155: 時間依存の試験が clock 指定を忘れても動いてしまう

### cutover（Issue #114）の前提が変わった

gate G-2 の「exporter 自身のスケジュールだけで」は排他条件である。当方が run_exporter を呼んでいる状態では満たせない。

2026-08-09T07:00:00+09:00、scale_exporter のジョブは exit 4 で失敗していた。公開された 4 ファイルは当方の run-pipeline.sh が書いたもの。先方の監査ツールは last_exit=4 を読みながら result=ok を返していた。

順序（ユーザー決定）:
1. 先方が PR #83（flock + exit 6 + 監査の誠実化）をマージ・配備
2. 当方が run_exporter の呼び出しを外す
3. その翌日から連続 2 日観測

---

## 2026-08-03 reviewer を 1 席へ統合（前項の判断の揺れと確定）

Issue #32 で `scale2sheet_reviewer_codex` を「Claude 系ロールの codex 代替」として終了したあと、
manager が一度その判断を誤りとみなして復席させ、約 30 分後に再終了した。経緯と確定内容を記録する。

### 何が起きたか

前項の終了後、Claude 側が起草した PR #33 / #36 のレビュー先が不明になった。

なお 2 本は PR 作成アカウントが異なる。#33 は `kappaseijin4claude`、#36 は**ユーザー本人の既定アカウント
`kappaseijin`** で作成されていた。#36 は manager が `GH_CONFIG_DIR` を付けずに `gh pr create` を実行したためで、
当時のルール（成果物の作成者側のアカウントを使う）からも外れていた。アカウント規律の逸脱が既に 1 件
起きていたことになる。ユーザー判断により #36 はそのまま進めた。
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

### 未投稿のまま消えた判定が 1 件ある

`scale2sheet_reviewer_codex` は 2026-08-02 に PR #31 を単独 LLM failover として検証し APPROVE 判定を出したが、
PR author と同一アカウント（`kappaseijin4codex`）であることを理由に formal review を投稿せず manager へ委ねた。
その委譲は完了しないまま席が閉じたため、**GitHub 上に当該判定の痕跡は残っていない**。

その後 `scale2sheet_reviewer_claude` が独立に再検証し（reviewer_codex の所見は参照していない）、
REQUEST_CHANGES を経て APPROVE に至っている。#31 の GitHub 履歴に reviewer_codex が現れないのはこのため。

### 誤りの原因

manager が、他エージェントの AGENT.md に残っていた記述を常設の役割分担として一般化した。
席の要否は役割表（正本）で判断すべきで、他エージェントの人格定義は常設の根拠にならない。

そもそもこの問いは、manager が PR を起草したことで生まれた。PLAN / NOTES の記録は manager の
担当範囲だが、その成果物を誰が検証するかという問題を自分で作り出す点は意識しておく。

### 反映

**リポジトリ内**（PR #42、merge commit `b0099cd`）

- `docs/PLAN.md`: 役割表の reviewer を 1 行へ統合、開発フローの「別ロールかつ別ベンダー」を「別ロール」へ、
  `reviewer_codex` をフォールバック専用と明記、体制表のラベルを修正

**リポジトリ外**（本リポジトリのコミット単位では追跡できない。`git show b0099cd` には現れない）

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

## main への直接 push の禁止（2026-08-04）

ユーザー決定により、`main` への直接 push を禁止した。変更は PR を経由する。

### GitHub 側では強制できない

`branches/main/protection`（classic）と `rulesets`（新 API）のいずれも、本リポジトリでは
HTTP 403 で拒否される。

```
gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)
```

private リポジトリでこれらを使うには GitHub Pro が必要で、無料プランでは
public 化しない限りサーバ側で強制できない。課金と公開範囲の変更はどちらもユーザーの判断領域。

### クライアント側フックで担保する

各作業クローンの `.git/hooks/pre-push` で `refs/heads/main` 宛の push を exit 1 で拒否する。
設置先は 8 クローン（プロジェクト本体 + `codex_monitor_agents/scale2sheet-*` 7 件）。
設置対象は列挙せず glob で回すこと。初回は明示リストで回したため 1 クローン
（`scale2sheet-installer-slicing-update`）を取りこぼした。

- topic ブランチの push は通る
- `gh pr merge` はサーバ側処理なのでフックの影響を受けない（マージは pm が行う）
- `.git/hooks` は git 管理外のため、**クローンを作り直すと消える**。
  新しいクローンを作ったら再設置すること
- `--no-verify` で迂回できる。これは規約で禁止する（技術的には防げない）
- **`core.hooksPath` が設定されているとフックごと無効になる。** git はこの設定があると
  `.git/hooks` を参照しない。`--global` でも効くため、**別プロジェクトのために設定した値が
  このリポジトリのフックを黙って無効化する**。`--no-verify` と違い意図せず踏む。
  `git config --get core.hooksPath` が空であることを確認する（2026-08-04 時点で
  global・8 クローンすべて未設定）

### フックが拾う経路（実測）

`refs/heads/main` を stdin の `remote_ref` で照合しているため、refspec の書き方に依存しない。
`HEAD:main` 形式・`--all`・`--mirror`・別名リモート経由・worktree からの push は
いずれも拒否される（worktree は `.git` を共有するのでフックも共有される）。

### 経緯

architect が `6683ee1` を PR を経由せず main へ直接 push した（内容は事後レビューで問題なし）。
根本原因は、pm が sandbox 制約による代理コミットを廃止したときに
「PR 経由を維持すること」を明示しなかったこと。個人の注意ではなく工程で塞ぐ形にした。
## codex 席が役割別 config を一度も適用していなかった（2026-08-04）

全 codex 席（architect / programmer / worker）が **base 既定の `gpt-5.6-luna` / effort `low`**
で動いていた。`~/.codex/<role>.config.toml` にはモデルと effort が正しく書かれていたが、
**agmsg の `spawn.sh` が codex 起動時に `-p <profile>` を渡さない**ため一度も適用されていない。

```
規定                                   実際
architect  gpt-5.6-sol   xhigh    →   gpt-5.6-luna low
programmer gpt-5.6-terra medium   →   gpt-5.6-luna low
worker     gpt-5.6-luna  low      →   gpt-5.6-luna low（偶然一致）
```

worker だけ規定と一致していたため、**モデル表示を見ても異常に見えなかった**。

### 発見の経緯

architect へ #66 の起点依頼を出した直後、`herdr pane read` で受領確認をした際に
画面下部のモデル表示が `gpt-5.6-luna low` になっているのを見つけた。
受領確認という別目的の操作から出た。

なお、この事実（`spawn.sh` が `-p` を渡さない）は 2026-08-02 の sandbox 設定調査で
既に判明しており、pm 自身が agmsg でそう説明していた。**判明していたが、
モデル配置への影響として扱っていなかった。** 当時は sandbox の話としてのみ読んでいた。

### 対処

各 pane で `/quit` してから明示フラグで起動し直す。

```sh
codex -m gpt-5.6-sol   -c model_reasoning_effort=xhigh    # architect
codex -m gpt-5.6-terra -c model_reasoning_effort=medium   # programmer
codex -m gpt-5.6-luna  -c model_reasoning_effort=low      # worker
```

起動後に `$agmsg actas <エージェント名>` を実行する（`/agmsg` ではない。codex では
スラッシュ始まりは組込みコマンド扱いになり `Unrecognized command` になる）。

セッションを落とすので文脈は失われる。ブランチと commit は残る。

### 残る問題

`spawn.sh` 経由で起動し直すと再び base 既定に戻る。**恒久対処は agmsg 側**にあり、
本プロジェクトの範囲外。所有チームの manager へ連携する。

### 手順に足すこと

- 席を起動したら、**モデルと effort の表示を規定と照合する**。
  各エージェントの起動時セルフチェックにも入れる（`git status` の可否と同じ扱い）
- Claude 席（reviewer / innovator）は Opus 5 で規定どおりだった。同時に確認した

## 席の入れ替えで踏んだ落とし穴（2026-08-04）

reviewer の ctx が 93% に達したため席を入れ替えた際に、3 つ踏んだ。

### アンダースコアとハイフンで別のディレクトリを指す

```
codex_monitor_agents/scale2sheet_reviewer_claude/   ← 人格定義（AGENT.md, projects/<チーム>/）
codex_monitor_agents/scale2sheet-reviewer-claude/   ← 作業クローン（git リポジトリ）
```

pm が引き継ぎメモの保存先として**作業クローン配下**を指定したが、`agent-role.rule.md` が
定めているのは**人格ディレクトリの `projects/<チーム名>/`** である。指定が規約から外れていた。

さらに pm は作業クローン側を検索して「メモが無い」と判断し、差し戻した。
**両方のディレクトリが実在し、名前が 1 文字違い（区切り文字）でしか区別できない**ため、
検索先を取り違えても異常に見えない。

### 差し戻す直前に測り直していなかった

```
メモの mtime          : 17:27
pm の 2 回目の find   : 約 17:26  ← 書き込みより前
```

1 回目の測定は正しかったが、それを 2 回目の差し戻しにも流用した。
**タイムスタンプに依存する主張は、主張する直前に測り直す。**

### `/exit` は pane ごと落ちる

claude-code のセッションで `/exit` を送ると、セッションだけでなく **pane そのものが消える**
（シェルも残らない。`herdr pane read` が空を返し、`send-text` にも無反応になる）。
pane 一覧には残るので、生きているように見える。

復旧は pane を close してから spawn し直す。

```sh
herdr pane close <pane_id>
HERDR_WORKSPACE_ID=<ws> ~/.agents/skills/agmsg/scripts/spawn.sh \
  claude-code <エージェント名> --fresh --window --team <チーム名>
```

**引数の順序は `<agent-type> <name>`** である。`spawn.sh <チーム名> <エージェント名>` と
書くと `unknown agent type` になる。`--team` はオプションで渡す。

### 手順

- 席を落とす前に、引き継ぎメモの**存在を `ls -l` で確認してから**落とす
- 落とした後に新セッションへ、メモのパスと待っている仕事を明示して渡す
## two-dot diff を「マージしたら消える」と読み違えた（2026-08-04）

起草者から受け取ったブランチを PR にする前に、pm が差分を確認して
「このままマージすると別 PR の成果物 613 行が削除される」と判断し、rebase してから PR を作った。

**判断が誤っていた。** マージしても何も削除されなかった。

```
git diff --stat origin/main d071524      → 4 files, 30 insertions(+), 613 deletions(-)
git diff --stat origin/main...d071524    → 2 files, 30 insertions(+)
```

two-dot（`A B`）は **2 つの状態の差**を出すので、`main` にあって branch に無いものが
削除として現れる。branch の base が古ければ必ず出る。
マージが何をするかを表すのは three-dot（`A...B`＝マージベースからの差）の方。

### より悪かったのは、誤った手順を配ろうとしたこと

pm は起草者へこう指示していた。

> 出す前に `git diff --stat origin/main HEAD` を実行し、意図していない削除が無いことを確認してから SHA を送ってください

**two-dot なので、base が古いだけで毎回 削除差分が出る。** そのまま手順になっていたら、
**存在しない危険を毎回報告させる**ことになっていた。起草者の指摘で撤回した。

個別の誤りは 1 回で終わるが、**誤った手順は毎回再生産される。**
手順として配る前に、その手順が偽陽性を出さないかを確かめる。

### 使い分け

**前提: 表の 3 行はいずれも `origin/main` を基準にする。`origin/main` はローカルの
remote-tracking ref であり、`git fetch` するまで更新されない。** 実行前に必ず fetch する。

```sh
git fetch origin --prune
```

fetch を怠ると、**19 commit 遅れている base を「古くない」と報告する**（実測）。

```
origin/main = ab02483（fetch 前）  → HEAD..origin/main は 0 commits  → 「base は古くない」
origin/main = d214648（fetch 後）  → HEAD..origin/main は 19 commits → 「base は古い」
```

two-dot の誤りは偽陽性（無い危険を報告する）だったが、**こちらは偽陰性**でより危険である。
読み手は「確認した」と思って古い base のまま進む。
**今回の事故の出発点（古い base で作業していた）を検出するための行が、その状況で沈黙する。**

| 知りたいこと | コマンド |
| --- | --- |
| マージで何が変わるか | `git diff --stat origin/main...HEAD`（three-dot） |
| 自分が何を変えたか | `git log --stat origin/main..HEAD` |
| base が古いか | `git log --oneline HEAD..origin/main` |

**GitHub の PR の "Files changed" タブは three-dot** である。
`git diff origin/main...HEAD` と同じものを表示している。

これを知っていると、「PR 画面では 30 行の追加なのに、手元で見たら 613 行削除」という
食い違いに出会ったとき、どちらが正しいかを迷わず判定できる。今回の混乱の実体はこの食い違いだった。

## rebase 競合を握り潰して commit し、detached HEAD のまま push した（2026-08-04）

`git rebase origin/main` が競合した状態で作業を続け、競合マーカーを含んだ commit を作り、
さらにブランチ ref が動かないまま「push した」と報告した。

### git は黙っていない。沈黙させたのはこちら

当初この事象を「競合は後続コマンドを止めない」と記述したが、**誤りだった**（検証者が
使い捨てリポジトリで再現）。git は 2 つの経路で知らせている。

| 当初の記述 | 実測 |
| --- | --- |
| 競合は後続を止めない | `git rebase` は競合で **exit 1**。`git rebase … && 次の処理` は**止まる** |
| `git status` は正常に見える | 競合中は **`UU <path>`**。clean ではない（clean になるのは commit した後） |

沈黙させたのは次の 2 つ。

1. **exit code を握り潰した** — `git rebase … 2>&1 | tail -1` のようにパイプへ流すと、
   パイプライン全体の終了状態は最後のコマンドのものになり、rebase の失敗が消える
2. **競合したファイルをそのまま `git add` し、`git rebase --continue` ではなく
   `git commit` した** — マーカーごと commit され、detached HEAD に積まれる

### 効く防御と、効かない防御

`grep -c '^<<<<<<<'` は**どちらの根本原因にも効かない**。マーカーが commit された後に
気づくための後追いである。効くのは:

- **exit code を握り潰さない。** `&&` で繋ぎ、出力の tail を読む
- **競合時に `git add` で一括 stage しない**

原因を「git が黙る」と書くと、次の人は「git は当てにならないから毎回 grep する」という
防御を組む。**実際には exit code を見れば止まる。**

### 成立する事実（実測で確認済み）

- **競合中は detached HEAD。** `git branch --show-current` は空
- **`git push -f origin <branch>` は exit 0 で成功する。** detached HEAD 側の commit ではなく、
  動いていないブランチ ref を押す。エラーも警告も出ない

このため「push した」「`git log` で確認した」の 2 つを踏んでも気づけない。
どちらも detached HEAD 側を見ている。検証者が `git ls-remote` で照合して発覚した。

### 復帰手順

**`git rebase --quit` を最初に実行する。** rebase 状態が残っている限り、branch ref は
worktree に使用中として保護され、switch も拒否される（実測）。

```
git branch -f side <SHA>   → fatal: cannot force update the branch 'side' used by worktree at …
git switch side            → fatal: cannot switch branch while rebasing
```

正しい順序:

```sh
git rebase --quit             # 先にこれ。rebase 状態だけ捨てる（commit は残る）
git branch -f <branch> <SHA>  # detached HEAD の SHA を指すよう branch ref を動かす
git switch <branch>
```

`git rebase --abort` は競合前の状態へ戻すので、**detached HEAD に積んだ commit ごと失う**。

### push 後の確認

自分の `git log` ではなく、remote と PR の head で照合する。

```sh
git branch --show-current                        # 空でないこと
git ls-remote origin refs/heads/<branch>
gh pr view <PR> --json headRefOid -q .headRefOid
```

## agmsg の本文にバッククォートを含めると実行される（2026-08-04）

`send.sh` へ本文を二重引用符で渡すと、**バッククォートが bash のコマンド置換として実行される。**

実際に起きたこと: 検証者が本文で git コマンドを引用した結果、本文の一部が消えたうえ、
**検証者の作業クローンで意図しない `git rebase` が走った**（共有物への影響は無し。
クローンを origin/main へ戻し、remote の ref が 1 つも動いていないことを確認済み）。

git コマンドを引用しながら連絡する場面が多いので、踏みやすい。

### 手順

本文は必ずファイルへ書いてから渡す。

```sh
cat > /tmp/msg.txt <<'MSG'
...本文（バッククォートを含んでよい）...
MSG
send.sh <team> <from> <to> "$(< /tmp/msg.txt)"
```

ヒアドキュメントの区切り語を **`'MSG'` とクォートする**こと。クォートしないと
ヒアドキュメント内でも置換が走る。

## D-5 は #63 実装前、転記値を1ビットも変えていなかった（2026-08-06）

`deduplicateCrossSourceReadings`（D-5、経路をまたぐ物理測定の同一性判定）を
`buildLatestMeasurementSet` の入口に配置した段階（PR #127 以前のコミット）では、
**この関数を丸ごと呼ばなくても `run` 経路の出力は 1 文字も変わらなかった。**

変異を当てて実測した。

```
変異: src/service/measurements.ts の
  selectReadingsByWeightAnchor(deduplicateCrossSourceReadings(readings), period)
  → selectReadingsByWeightAnchor(readings, period)

実データ相当の fixture（apple-health と google-fit が同時刻に近似値を公開）を
run 経路（syncMeasurements / collectLatestMeasurementSet）へ通した結果:
  変異前後で出力が完全に同一の文字列
  既存試験 85 件がすべて pass（誰も落ちない）
```

### なぜ落とせなかったか（fixture の作り方の問題ではない）

- D-5 の同一性判定は `measuredAt` の完全一致を要求する（AC-54）。**併合対象は必ず同時刻**になる
- `buildLatestMeasurementSet` の選択（`selectWeightByPeriod` / `selectClosestToReference`、
  `src/domain/measurement.ts`）は strict 比較で**「同着なら先勝ち」**
- dedup 自身も**先に現れた要素を残す**（`retained.find` が最初の一致で確定する実装）

**dedup が残す要素と、dedup 抜きで選択が選ぶ要素は常に同一になる。** 選択側もdedup側も
同じ「先勝ち」規則で動くため、重複を消しても消さなくても最終的に選ばれる1件は変わらない。

一方 `pipeline.ts` 側の cross-source dedup は有効だった（同じ変異を当てると
`test/pipeline/pipeline.test.ts` が落ちる）。ここは transfer へ渡す**配列そのもの**を
比較する試験だったため、要素数の変化（2件→1件）が直接観測できた。

### 影響: F-2 を実装するまで、service 側の dedup は無防備だった

D-5 の効果は**件数にしか現れない。** ところが当時 `LatestMeasurementSet` は件数を
公開しておらず（`windowedReadingCount` / `uniqueMeasurementCount` は F-2 で新設）、
`run` 経路の配置回帰 fixture（「service から dedup を外すと落ちる」試験）を
作ろうとしても作れなかった。

PR #127 で F-2（`uniqueMeasurementCount` を service で数え、両経路から観測できるようにする）
を D-5 と同じ PR に含めたことで、初めてこの配置が試験で守られるようになった。
それまでの間、`service/measurements.ts` の dedup 呼び出しを消す変異が存在しても、
どの試験も気づけない状態だった。

### 次に #63 を触る人へ

同一性・重複除去の実装を経路の異なる箇所（`service` と `pipeline` など）へ重複して置くときは、
**「除去した後に選択される値が、除去前と同じ規則（先勝ち・最新優先など）で選ばれていないか」**
を先に確認すること。同じ規則なら、除去の有無は最終出力を変えない。守りたいのは
たいてい「件数」であり、値そのものではない。件数を外部から観測できる形にしてから
配置回帰の試験を書く。

## 型に欄はあるが値が書かれない（2026-08-11、schema 全体の掃き出し）

**同型が 3 件見つかった。**個別に見つけていたものを、schema 全体を掃くことで数えた。

| Issue | 欄 | 状態 |
| --- | --- | --- |
| #182 | `partialInput` | `...(status.partialInput ? { partialInput: true } : {})` で **`false` を書けない** |
| #242 | `result` の `success` / `nonzero` / `timeout` / `unknown` | **`claimed` を書く 2 箇所しか無い** |
| #243 | `requestedCellCount` | **宣言のみ。書く側も読む側も無い。test も 0 件** |

### 掃き方（reviewer、2026-08-11T01:58+09:00）

`src/pipeline/status.ts` の型宣言から field 名 56 件と union の文字列 40 件を取り、
**`src/` 全体で値として書かれているか**を数えた。

**最初は `status.ts` の中だけで数えて 11 件が「書かれない」と出たが、誤りだった。**
`matchedFileCount` などは `src/pipeline/pipeline.ts` が書いている。

```
**宣言と生成が別 file にあるのが普通なので、file 単位で数えると全部が偽陽性になる**
```

`src/` 全体へ広げて数え直し、偽陽性は `completedAt` / `renameFile` の 2 件まで減った
（いずれも `??` の代入形を正規表現が拾えなかったもの）。

**これは #173 の「0 件でなくても疑う」の逆向きである。多い数のほうが誤りだった。**

### 一般形

```
**欄が型に存在することを、値が書かれることの根拠にしない**
```

`status.ts:134` は 5 値を宣言しているが、実装は 1 値しか書かない。
**型を読んで「記録されている」と判断すると誤る。**#126 と同じ型である。

### 検査化について（未着手）

「型に宣言された field が、`src/` のどこかで値として書かれること」を受け入れ条件に置ける。
負のコントロールは「実装済みの field を 1 つ削ると、その field が検出されること」。

**ただし正規表現では代入形（`??` を含む）を拾えない。実装するなら AST で解く。**
**#243 が片付くまで着手しない。**先に道具を作ると、道具の検証が始まってしまう。

## 負のコントロールには範囲がある（2026-08-11、AC-11 の 7 段階）

**台帳の 1 行（AC-11）を巡って 7 段階を経た。誤り・訂正・実測・残課題の特定・実装を含む。**
**行 4・5・7 の変異試験の結果はどれも正しく、範囲と壊し方の申告が足りなかっただけである。**
**行 1・2 は実測を伴わない誤りである**（関数を読んだだけで結論した）。

| | 誰 | 内容 | 結果 |
| --- | --- | --- | --- |
| 1 | reviewer | 「削除側は `uninstalled <binary-path>` の 1 行だけ」 | **誤り**（`runUninstallCommand` だけを読み、実行していない） |
| 2 | manager | それを受けて AC-11 を降格、Issue を起票 | **誤り**（同じ見落とし） |
| 3 | architect | `src/installation/executor.ts:241-243` が**到達した operation**を出力すると指摘（`src/installation/executor.ts:258-262` で pending を残して return する） | 1 と 2 を撤回 |
| 4 | architect | 変異を当てて **SURVIVED** | **範囲が狭い**（`installation.test.ts` 単体） |
| 5 | reviewer | 広い範囲（`test/installation` + `test/cli`）で **KILLED** | **4 の SURVIVED 自体は正しい。撤回したのは「どの試験にも無い」という一般化だけ** |
| 6 | architect | **composition が未検査**と特定 | **正しい残課題** |
| 7 | worker | 狭い変異で目的の試験だけが KILLED | 実装（PR #266 / #267 / #269）。**PR #270 で AC-11 が PASS へ戻った** |

### 型 1: 読んだ関数と、その経路は違う

```
**その関数が出力していない  ≠  その経路が出力していない**
```

**`runUninstallCommand` が削除側について直接出すのは `uninstalled <binary-path>` の 1 行だけで、**
**残置と purge は同関数が複数行を出す。削除した operation は呼び出し先の `applyOperations` が出す。**
**呼び出し元だけを読んで「出力はこれだけ」と結論した。**

**manager は reviewer の報告を受けて同じ結論を書いた。独立ではない。**
**一次記録（manager の依頼文）に「reviewer の報告を受けて」と在る。**
**同じ誤りが 2 人を通ったのは、検証の独立性ではなく、報告の連鎖による。**

### 型 2: SURVIVED にも範囲がある

```
**変異が SURVIVED した  ≠  その変異を殺す試験が無い**
**実行した試験群に無かっただけかもしれない**
```

**「どの試験群で実行したか」を書かなければ、SURVIVED は根拠にならない。**

### 型 3: 壊し方が大きいと、何が守られているか分からない

```
中央 logger を**全除去**  ->  2 tests failed（**既存の書式試験も巻き込む**）
plist の出力だけ欠落      ->  **新規試験 1 件のみ KILLED**
```

**大きく壊すと、目的の検査以外が先に落ちる。**
**「目的の試験だけが落ちる」変異のほうが、何を守っているかを正確に示す。**

### 型 4: 表示が在ることと、守られていることは違う

```
**production で出力される**（実行して確認した）
**その出力を壊す変異で試験が落ちる**（変異で確認した）
```

**前者だけでは「自動で検証されている」と言えない。**
**台帳の「実施方式」が自動なら、後者まで要る。**

## PR の作成アカウントで、GitHub 上の approve 可否が決まる（2026-08-11）

**GitHub はアカウント単位で自己 approve を拒む。**

**前提: 現体制は 1 vendor 1 account である**（claude 系 = `kappaseijin4claude` / codex 系 = `kappaseijin4codex`）。
**制約の単位は account であり、vendor ではない。**

```
manager（claude 系 = 4claude）が PR を作る
  ->  **claude 系 reviewer（同じ 4claude）は GitHub 上で approve できない**
codex 系の実装を manager が PR 化
  ->  **approve を記録できるのは 4codex だけになる**
  ->  **記録上、実装と同じ account（= 同じ vendor）が承認した形になる**
```

**検証そのものは誰でもできる。**制約は **GitHub の approve が誰に可能か**である。

**実装した席のアカウントで PR を作る。**manager が代理で作ると、
**意図した検証者が approve を記録できず、同一 vendor の承認記録を強いることになる。**

**本日 2 回踏んだ。**1 回目は claude reviewer が approve できず codex へ振り替え、
2 回目は PR を close して worker のアカウントで作り直した。

## Issue が open であることは、問題が現存する根拠にならない（2026-08-11）

**本日 2 件の Issue が「解消済みのまま open」だった。**

| Issue | 解消 | 起票との関係 |
| --- | --- | --- |
| #186 | `c27c84c`（#148） | **解消の 13 時間後に起票**。#51 の §4 の一覧を根拠にしていた |
| #63 | `e5cb5e6`（#127） | **consumer 側の解消・producer 側の別論点・apple-health 優先まで comment で更新されており、意図して open が継続していた**。close の判断が遅れただけで、放置ではない |

```
**文書に記録された一覧  ≠  現在の実装**
```

**Issue を根拠に作業を始める前に、前提が現在の main で成立するかを確かめる。**
