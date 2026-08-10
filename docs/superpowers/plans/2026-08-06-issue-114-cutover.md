---
type: ImplementationPlan
title: Issue #114 cutover（案B）実装計画
description: 2026-08-05 のユーザー決定で確定した案B（Slice 6 runbook による本番切替）を、実測した前提の充足状況から作業順・cutover 手順・rollback 手順・完了判定へ落とす。
tags:
  - plan
  - scale2sheet
  - issue-114
  - cutover
timestamp: "2026-08-06T22:10:00+09:00"
updated: "2026-08-10T19:31:27+09:00"
status: accepted
accepted_by: "user decisions recorded in Issue #114 comments https://github.com/kappaseijin/scale2sheet/issues/114#issuecomment-5190970060 (2026-08-05) and https://github.com/kappaseijin/scale2sheet/issues/114#issuecomment-5205039221 (2026-08-06T22:10:00+09:00)"
---

# Issue #114 cutover（案B）実装計画

起草: `scale2sheet_architect_claude`（2026-08-06 JST）

検証: 未実施（検証席は codex 系）

決定: ユーザー

| 項目 | 値 |
| --- | --- |
| 起点 | Issue #114、および 2026-08-05 と 2026-08-06 の同 Issue コメント |
| 基準 main | `e5cb5e65f1f5e32dd1c5fce99bc68299e7cdacc7` |
| 実測日時 | 2026-08-06T21:45:00+09:00 〜 2026-08-06T22:00:00+09:00 |
| 実測環境 | 作業クローン `codex_monitor_agents/scale2sheet-architect-claude`、production は `~/Library/LaunchAgents/` と `~/.config/scale2sheet/` |
| 本書の効力 | 作業順と手順を提示する。実装を許可しない。§9 の未解決事項はユーザー決定を要する |

## 0.0 2026-08-09 の追記 — **読み直しが必要なのは本節と §4 W-1 だけ**

**本書の初版（2026-08-06）から、前提が 3 つ確定し、§9 の決定 3 件がすべて解決した。**
**本文の gate・rollback・後置き検査（§3・§5・§6・§7）は変更していない。**
**レビューでは本節と §4 W-1 を読めば足りる。**

### 差分表

| # | 何が変わったか | 反映先 |
| --- | --- | --- |
| 1 | **外部依存が特定された。** 先方の PR #83（flock + exit 6 + 監査の誠実化） | 本節・§4 W-1 |
| 2 | **順序がユーザー決定で確定した** | 本節・§4 W-1 |
| 3 | **G-2 は排他条件である。** 当方が exporter を呼ぶ限り原理的に満たせない | 本節 |
| 4 | **2026-08-09T07:00 に、想定外の失敗モードが実際に発生した** | 本節 |
| 5 | §9 の決定 1・2・3 がすべて解決した | 本節 |
| 6 | W-2（Slice 3）が完了。W-6 の一部（#134）が完了。当方の呼び出し撤去（#160）が完了 | 本節 |

### 0.0.1 確定した順序（ユーザー決定）

```
1  先方が PR #83（flock + exit 6 + 監査の誠実化）をマージ・配備
2  当方が run_exporter の呼び出しを撤去          ← 済（PR #160、2026-08-09T13:46+09:00）
3  その翌日から連続 2 日観測                      ← 2026-08-10 / 2026-08-11
4  2026-08-11 夜に判定
```

**2026-08-09 夕方の実行は前哨戦であり、gate に数えない。**
#160 の配備が同日中であり、**当方の呼び出しが止まった状態で丸 1 日が経過していない**ため。

### 0.0.2 G-2 は排他条件である（**初版が書いていなかった**）

初版の §5.5 は G-2 をこう書いている。

```
G-2  直近2日について、morning と evening の両方に google-fit の JSONL が
     exporter 自身のスケジュール時刻で公開されている
```

**この条文自体は正しい。書いていなかったのは、これが排他条件だという点である。**

**「exporter 自身のスケジュールだけで」は、当方が呼んでいないことを要求する。**
**当方が `run_exporter` を呼び続ける限り、G-2 は原理的に満たせない。**
初版は W-1 を「先方が登録し、2 日確認する」とだけ書いており、
**当方の側で何かを外す必要があることが読み取れなかった。**

**flock を入れても解決しない。** flock は同時実行を防ぐが、
**「誰がそのファイルを書いたか」を記録しない。排他制御と帰属は別の問題である。**

> **次に読む人へ**: ここを「先方が flock を入れたから G-2 は満たせる」と読まないこと。
> **G-2 を観測可能にしたのは #160（当方の呼び出し撤去）である。**

### 0.0.3 2026-08-09T07:00 の実測 — 想定外の失敗モード

```
先方のジョブ        exit 4 で失敗
公開されたファイル   4 件。ただし **当方が書いたもの**
先方の監査ツール     last_exit=4 を読みながら result=ok を返した
```

**「ファイルが在る」は「先方が公開した」を意味しない。**
**「先方のツールが ok と言う」は「成功した」を意味しない。**

**この形は、成功でも既知の失敗でもない。** したがって
「期待した成功の形」だけで書かれた停止判定は、これを通してしまう。

**runbook（PR #138）の §2 停止判定は、この実測を受けて全面差し替えた。**

```
日次前提  P-1  配備された run-pipeline.sh がレビュー済みの内容とバイト一致する
観測      O-1  先方ジョブの終了コード（当方が独立に読む）
          O-2  公開ファイルの mtime と先方のスケジュール時刻の一致
```

**O-1 または O-2 が取れなければ「判定不能」として止める。本書の W-1 もそれに従う。**

> **本節も一度誤っていた。** 当初は「帰属を 3 点（終了コード・mtime・**当方の非走行**）で取る」と書いていた。
> **3 点目は #138 §2 で撤回された**（当方の launchd は正常に走るため、課すと必ず判定不能になる）。
> **#138 を直したとき、それを要約している本節を直していなかった。**

### 0.0.4 §9 の決定はすべて解決した

| 決定 | 結果 |
| --- | --- |
| 決定1（producer の独立スケジュールを誰が立てるか） | **1-a を採用。** 先方へ依頼し、順序を §0.0.1 で確定 |
| 決定2（Slice 3〜5 を cutover 前に完了させるか） | **2-a を継続**（直列で完了させてから cutover）。Slice 3 は `d1f98bc`（PR #139）で完了（**不可逆**）。**Slice 4・5 の状態は Issue で確認する** |
| 決定3（PR #128 を前提に含めるか） | **3-a が実現。** #128 は 2026-08-09 にマージ済み（`9062698`）。**`npm test` へ統合された**ため、条件3 はこの実装を土台にする |

### 0.0.5 W の進捗 — **本書は進捗を持たない。着手条件だけを書く**

**本節には一度「2026-08-09 時点の状態」表があった。書いた 1 分後に古くなった**（§1.6 の注記）。
**進捗は Issue と git が正本であり、本書に写しを置かない。**

**代わりに、実行時に確認する着手条件を書く。**

| W | 着手・実行の条件（**実行時に確認する**） |
| --- | --- |
| W-2（Slice 3） | `d1f98bc`（PR #139）で着地済み。**取り消されない事実** |
| W-3（Slice 4 doctor） | **cutover の前提。** `doctor` サブコマンドが登録されていることを確認してから W-8 へ進む |
| W-6（step 5 通知 transition） | `#134` で状態遷移通知が入った（**不可逆**）。**残件の有無は Issue #164 で確認する** |
| **（初版に無い作業）** | 当方の `run_exporter` 撤去。`#160` でマージ済み（**不可逆**）。**G-2 の前提**（§0.0.2） |

**確認の形を「状態の記録」ではなく「実行時のチェック」にしている。**
記録は古くなるが、**チェックは実行のたびに現在を測る。**

> **初版 W-6 は「Issue #76 を解消する」と書いている。**
> **#76 の残件は `#164` と `#165` へ分割された**（2026-08-09、不可逆な事実）。
> **それぞれの現在の状態は、当該 Issue で確認すること。**
>
> **`#165` は cutover 前に解消することが推奨されていた。**
> cutover で `pipeline` 経路へ移ると、この欠陥は本番の欠陥になるためである。

### 0.0.6 本書の書き方の規則 — **編集する人はここを先に読む**

**本書は 2026-08-09 に 10 回差し戻された。10 回とも「文書が持っている状態が古くなった」形である。**
**そこで、状態を持たない構造へ変えた。編集するときは以下を守ること。**

#### 書いてよいもの / 書いてはいけないもの

| | 例 | 扱い |
| --- | --- | --- |
| **不可逆な事実** | 「Slice 3 は `d1f98bc` で着地した」「2026-08-05 にユーザーが案 B を決定した」 | **書いてよい。** 取り消されないので古くならない |
| **実行時のチェック** | 「plist が指すものを snapshot する」「実行直前に `launchctl print` で確認する」 | **書いてよい。** 実行のたびに現在を測る |
| **可変な状態** | 「#165 は未解決」「installed binary は無い」「Slice 4 は未マージ」 | **書かない。** 確認先だけを書く |

**判定法: その記述は将来 false になりうるか。** なりうるなら可変な状態である。

#### 可変な状態の正本

| 知りたいこと | 見る場所 |
| --- | --- |
| Issue / PR が解決済みか | GitHub の当該 Issue / PR |
| 実装が入っているか | `main` のソース、または `npm test` |
| launchd に何が登録されているか | `launchctl print`（実行時に取る） |

#### 状態ではなく規則で書く

```
×  「現在 installed binary は無い」      → cutover が成功した瞬間に偽になる
○  「plist が指すものを snapshot する」  → cutover の前後どちらでも正しい
```

**同じことを規則として書ける場面が多い。規則は古くならない。**

#### 数えない

```
×  「§5 の負のコントロール 7 件をすべて実行する」   → 表に足すと古くなる
○  「§5 の表の全行を実行する」
```

#### 古くなりやすい層（**編集後にここを見る**）

**本文だけ直しても足りない。以下の層が同じ内容を別の形で持っている。**

```
1  本文の記述
2  節の要約・総括          ← 論点ごとに数え上げないと出ない
3  数の記述                「4つある」「7 件」「N-3 から N-7」
4  「現在」列              列そのものが可変
5  方針採用前に書いた記述   方針を採ったら全文を洗い直す
6  表の列見出し            ラベルなので内容の検査をすり抜ける
7  案内文・参照            「現在の状態は §X にある」
8  検査スクリプト自身      在ると分かっている 1 件を掛けて、検出できるかを見る
```

**8 が最も効く。** 検査が 0 を返したとき、**「無い」のか「見えていない」のか**は、
**在るものを 1 件掛けてみないと分からない。**

## 0. 本書の位置づけと配置の判断

pm からの起点依頼は、出力先を `docs/superpowers/plans/` と `docs/decisions/` のどちらにするかを起草者の判断に委ねた。

**`docs/superpowers/plans/` の実装計画1本とする。**

本書には §9 のとおりユーザー決定を要する論点が残るが、それらは案B に対する新しい設計選択ではない。
決定済みの案B を実測へ突き合わせた結果として現れた、前提の不足である。
検討書をもう1本立てると、検証席（codex）の weekly 枠が 6% 残の状況でレビュー対象を2本に増やす。
実装計画の中に「着手前に決めること」を明示する方が、同じ情報を少ないレビューで渡せる。

**差分の読み方**: 本書は新規文書である。既存文書の変更は含まない。

## 1. 実測した前提の充足状況（**2026-08-06 時点のスナップショット**）

> # ⚠ 本節は 2026-08-06 の実測記録である。現在の状態ではない
>
> **本節のどの記述も、いまの cutover 判断の根拠に使ってはならない。**
>
> **可変な状態の正本は本書の外にある。**
>
> | 知りたいこと | 見る場所 |
> | --- | --- |
> | Issue / PR が解決済みか | **GitHub の当該 Issue / PR** |
> | 実装が入っているか | **`main` のソース、または `npm test`** |
> | launchd に何が登録されているか | **`launchctl print`**（実行時に取る） |
>
> **本書の §0 が持つのは 2 種類だけである。**
>
> ```
> 不可逆な事実   決定と、マージ済みの実装（§0.0.1・§0.0.4）
> 実行時チェック  着手・実行の前に測るもの（§0.0.5）
> ```
>
> **§0 も「現在の状態」を持たない。** §0.0.5 は進捗表ではなく、実行時に確認する条件である。
>
> **本節を残す理由**: 起草時点で何が測られ、何が測られていなかったかは、
> 後から「なぜこの作業順にしたか」を読み解くのに要る。**更新すると、その記録が消える。**
>
> **本節の記述が今も成り立つかは、本書では答えない。** §1.6 の注記を参照。

pm の起点依頼は前提を4件挙げ、「私の把握では4件すべて手当て済み。鵜呑みにしないこと」と付記した。
以下はすべて起草者が**2026-08-06 に**一次資料に当たって取った結果である。

### 1.1 pm が挙げた4件

| # | pm の把握 | 実測 | 判定 |
| --- | --- | --- | --- |
| 1 | shadow 受け入れ試験が通る（#120 / PR #121） | `npm run acceptance:pipeline-shadow` が `PASS: compiled pipeline shadow path rejects producer invocation, recovers a SIGKILL lease, and records statuses` を出力 | **充足**（2026-08-06 の実測）。**現在の状態は Issue #168 で確認する** |
| 2 | AC-120 の証拠（#103 / PR #122） | Issue #103 は `CLOSED`。PR #122 は `fdaa2ec` で merge 済み。`npm test` が 15 files / 96 tests PASS | **充足** |
| 3 | binary とソースの乖離検知（#123 / PR #124） | script 名は `npm run acceptance:binary-drift`。実行結果は正例 `PASS` と負のコントロール `FAIL: missing=['pipeline']` の両方を出力 | **部分充足**。§1.2 を参照 |
| 4 | 開発ツリーと本番の分離 | 未実装。pm の記載どおり | **未充足** |

pm は #3 の npm script 名を「自分で確認せよ」と書いた。
確認した結果は `acceptance:binary-drift` である。

### 1.2 #3 が部分充足である理由

`scripts/check-binary-source-drift.py` は、自身の docstring と出力の両方に `provenance not verified` と書いている。

同 script が照合するのは、source の `.command("...")` 集合と binary の `--help` が列挙する集合だけである。
binary がどの commit から作られたかは判定しない。

これは検討書 §3.2 が cutover の証拠として要求した5点のうち、3点目（candidate binary の `--help` が `pipeline` を列挙する）しか満たさない。
残る4点（reviewed head の full SHA、candidate binary の SHA-256、production 配置後の SHA-256 一致、launchd の ProgramArguments がその binary を指す）は未実装である。

2026-08-05 のユーザー決定は論点4について「機械照合を gate にする」を採った。
その gate は現時点で存在しない。

さらに、同 script には未 merge の修正 PR #128（`fix/check-binary-source-drift-N-1`）が open のまま残っている。

### 1.3 production 実行体の現況（検討書 §3.1 は既に古い）

検討書 §3.1 は「production の `dist/scale2sheet` は `pipeline` を列挙しない」と記録している。
**この記述は 2026-08-06 時点では成立しない。**

```text
実測 2026-08-06T21:50:00+09:00
  /Users/kappa/Dropbox/data/dev/scale2sheet/dist/scale2sheet
  mtime  2026-08-06 08:51
  sha256 04716f0114310529e8cdfcdf99bb661170d133bb6ffb343d307e080b4c0ffed8
  --help が列挙する command  auth / pipeline / run / serve
```

production の binary は `pipeline` を持つ。
作業ツリーで再 build されたためである。
これは検討書 §2.3 が挙げた残存 gate の1番（production の binary が `pipeline` を持たない）が、**cutover の作業としてではなく開発作業の副作用として解消された**ことを意味する。

Issue #114 の 2026-08-06 コメントが問題として記録した事象そのものが、gate を消したことになる。
**gate が消えたことを cutover の前進として数えてはならない。**

### 1.4 pm の4件に含まれていない前提

以下は起草者が実測で見つけたもので、pm の依頼文には無い。
**いずれも案B の実行可否を直接左右する。**

#### A. Slice 3・Slice 4・Slice 5 が未実装である

案B は「installed binary を launchd から直接起動する」案である。
**install する手段が main に無い。**

```text
実測  src/cli/index.ts が登録する command
  auth / pipeline / run / serve

実測  src/installation/ の内容
  plist.ts
  settings-read.ts
```

`INSTALLATION_DESIGN.md` §モジュール境界が要求する `model.ts`、`paths.ts`、`manifest.ts`、`archive.ts`、`planner.ts`、`executor.ts`、`doctor.ts`、`sheets-read.ts`、`process.ts` と、`src/cli/installation.ts`、`scripts/install.sh` は存在しない。

`docs/ACCEPTANCE_TEST_REPORT.md` の Installer AC 表では 44 行が `PENDING` である。
`docs/PLAN.md` の Ph.15 は「実装中・Slice 1」のままである。

実装分割（accepted）は Slice 6 を「Slice 3 から 5 の直列完了後」に置く。
決定 U-2 は直列 PR を採っている。

**したがって cutover の前提は「4件の gate」ではなく、未着手の3 Slice を含む。**

#### B. step 4 が未実装である

```text
実測  src/pipeline/status.ts:99
  export const CURRENT_DEFINITIONS_VERSION = 2 satisfies DefinitionsVersion;
```

schema 設計 §16 の step 3（#63 の同一性と件数、`definitionsVersion` 2）は `e5cb5e6`（PR #127）で着地している。
step 4（V-3、Sheets response の実更新数、health evaluator、`definitionsVersion` 3）は未実装である。

#### C. step 5 が未実装である

```text
実測  src/ 配下に doctor の実装は無い（grep 0 件）
```

2026-08-05 のユーザー決定は「step 5 と cutover を同じ release train に置く。step 5 を入れずに cutover しない」である。
**step 5 は cutover の前提そのものであり、pm の4件には入っていない。**

step 5 の前提には Issue #76（失敗時に通知が呼ばれることを検証していない）が含まれる。
#76 は `OPEN` である。

#### D. producer が独立したスケジュールで動いていない

**本計画で最も重い発見である。**

案B の topology は、`pipeline` が公開済み JSONL だけを読み、producer は自身のスケジュールで公開する。
これは 2026-08-03 のユーザー決定（責任境界の設計監査、案A）である。

```text
実測 2026-08-06T21:52:00+09:00

launchctl print gui/502/jp.seijin.kappa.scale-exporter          exit=113（未登録）
launchctl print gui/502/jp.seijin.kappa.scale-pipeline.morning  exit=0（登録済み）
launchctl print gui/502/jp.seijin.kappa.scale-pipeline.evening  exit=0（登録済み）
```

`~/Library/LaunchAgents/jp.seijin.kappa.scale-exporter.plist` は存在するが、**bootstrap されていない**。
実装設計 §再登録は「`launchctl print` の終了コードだけで登録有無を読む」を契約としており、その契約で未登録である。

producer が現在何によって起動されているかは、公開ファイルの時刻から判別できる。

```text
実測  ~/Dropbox/data/private/健康/scale_exporter/ の 2026-08-06 分（google-fit）
  07:05  001 / 002 / 003
  11:30  004 / 005
  21:00  006 / 007 / 008 / 009 / 010 / 011

exporter plist の StartCalendarInterval  07:00 と 21:00 のみ
pipeline plist の StartCalendarInterval  morning 07:00 / 11:30、evening 21:00 / 23:30
```

**11:30 の公開は exporter 自身のスケジュールでは説明できない。**
`scripts/run-pipeline.sh` が exporter を同期起動しているためである（同 script 30行）。

つまり **google-fit の JSONL を公開している唯一の経路は `run-pipeline.sh` である。**
案B は `run-pipeline.sh` を launchd の経路から外す。
**cutover した瞬間に producer の起動元が消える。**

その状態で `pipeline` を動かすと、当日の google-fit ファイルが公開されないまま読取に入る。
実装分割 §連続7日観測は、入力不在を `failed:input-missing` として観測失敗日に数え、連続日数を0へ戻す。
**producer を先に独立させない cutover は、Slice 7 の観測ゲートを恒久的に不成立にする。**

apple-health は iPhone のショートカットが公開するため、この経路には依存しない（`run-pipeline.sh` 49行から52行の記述と 2026-08-03 のユーザー決定）。
2026-08-06 分の apple-health ファイルは 21:43 に公開されている。

##### 実測が示していないこと

- exporter の LaunchAgent がいつ、何によって未登録になったかは特定していない。
  `~/Library/Logs/scale-exporter/scale-exporter.err.log` の最終更新は 2026-08-04 07:02、内容は `healthkit authorization denied` 4行である。
  これは起動していた時期があることを示すが、未登録になった経緯は示さない。
- `~/.local/bin/scale_exporter`（exporter plist が指す実行体）と `~/Dropbox/data/dev/scale_exporter/.build/release/scale_exporter`（`run-pipeline.sh` が指す実行体）は size が同一で mtime が異なる。同一 build かは照合していない。

### 1.5 production の pipeline-status.json

```text
実測  ~/.config/scale2sheet/ の内容
  google-fit-credentials.json
  google-fit-token.json
  settings.json
```

`pipeline-status.json` は存在しない。
AC-121 が要求する「production の `pipeline-status.json` が0件であることを実装着手時に再確認する」は、本実測で満たしている。

### 1.6 前提の総括（**2026-08-06 時点**）

| 前提 | 2026-08-06 の状態 | 状態の確認先 | 由来 |
| --- | --- | --- | --- |
| shadow 受け入れ試験 | 充足 | Issue #168 | pm の4件 |
| AC-120 の証拠 | 充足 | — | pm の4件 |
| binary とソースの乖離検知 | 部分充足 | `npm test` の binary-drift | pm の4件 |
| 開発ツリーと本番の分離 | 未充足 | **cutover の目的そのもの。**§8 の完了判定 | pm の4件 |
| Slice 3 | 未着手 | `d1f98bc`（PR #139）で着地。**取り消されない事実** | 本書 §1.4 A |
| Slice 4 | 未着手 | Issue #114 の Slice 4 関連 PR | 本書 §1.4 A |
| Slice 5 | 未着手 | 同上 | 本書 §1.4 A |
| step 4（V-3、定義版3） | 未実装 | `src/pipeline/status.ts` の `CURRENT_DEFINITIONS_VERSION` | 本書 §1.4 B |
| step 5（通知 transition、doctor） | 未実装 | Issue #164 / #165 | 本書 §1.4 C |
| producer の独立スケジュール | 未成立 | PR #138 runbook §2 の観測記録 | 本書 §1.4 D |

> ## 「現在」列を置かない理由（2026-08-09 決定）
>
> **本表には一度「2026-08-09 現在」列があった。書いた 1 分後に古くなった。**
>
> ```
> 17:46  PR #170 マージ（#165 の欠陥を解消）
> 18:23  「現在」列に「#165 が残件」と書く   ← 既に古い
> 18:24  reviewer が指摘
> ```
>
> **「現在」と書いた瞬間から古くなり始める。**
> §1 のようにバナーで囲うこともできない——**現在の主張だから書いているのであって、
> 日付を付けたら「現在」ではなくなる。**
>
> **したがって本書は可変な状態を持たない。確認先だけを書く。**
>
> **線引きの正本は §0.0.6 にある。** 本節はその適用例である。
>
> ### 読者への代償
>
> **確認先を開かないと現在の状態は分からない。** これは意図した代償である。
>
> **本書は計画であって、状態の一覧ではない。**
> 状態の正本は Issue と git であり、**写しを持つと必ず両者がずれる。**
> 本日この文書は 7 箇所で古くなり、**そのうち 1 箇所は書いた 1 分後だった。**

## 2. A_first と B_first の扱い

pm は「案A を採らないと決まったので `A_first` は不要かもしれない。起草者が判断せよ」と書いた。

### 2.1 A_first は算出しない

**算出しない。**
ただしこれは起草者の判断ではなく、既に記録された決定の確認である。

Issue #114 の 2026-08-05 ユーザー決定コメントは次を書いている。

> 差日数を算出する前に案A を落とすので、A_first の確定は不要になった。

起草者はこれに同意する。
検討書 §4.4 の `A_first` と `差日数` は、案A と案B を比較するための量である。
案A を作らない以上、比較対象が存在しない。

### 2.2 B_first は算出条件を固定する。値は置かない

**B_first は依然として必要である。**

根拠は2つある。

1. 検討書 §5.4 は「案2-A を採る場合も、`B_first` または期限付きの案A を同時に決める必要がある」と書いている。
   ユーザー決定は案2-A を採り、案A を落とした。**したがって `B_first` が唯一の期限になる。**
2. 実装分割 §連続7日観測は「観測初日は、production 切替後に最初の morning schedule が動く JST の暦日とする」と定める。
   Slice 7 の起点は `B_first` である。

値は置かない。
所要日数はレビュー待ち行列に支配され、その回復日を起草者は知らないためである。

**算出条件**を次に固定する。

```text
cutover_done = §4 の W-0 から W-8 がすべて main へ merge され、
               §5 の runbook を利用者が実行し終えた JST 時刻

B_first      = cutover_done の直後に到来する最初の morning schedule（07:00 JST）が
               status を書いた JST の暦日

  cutover_done の時刻が当日 07:00 JST より前なら  B_first = calendar_date(cutover_done)
  それ以外なら                                    B_first = calendar_date(cutover_done) + 1 日

Slice 7 の観測初日 = B_first
Slice 7 の最短完了日 = B_first + 6 日（連続7日が一度も0へ戻らない場合）
```

`cutover_done` を暦日へ落とすには、W-0 から W-8 の各所要日数が要る。
それはレビュー枠の回復日に依存するため、**pm が枠の見通しを入れて計算する。**
起草者は算出条件までを固定し、値を推定しない。

## 3. 開発ツリーと本番の分離を機械的に確認する経路

2026-08-06 のユーザー追加条件は次である。

> cutover 後、この作業ツリーで `npm run build:bun` を実行しても production の挙動が変わらないこと

pm は「機械的に確認する経路まで設計に含めよ。『気をつける』では止まらない」と書いた。
以下がその設計である。

### 3.1 判定を2つに分ける

1つの判定では足りない。
**「path が結合していないこと」と「実際に build しても変わらないこと」は別の主張である。**

| 判定 | 何を主張するか | 測る対象 |
| --- | --- | --- |
| **判定 P** | production の launchd 経路が、どの git work tree の中も参照しない | plist の各 path |
| **判定 B** | 作業ツリーで `npm run build:bun` を実行しても、production 実行体の実体が変わらない | production 実行体の実体 |

判定 P だけでは、path が独立していても別経路で同じ inode を共有する構成を見逃す。
判定 B だけでは、実行体は独立していてもログ path や `PATH` が checkout を指す構成を見逃す。

### 3.2 判定 P：production 経路が git work tree を参照しない

morning と evening の各 label について次を確認する。

1. plist の `ProgramArguments[0]` が、install manifest に記録された `<prefix>/bin/scale2sheet` と一致する。
2. `ProgramArguments` に `/bin/bash`、`run-pipeline.sh`、`dist/` のいずれも含まれない。
3. `ProgramArguments[0]`、`StandardOutPath`、`StandardErrorPath`、`EnvironmentVariables.PATH` の各要素について、
   その directory を起点とした `git rev-parse --show-toplevel` が**非0で終了する**。

```sh
git -C "$(dirname "$p")" rev-parse --show-toplevel >/dev/null 2>&1 && exit 1
```

3 は「checkout の path を決め打ちで列挙して照合する」方式を採らない。
決め打ちは、別の場所に置かれた checkout を見落とす。
**「git work tree の中にあるか」を対象そのものへ問う。**

### 3.3 判定 B：build しても production 実行体が変わらない

```text
1. production の plist から ProgramArguments[0] を読み、その実行体の
   (inode, mtime, size, sha256) を T0 として記録する
2. 作業ツリーで npm run build:bun を実行する
3. 同じ実行体の (inode, mtime, size, sha256) を T1 として記録する
4. T1 == T0 を判定する
```

**sha256 だけで判定しない。**
`bun build` は source が同じなら同じ内容を出しうる。
sha256 だけを見ると、**上書きされたのに一致して通る**経路が残る。
上書きそのものを捉えるのは inode と mtime である。
2026-08-05 に起きた事故は「内容が変わった」ではなく「production の file が置き換わった」であり、判定式はそちらを測らなければならない。

### 3.4 負のコントロール

判定 P と判定 B は、正しく cutover した後では自明に通る。
**通ることは、判定式に解像度があることを保証しない。**

同じ判定式が、cutover 前の topology に対して **FAIL する**ことを確認する。

```text
fixture  一時ディレクトリに checkout の dist/scale2sheet を指す plist を作る
期待     判定 P が FAIL（ProgramArguments[0] が git work tree の中にある）
期待     判定 B が FAIL（build 後に mtime が変わる）
```

これは既存の `scripts/run-binary-source-drift-acceptance.sh` が採っている形（正例 PASS と負例 FAIL を同じ run で出す）と同じである。

### 3.5 実行経路

| 用途 | 実行方法 | 対象 |
| --- | --- | --- |
| CI・回帰 | `npm run acceptance:production-independence` | 一時 HOME と fixture plist。正例と負例の両方 |
| cutover 完了判定 | 同 script に `--production` を付けて実行 | 実 label と実 production 実行体 |

fixture 側は CI で回せる。
`--production` 側は production を触るため runbook の手順に置き、CI では回さない。

**判定 B の `--production` 実行は、実際に作業ツリーで `npm run build:bun` を走らせる。**
cutover が正しく済んでいれば production は変わらない。
済んでいなければ production を書き換える。
**したがってこの検査は cutover 完了後にだけ実行し、完了前には実行しない。**
完了前に実行すると、検査そのものが 2026-08-05 の事故を再現する。

## 4. 作業順

各 W は1つの PR に対応する。
実装分割の決定 U-2（直列 PR）に従い、前の W が main へ merge されるまで次を開始しない。

### W-0: AC 予約

- [ ] `docs/ACCEPTANCE_TEST_REPORT.md` の予約台帳へ、Issue #114 の新規 AC を予約する。**予定件数 5**。
- [ ] `npm run preflight:ac-ledger` が通ることを確認してから PR を出す。

予定件数の内訳は §6 に条件文で示す。
**本書は AC 番号を割り当てない。**
台帳の規約は「決定文書、目標定義、検討書に AC を書いてから番号を調整する順序は使わない」であり、番号は予約 PR が確定させる。
本書は条件の中身と件数だけを固定する。

台帳の実測では、使用済みの最大番号は AC-123 である。
AC-93 から AC-95 は `UNUSED` だが3枠しかないため、予定件数5 の本件では使用できない。

### W-1: producer の独立スケジュール確立【外部・ユーザー決定を要する】

> **2026-08-09 改訂。** 初版はこの 2 項目だけだった。
> **当方の側で外す作業（#160）が必要であることが書かれておらず、順序も外部依存も無かった。**
> §0.0.1〜0.0.3 を参照。

- [x] **先方が PR #83（flock + exit 6 + 監査の誠実化）をマージ・配備する**【**外部依存**】
- [x] **当方が `run_exporter` の呼び出しを撤去する**（PR #160、2026-08-09T13:46+09:00）
      **これを行わない限り G-2 は原理的に満たせない**（§0.0.2）
- [ ] `jp.seijin.kappa.scale-exporter` を bootstrap し、`launchctl print` が終了コード0 を返すことを確認する。
- [ ] **観測日ごとに 1 回**、前提 **P-1** を確認する。
      **配備された `scripts/run-pipeline.sh` が、レビュー済みの内容とバイト一致する**
      （sha256 = `8c3c181281144fe516e8632107342e0466e025bde728ddfd3aa15ee68cf45523`、PR #160 でレビュー済み）
- [ ] **連続 2 日**（2026-08-10・2026-08-11）、時刻ごとに次の 2 点を取る。
      **1 つでも取れなければ「判定不能」として止める。**

      **O-1** 先方ジョブの**終了コード**。**当方が独立に読む**（先方の監査ツールの `result` を使わない。§0.0.3）
      **O-2** 公開ファイルの mtime と、先方のスケジュール時刻の一致

- [ ] **2026-08-11 夜に判定する。**

> **2026-08-09 訂正（reviewer 指摘）**
>
> **本項は当初、観測の 3 点目に「当該時刻に当方の launchd / run-pipeline.sh が走っていないこと」を置いていた。**
> **これは #138 §2 で撤回された条件である。**
>
> **当方の launchd は 07:00 / 11:30 / 21:00 / 23:30 に正常に走り、先方枠と重なる。**
> **この条件を課すと観測日に必ず判定不能になる。**
>
> 「当方が exporter を起動していない」は**時点の観測ではなく配備物の性質**であり、
> **P-1（レビュー済みバイト列との一致）が担保する。**
>
> **本書は #138 を正本と宣言している。その正本で撤回した条件を、引用したまま残していた。**
> **正本を直したとき、参照している側は直らない。**

**停止条件（初版に無かったもの）:**

```
O-1 が非ゼロなのに公開ファイルが在る  →  帰属不明。止める
                                        ← 2026-08-09T07:00 に実際に起きた形
O-1 または O-2 が取れない             →  判定不能。止める
P-1 が満たされない（ハッシュ不一致）   →  その日は観測日に数えない
```

**当方の launchd が当該時刻に走っていたことは、停止条件ではない。**

**2026-08-09 夕方の実行は前哨戦であり、この 2 日に数えない**（§0.0.1）。

**手順の正本は PR #138 の runbook §2 である。** 本項はその要約であり、
**食い違ったら runbook が正しい。**

**この作業は本 repository の所有物ではない。**
責任境界の設計監査（2026-08-03 ユーザー決定・案A）は、`scale_exporter` が自身の設定・認証・バイナリの install と uninstall を所有すると定め、Slice 3 について「先方 LaunchAgent は作成、検査、登録解除しない」と書いている。

**scale2sheet 側から先方の LaunchAgent を登録してはならない。**
実施主体はユーザー、または scale_exporter チームである。
§9 の決定1を参照。

### W-2: Slice 3（install と既定 uninstall）

- [ ] 実装分割 §Slice 3 の成果物を実装する。
- [ ] AC-01、AC-02、AC-04、AC-05、AC-08 から AC-11、AC-14 から AC-19 を `PASS` にする。
- [ ] `npm run typecheck`、`npm test`、`npm run build:bun` を通す。

### W-3: Slice 4（doctor）

- [ ] 実装分割 §Slice 4 の成果物を実装する。
- [ ] AC-25、AC-33 を `PASS` にする。AC-41 と AC-48 の Slice 4 範囲を進める。

### W-4: Slice 5（purge と wipe）

- [ ] 実装分割 §Slice 5 の成果物を実装する。
- [ ] AC-12、AC-13、AC-21、AC-23 を `PASS` にする。

### W-5: step 4（V-3 と定義版3）

- [ ] schema 設計 §16 の step 4 を実装し、`CURRENT_DEFINITIONS_VERSION` を 3 へ上げる。
- [ ] AC-122 を `PASS` にする。
- [ ] 定義を変える変更と `definitionsVersion` の更新を同じ PR に含める（schema 設計 §16 の規約）。

### W-6: step 5（通知 transition と doctor 接続）

- [ ] schema 設計 §16 の step 5 を実装する。
- [ ] Issue #76（失敗時の notify 呼び出しを assert していない）を解消する。
- [ ] 同じ alert の継続中に再通知しないことを自動検証する。**負のコントロールとして、抑制を外す変異で FAIL することを確認する。**

**W-6 と W-8 を同じ release train に置く**（2026-08-05 ユーザー決定）。
W-6 が main に無い状態で W-8 を実行しない。

### W-7: Slice 6（配布・runbook・分離検査）

- [ ] 実装分割 §Slice 6 の成果物を実装する。
- [ ] §3 の `scripts/run-production-independence-acceptance.sh` と `npm run acceptance:production-independence` を追加する。fixture の正例 PASS と負例 FAIL を同じ run で出す。
- [ ] 検討書 §3.2 の provenance 5点を機械照合する経路を追加する（§6 の条件3）。
- [ ] `docs/observations/<cutover-JST>_installer-cutover.md` の template を作る。
- [ ] README を新経路の正本へ更新する。AC-22 を `PASS` にする。
- [ ] §5 の runbook を repository へ置く。
- [ ] 旧 `scripts/run-pipeline.sh` と旧静的 plist は rollback asset として残す（決定 U-3）。

### W-8: cutover 実行

- [ ] §5 の runbook を利用者が実行する。
- [ ] repository の merge では自動実行しない（実装分割 §production 切替）。

### W-9: 連続7日観測と Slice 7

- [ ] 実装分割 §連続7日観測に従って記録する。起点は §2.2 の `B_first`。
- [ ] 7日連続を満たし reviewer が観測記録を確認した場合だけ Slice 7 の PR を作る。

## 5. cutover 手順と Slice 6 runbook との差分（**2026-08-06 時点の差分。2 件は解消済み**）

> **本節は「初版の runbook に足りないもの」を挙げたものである。**
> **その足りないものは 2026-08-09 の runbook 改訂（PR #138）で 2 件が入った。**
> **「runbook に無い」という記述を、いまの runbook の説明として読まないこと。**
> **5.2 と 5.3 は `#138` で解消済み（不可逆）。5.1 と 5.4 は cutover が状態を変える。**
>
> | 差分 | 初版（2026-08-06）で挙げた不足 | その後 |
> | --- | --- | --- |
> | 5.1 rollback snapshot の installed binary | 存在しない | **cutover が作る。** 実行時の読み替えを 5.1 に置いた |
> | 5.2 producer の gate が無い | 無い | **`#138` で runbook §2 へ入った**（不可逆） |
> | 5.3 分離検査が無い | 無い | **`#138` で runbook §5 へ入った**（不可逆） |
> | 5.4 legacy label が登録済み | 登録済み | **cutover の `bootout` が解除する。** 実行直前の確認を 5.4 に置いた |
>
> **数（「4つある」）で書いていたため、2 件が解消しても本文が変わらなかった。**
> **数の記述は、項目が変わっても黙って残る。**

実装分割 §production 切替は9手順を定めている。
**以下は初版の runbook との差分である。**

### 5.1 差分1：rollback snapshot の「installed binary」

runbook は snapshot へ「installed binary の絶対パスと SHA-256」を保存させる。

**cutover 前は installed binary が存在しない**（存在させるのが cutover そのものである）。
2026-08-06 の実測では、production が起動するのは作業ツリー内の `dist/scale2sheet` だった（§1.3）。

runbook の文言をそのまま実行すると、保存対象が見つからず手が止まるか、
作業ツリーの binary を「installed binary」として記録して topology を誤って残す。

**読み替え（実行時に判断する）**:

```
snapshot の対象は「その時点で launchd が起動する実行体」とする
  cutover 前   plist の ProgramArguments が指すもの（作業ツリー内でありうる）
  cutover 後   installed binary
```

**「いま installed binary が無い」と記録しない。** cutover が成功した瞬間に偽になる。
**「plist が指すものを取る」と書けば、前後どちらでも正しい。**

W-7 で runbook の文言をこの読み替えへ書き換える。

### 5.2 差分2：producer の gate が runbook に無い（**解消済み。PR #138 §2**）

runbook の9手順は producer に触れない。
§1.4 D のとおり、cutover は producer の起動元を消す。

**追加する前置き gate**（W-1 の完了確認）:

```text
G-1  launchctl print gui/<uid>/jp.seijin.kappa.scale-exporter が終了コード0
G-2  直近2日について、morning と evening の両方に google-fit の JSONL が
     exporter 自身のスケジュール時刻で公開されている
```

G-1 と G-2 のいずれかが満たされない場合、**cutover を実行しない。**

> **2026-08-09: この gate は runbook §2 へ入った。**
> **ただし G-2 の判定方法は runbook 側が正本である**（P-1 のハッシュ照合 + O-1 / O-2）。
> **本節の G-2 は条件の宣言であり、判定手順ではない。** 手順は runbook を見ること。

### 5.3 差分3：分離検査が runbook に無い（**解消済み。PR #138 §5**）

runbook は cutover 後の検査として `launchctl print` の終了コードと実行体の `--version` までを定める。
§3 の判定 P と判定 B は含まれない。

**追加する後置き検査**: §5.5 の C-5 と C-6。

### 5.4 差分4：legacy label の登録は、実行前に確認する

runbook 手順4「legacy morning と evening label を `bootout` する」は、対象が登録済みであることを前提にする。

**この前提は cutover 実行の直前に確認する。記録しない。**

```
launchctl print gui/<uid>/jp.seijin.kappa.scale-pipeline.morning   終了コード 0 なら登録済み
同 .evening                                                        同上
```

**登録済みなら runbook どおり実行できる。** 未登録なら `bootout` は空振りするので、
**空振りを失敗として扱わない**こと。

> **2026-08-06 と 2026-08-09 の実測では、両 label とも登録済みだった。**
> **これは記録であって、実行時の保証ではない。** cutover は将来行われる。

### 5.5 実行する手順

前置き gate（§5.2）を満たしたうえで、次を順に実行する。
1 から 9 は実装分割 §production 切替の原文に対応する。

```text
G-1  producer の LaunchAgent が登録済み（終了コード0）
G-2  producer 自身のスケジュールでの公開を連続2日確認済み
G-3  W-0 から W-7 がすべて main へ merge 済み
G-4  rollback snapshot を ~/.config/scale2sheet/rollback/<timestamp>/ へ mode 0700 で保存
     （§5.1 の読み替えを適用。切替前 revision、run-pipeline.sh、legacy plist 2本、
       現在 launchd が起動する実行体の絶対パスと SHA-256、launchctl print の結果、
       rollback command。認証情報・settings の内容・Spreadsheet ID は複製しない）

1  legacy process と新 run lease を検査する
2  実行中なら変更せず、完走後の再実行を案内する
3  rollback snapshot の hash を再確認する
4  legacy morning と evening label を bootout する
5  installed binary と新 plist を配置する
6  新 morning と evening label を bootstrap する
7  launchctl print の終了コードで両 label の登録を確認する
8  plist が指す binary の存在、実行権限、--version を installer process 内で確認する
9  いずれかが失敗した場合は §7 の rollback を実行する

C-5  判定 P を --production で実行する（§3.2）
C-6  判定 B を --production で実行する（§3.3）
C-7  provenance の5点照合を実行する（§6 の条件3）
```

legacy と新 label を同時に登録しない。
`kickstart` を使わない。
以上は実装分割の原文どおりである。

**C-6 は cutover 完了後にだけ実行する**（§3.5 の理由）。

## 6. 新しい合格条件（番号は W-0 の予約 PR が割り当てる）

**予定件数 5。** Issue は #114。

1. production の morning と evening の plist について、`ProgramArguments[0]` が install manifest の `<prefix>/bin/scale2sheet` と一致し、`ProgramArguments`、`StandardOutPath`、`StandardErrorPath`、`EnvironmentVariables.PATH` のいずれの path も git work tree の内側を指さないこと。
   判定は path の決め打ち列挙ではなく `git rev-parse --show-toplevel` の終了コードで行うこと。
   checkout 結合 topology の fixture で同判定が `FAIL` することを負のコントロールに含めること。

2. 作業ツリーで `npm run build:bun` を実行した前後で、production の launchd が起動する実行体の `(inode, mtime, size, sha256)` が全て一致すること。
   sha256 の一致だけを合格条件にせず、inode と mtime の一致を含めること。
   checkout 結合 topology の fixture で同判定が `FAIL` することを負のコントロールに含めること。

3. reviewed head の full SHA、その head から作った candidate binary の SHA-256、production へ配置した binary の SHA-256、launchd の `ProgramArguments` が指す path の4者を機械照合し、不一致で `FAIL` すること。
   command 集合の一致（既存の `acceptance:binary-drift`）を provenance の証拠として数えないこと。

4. cutover 後の documented な launchd 経路を実行した後、対象 period の `pipeline-status.json` が、同じ run の outcome、開始時刻、完了時刻、Slice 2 の3件数で更新されること。
   反対 period の field が変わらないことを含めること。

5. 4 の自動試験について、status writer の接続を外す変異で `FAIL` すること。

条件4と条件5は Issue #114 の本文が「受け入れ条件（案）」として挙げたものである。
条件1と条件2は 2026-08-06 のユーザー追加条件に対応する。
条件3は 2026-08-05 のユーザー決定（論点4「機械照合を gate にする」）に対応する。

検討書 §10 が挙げた残り3項目は新規予約に含めない。理由は次のとおりである。

| 検討書 §10 の項目 | 扱い |
| --- | --- |
| compiled shadow acceptance の running 検査を schema v1 へ追従 | #120 / PR #121 で完了済み（§1.1 の実測） |
| `run` と `pipeline` のどちらが status を書くかを README・設計・実装・試験で一致させる | 既存 AC-22（Slice 6）の範囲 |
| 同じ alert の10日継続で通知要求が一 period 一回を超えない | 既存 AC-112（#46、`CONFIRMED`）の範囲 |
| rollback 後に status が更新されない場合、stale を現行状態として表示しない | §7 の rollback 手順で文書として扱う。doctor の表示契約は Slice 4 / AC-36 の範囲 |

## 7. rollback 手順

rollback 条件は実装分割 §連続7日観測の3つを使う。

```text
R-1  実行体が起動した後の pipeline failure
R-2  fault injection で通知要求が失われる
R-3  実行証跡がある転記結果に後退がある
```

手順は次のとおりである。

```text
1  新 production label を両方 bootout する
2  rollback snapshot の hash を検証する
3  snapshot の legacy plist 2本と scripts/run-pipeline.sh を戻す
4  legacy label 2本を bootstrap する
5  launchctl print の終了コードで両 label の登録を確認する
```

status、ログ、settings、認証情報は削除しない。

### 7.1 rollback 後に成立しなくなること

**rollback は §3 の分離を巻き戻す。**

legacy topology へ戻った時点で、production は再び作業ツリーの `dist/scale2sheet` を起動する。
すなわち **2026-08-05 の事故（作業ツリーでの `npm run build:bun` が production を置き換える）が再び起こりうる状態になる。**

rollback 記録には次を書く。

- 判定 P と判定 B が rollback 後は成立しないこと
- 原因修正までの間、作業ツリーで `npm run build:bun` を実行しないこと
- `pipeline-status.json` は legacy `run` が更新しないため stale になること。その値を現行状態として読まないこと

検討書 §4.1 の rollback 節が案A について書いた「rollback 後は stale になる」は、案B の rollback にも同じく当てはまる。

## 8. 完了判定

**「cutover した」と言える条件**を次に固定する。
すべて機械的に検査できる形にした。

| # | 条件 | 検査 |
| --- | --- | --- |
| D-1 | W-0 から W-7 が main へ merge 済み | `git log` |
| D-2 | producer が独立スケジュールで登録済み | `launchctl print gui/<uid>/jp.seijin.kappa.scale-exporter` が終了コード0 |
| D-3 | 新 morning と evening label が登録済み | `launchctl print` が両 label で終了コード0 |
| D-4 | legacy label が未登録 | legacy label 2本の `launchctl print` が非0 |
| D-5 | plist が installed binary の `pipeline` を直接起動する | `ProgramArguments` が `<prefix>/bin/scale2sheet pipeline --period <period>` |
| D-6 | production 経路が git work tree を参照しない | §3.2 の判定 P が `--production` で PASS |
| D-7 | 作業ツリーの build が production を変えない | §3.3 の判定 B が `--production` で PASS |
| D-8 | provenance の4者が一致する | §6 の条件3 が PASS |
| D-9 | launchd 起動の run が status を書いた | `~/.config/scale2sheet/pipeline-status.json` に、cutover 後の scheduled run と同じ `runId` の terminal observation が存在する |
| D-10 | 観測記録が作られている | `docs/observations/<cutover-JST>_installer-cutover.md` に D-9 の run が記録されている |

**D-9 は cutover 完了判定に含める。**
Issue #114 の起点が「documented な運用経路では `pipeline-status.json` が作られない」である以上、**作られたことを確認するまで cutover は完了していない。**

**Slice 7 は完了判定に含めない。**
連続7日観測は cutover 後の別 gate であり、実装分割の決定 U-3 が別 PR と定めている。

## 9. 着手前に決めること（**3 件とも解決済み。2026-08-09**）

> **決定 1・2・3 はすべて出ている。結果は §0.0.4 にある。**
> **本節は選択肢と帰結の記録であり、未決の論点ではない。**

以下は起草者が決めない。
選択肢と帰結を並べる。

### 決定1：producer の独立スケジュールを誰がいつ立てるか

§1.4 D のとおり、cutover は producer の起動元を消す。
producer は他プロジェクト（`scale_exporter`）の所有物である。

| 案 | 内容 | 帰結 |
| --- | --- | --- |
| **1-a** | scale_exporter 側へ依頼し、LaunchAgent の登録と連続2日の公開確認を済ませてから cutover する | 案B の責任境界（2026-08-03 ユーザー決定）と一致する。cutover の日程が先方の対応日に依存する |
| 1-b | cutover 後も scale2sheet 側が producer を起動する | 2026-08-03 のユーザー決定を覆す。`SCALE_EXPORTER_COMMAND` を Slice 2・plist・doctor から除外した決定も巻き戻る。作業ツリー依存も残る |
| 1-c | producer 未登録のまま cutover する | 当日の google-fit ファイルが公開されず `failed:input-missing` になる。実装分割 §連続7日観測はこれを観測失敗日として連続日数を0へ戻すため、**Slice 7 が恒久的に不成立になる**。apple-health のみ公開される日は Issue #126 の論点にも触れる |

**起草者の推奨は 1-a。**
1-b は決定済みの責任境界を覆すため、cutover の実装計画の中で扱う範囲を超える。
1-c は Slice 7 を不成立にするため、cutover の目的（#46 の検知を実運用へ載せる）を達成しない。

チーム境界の規約により、scale_exporter への依頼は manager 同士のメッセージで行う。

### 決定2：Slice 3 から 5 を cutover の前に完了させるか

§1.4 A のとおり、**2026-08-06 時点では** Slice 3 から 5 は未着手だった（Slice 3 はその後 `d1f98bc` で着地。**不可逆な事実**）。

| 案 | 内容 | 帰結 |
| --- | --- | --- |
| **2-a** | 実装分割どおり Slice 3 → 4 → 5 → 6 を直列で完了させてから cutover する | accepted な実装分割と決定 U-2 に一致する。W-2 から W-4 の3 PR が cutover の前に入る |
| 2-b | cutover に必要な最小の install 経路だけを先に作り、doctor と purge を後回しにする | `B_first` が早まる可能性がある。ただし Slice 4 の doctor は step 5 の接続先であり、2026-08-05 の決定「step 5 と cutover を同じ release train」と衝突する。AC の owner Slice も組み替えが必要になる |

**起草者の推奨は 2-a。**
2-b は step 5 が doctor へ接続する構造と衝突する。
2026-08-05 の決定を維持したまま 2-b を採る経路は見つからなかった。

### 決定3：PR #128 を cutover の前提に含めるか

§1.2 のとおり、`check-binary-source-drift.py` には未 merge の修正 PR #128 が open である。

| 案 | 内容 |
| --- | --- |
| **3-a** | W-7 の前に #128 を merge する。§6 の条件3 は #128 後の script を土台にする |
| 3-b | #128 とは独立に条件3 の provenance 照合を新規に作る |

**起草者の推奨は 3-a。**
同じ対象を測る script を2本に分けると、どちらが正本か判定できなくなる。

## 10. 本書が扱っていないこと

- step 5（通知 transition と doctor）の実装内容。**pm が範囲外と指定した。** 実装の状況は Issue #164 と当該 PR で確認する
- status schema の設計のやり直し
- exporter の LaunchAgent が未登録になった経緯（§1.4 D の「実測が示していないこと」）
- `~/.local/bin/scale_exporter` と dev tree の exporter が同一 build かの照合
- Issue #126（apple-health が1本も無い日の扱い）との相互作用。決定1 の 1-c を採る場合にだけ効く
- Slice 7 の実施計画。W-9 は起点と参照先だけを示す

## 11. 参照した一次資料

| 資料 | 参照した箇所 | frontmatter の status |
| --- | --- | --- |
| Issue #114 本文と3コメント | 受け入れ条件、2026-08-05 と 2026-08-06 のユーザー決定 | — |
| [運用経路と pipeline status 配線についての検討書](../../decisions/2026-08-05T193008_運用経路とpipeline_status配線についての検討書.md) | §2.3、§3.1、§3.2、§4.2、§4.4、§5.4、§9、§10 | **`proposed`** |
| [pipeline status の永続 schema と更新規則の設計](../../decisions/2026-08-05T102852_pipeline_statusの永続schemaと更新規則の設計.md) | §14、§16 | **`proposed`** |
| [インストーラ実装分割と受け入れ確認の検討書](../../decisions/2026-07-29T173454_インストーラ実装分割と受け入れ確認の検討書.md) | Slice 3〜7、AC 割当表、rollback snapshot、production 切替、連続7日観測、決定 U-1〜U-3 | `accepted` |
| [scale_exporter との責任境界の設計監査](../../decisions/2026-08-02T120800_scale_exporterとの責任境界の設計監査.md) | 案A の採用、producer の自スケジュール、Slice 3 の除外事項 | `accepted` |
| [INSTALLATION_DESIGN.md](../../INSTALLATION_DESIGN.md) | H-2、モジュール境界、plist の ProgramArguments、再登録、移行 | `accepted` |
| [ACCEPTANCE_TEST_REPORT.md](../../ACCEPTANCE_TEST_REPORT.md) | AC 予約台帳、Installer AC 表 | — |
| [PLAN.md](../../PLAN.md) | Ph.15 の進捗 | — |

**引用元2本の frontmatter は `proposed` である。**
本書はこれを `accepted` と読み替えない。
Issue #116（proposed のまま実装が進んでいる設計文書が2本ある）が同じ2本を対象にしている。

## 12. 実測コマンド一覧

再実行できるよう、§1 の実測に使ったコマンドを記録する。

```sh
# 1.1
npm ci && npm run build:bun && npm run typecheck && npm test
npm run acceptance:pipeline-shadow
npm run acceptance:binary-drift

# 1.3
plutil -p ~/Library/LaunchAgents/jp.seijin.kappa.scale-pipeline.morning.plist
plutil -p ~/Library/LaunchAgents/jp.seijin.kappa.scale-pipeline.evening.plist
~/Dropbox/data/dev/scale2sheet/dist/scale2sheet --help
shasum -a 256 ~/Dropbox/data/dev/scale2sheet/dist/scale2sheet

# 1.4 A / B / C
grep -nE '\.command\(' src/cli/index.ts
find src/installation -type f
grep -rn 'CURRENT_DEFINITIONS_VERSION' src/pipeline/status.ts
grep -rn 'doctor' src --include='*.ts'

# 1.4 D
plutil -p ~/Library/LaunchAgents/jp.seijin.kappa.scale-exporter.plist
for l in jp.seijin.kappa.scale-exporter \
         jp.seijin.kappa.scale-pipeline.morning \
         jp.seijin.kappa.scale-pipeline.evening; do
  launchctl print "gui/$(id -u)/$l" >/dev/null 2>&1; echo "$l -> exit=$?"
done
ls -la ~/Dropbox/data/private/健康/scale_exporter/ | grep 2026-08-06

# 1.5
ls -la ~/.config/scale2sheet/
```
