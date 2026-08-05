---
type: Decision
title: 運用経路と pipeline status 配線についての検討書
description: Issue #114 について、legacy script の暫定切替、Slice 6 の本番切替、run への暫定 status 配線を比較し、未実装の通知と binary provenance を含む帰結を整理する。
tags:
  - decision
  - scale2sheet
  - pipeline
  - observability
  - cutover
  - issue-114
timestamp: "2026-08-05T19:33:58+09:00"
updated: "2026-08-05T20:01:12+09:00"
status: proposed
---

# 運用経路と pipeline status 配線についての検討書

起草: `scale2sheet_architect_codex`（2026-08-05 JST）

検証: `scale2sheet_reviewer_claude` へ依頼予定

決定: ユーザー

| 項目 | 値 |
| --- | --- |
| 起点 | Issue #114「documented な運用経路では pipeline-status.json が作られない」 |
| 基準 HEAD | `1bb70dd0b6bde18aeda7b23adba07b7f2ba4c01b` |
| 対象 | legacy script の暫定切替、Slice 6 の本番切替、`run` への暫定配線、step 4 / 5 の順序 |
| 変更しないもの | pipeline status の schema と reducer、既存 outcome、既存の定義版 |
| 本書の効力 | 選択肢と帰結を提示する。案を採用せず、実装を許可しない |

## 1. 固定する前提

本書は、status schema を設計し直すための文書ではない。

`pipeline-status.json` の構造、更新規則、実装順序は、[pipeline status の永続 schema と更新規則の設計](2026-08-05T102852_pipeline_statusの永続schemaと更新規則の設計.md)を入力として使う。

同設計の frontmatter は `status: proposed` である。

AC 台帳の `CONFIRMED` は番号、件数、定義文書の対応が確定した状態であり、採用済み、実装済み、試験 `PASS` の意味ではない。

本番の最終形は、accepted な[インストール設計](../INSTALLATION_DESIGN.md)の H-2 で決まっている。

launchd はインストール済み binary の `pipeline --period <morning|evening>` を直接起動し、`run-pipeline.sh` を通常経路から外す。

accepted な[インストーラ実装分割](2026-07-29T173454_インストーラ実装分割と受け入れ確認の検討書.md)は、production 切替を Slice 6 の runbook で行い、旧 script と旧 plist の削除を連続7日観測後の Slice 7 で行う。

Issue #46 の accepted な決定は、macOS 通知を状態変化時だけ試み、同じ alert の継続中には繰り返さないことである。

現在の `runPipeline` はこの通知規則をまだ実装していない。

## 2. 現在の運用経路

### 2.1 launchd から status writer まで

2026-08-05 19:28 JST に `launchctl print`、README、script、CLI 実装を別々に確認した。

morning と evening の二つの LaunchAgent は、どちらも `/bin/bash` から checkout 内の `scripts/run-pipeline.sh` を起動していた。

各 period には本実行と拾い直し実行があり、合計は一日4実行である。

```text
morning  07:00 / 11:30
evening  21:00 / 23:30
```

`run-pipeline.sh` は exporter を最大3回試行した後、次を実行する。

```sh
"$scale2sheet_bin" run --period "$period"
```

`run` は `syncMeasurements` を呼ぶが、`AtomicPipelineStatusWriter` を構築しない。

`pipeline` だけが run lease と writer を構築し、`runPipeline` へ渡す。

したがって現在の documented な自動実行は、status reducer へ到達しない。

同日19:28 JST に production の既定 path `~/.config/scale2sheet/pipeline-status.json` が存在しないことを確認した。

`/Users/kappa` 以下を深さ6まで検索した範囲でも同名 file は見つからなかったが、読取不可の directory があるため HOME 全域の0件は根拠に使わない。

### 2.2 Issue #77 の解除条件

PR #73 の reviewer approve は、pipeline を shadow から出す前に Issue #77 を解消することを条件にした。

Issue #77 は `CLOSED / COMPLETED` であり、PR #93 が 2026-08-04 20:10 JST に merge されている。

現行 main の `readStableInputSnapshot` は、失敗観測を outcome、diagnostic、counts、異常候補の一つの値として保持する。

`failureStrength` は次の順序を実装している。

```text
input-invalid-or-partial  3
input-unstable            2
input-missing             1
```

弱い後続観測は強い先行観測を上書きしない。

同じ強度では後の観測を組ごと採用するため、outcome だけが更新されて古い diagnostic が残る経路もない。

PR #93 の reviewer は、最後の attempt 優先へ戻す変異と post-read seam を消す変異で試験が失敗することを確認した。

本起草でも `test/pipeline/input-snapshot.test.ts` を再実行し、11件の成功を確認した。

一方、[Issue #77 の検討書](2026-08-04T184538_入力診断の観測強度と上書き規則の検討書.md)の frontmatter は `status: proposed` のままである。

本書は proposed を accepted と読み替えない。

解除条件を満たした根拠は、Issue の close、merge 済み実装、reviewer の負のコントロール、現行 main の再試験である。

以上から、PR #73 が明記した Issue #77 の解除条件は満たされている。

### 2.3 Issue #77 以外の残存 gate

Issue #77 の解消だけでは、現在の実行体をそのまま本番へ切り替えられない。

残るものは次の四つである。

1. production の binary が `pipeline` を持たない。
2. `runPipeline` は入力失敗または転記失敗のたびに notifier を直接呼び、AC-112 の状態変化時だけという契約を満たさない。
3. Slice 2 の compiled acceptance は現行 main で schema v1 と不整合になり、実行すると `FAIL` する。
4. full cutover に必要な installer、production plist、rollback snapshot、一時 label の受け入れは Slice 6 まで未実装である。

1 は案A、案Bの共通 blocker である。

2 は、現行 `pipeline` を自動実行へ載せると accepted な通知契約から後退する blocker である。

3 と4は、accepted な full cutover の検証 gate である。

3 は gate が存在するだけで、現在は緑ではない。

2026-08-05 19:52 JST に現行 main から `npm run build:bun` を実行し、続けて `scripts/run-pipeline-shadow-acceptance.sh` を実行した結果は exit 1 だった。

```text
pipeline holder did not write an incomplete running status before reading input
```

同 script の99行から103行は、running status に top-level の `"outcome": "running"` があることを要求する。

PR #102 の schema v1 以後、writer は running observation を `periods.<period>.activeRun` として保存し、top-level の `outcome` を書かない。

unit test はこの新しい構造を検証して成功するが、compiled acceptance は旧構造の検査を残している。

したがって、現時点では schema v1 の正しい running status が作られても harness が拒否し、後続の terminal acceptance へ進まない。

harness が本来持つ terminal case も `completed:no-data` と `failed:input-missing` までであり、transfer には到達しない。

full cutover 前には、まず running 検査を schema v1 へ追従させて既存 harness 全体を緑にし、そのうえで transfer の fault injection を別 gate として通す必要がある。

Issue #79 の `--period` 省略時の終了コード衝突は、本経路の blocker ではない。

`run-pipeline.sh` 自身が `morning | evening` を検証し、CLI へ `--period` を常に渡すためである。

## 3. production binary と source の乖離

### 3.1 実測

production launchd が参照する checkout の source には、`pipeline` コマンドが存在する。

しかし、同 checkout の `dist/scale2sheet` は mtime が 2026-08-04 15:01 JST の binary であり、`--help` は `auth`、`run`、`serve` だけを列挙した。

`pipeline` は列挙されなかった。

binary の `--version` は `0.1.0` だけを返し、どの commit から作られたかを識別できない。

checkout の HEAD が進んでも、binary の再 build が必要かを launchd、README、CI、`doctor` のいずれも判定しない。

このため、source に実装があることを確認しても、production にその機能が存在するとは判定できない。

### 3.2 受け入れ観点

案Aと案Bのどちらを採る場合も、次の証拠が要る。

- reviewed head の full SHA
- その head から作った candidate binary の SHA-256
- candidate binary の `--help` が `pipeline` を列挙する結果
- production へ配置した binary の SHA-256 が candidate と一致する結果
- launchd の ProgramArguments が、その production binary を指す結果

再発防止として、binary が build 元 commit または immutable な artifact digest を返し、installer または `doctor` が期待値と実体を比較する案がある。

これは新しい受け入れ条件の候補であり、本書では AC 番号を割り当てない。

採用後に新しい AC が必要なら、定義文書より先に予約 PR を作る。

## 4. 論点1の選択肢

### 4.1 案A：legacy script の暫定切替

案Aは、既存の launchd と `run-pipeline.sh` を残し、script の最後の command を `run` から `pipeline` へ変える。

```text
launchd
  -> checkout 内の run-pipeline.sh
     -> exporter を同期起動
     -> checkout 内の dist/scale2sheet pipeline --period ...
```

status は、変更を deploy した後に最初に完了した scheduled run から更新される。

この案は、Slice 3から6の完了を待たずに #46 の状態記録を動かせる可能性がある。

ただし再 build した binary、#76 の通知契約、失敗時の rollback を同時に扱わなければならない。

script は exporter を同期起動するため、「producer は自身の schedule で公開し、consumer は公開済み JSONL だけを読む」という accepted な責任境界から外れた状態を残す。

checkout への絶対 path 依存も残る。

accepted な実装分割は production 切替を Slice 6 に置くため、案Aは同分割からの期限付き逸脱である。

#### 二重管理

案Aを採っても、status を書く command は `pipeline` の一つだけにする。

`run` は manual compatibility command として残るが、status を書かない。

README は、自動実行が `run-pipeline.sh` 経由で `pipeline` を呼ぶ一時 topology と、manual `run` が status を書かないことを同じ変更で説明する。

#### rollback

rollback は、保存した旧 binary と旧 script を戻し、次の scheduled run 前に `--help` と SHA-256 を確認する。

切替中に作られた `pipeline-status.json` は rollback 後も残るが、`run` は更新しない。

その file を現行状態と誤認させないため、README と rollback 記録には「rollback 後は stale になる」と書く必要がある。

#### 逸脱の終わらせ方

案Aの終了条件は、Slice 6 の production cutover が完了し、morning と evening の active ProgramArguments が installed binary の `pipeline` を直接指し、最初の scheduled run が status を更新したことである。

production runbook を実行する利用者が切替操作を行う。

programmer は `launchctl print`、binary SHA-256、status の run 証跡を cutover observation へ記録し、README から一時 topology を外す実装を担当する。

pm は Issue #114 と Slice 6 の受付状態を結び、上記証跡が揃うまで案Aを完了扱いにしない。

終了条件の各事実は、`launchctl print`、SHA-256、status timestamp で機械的に検査できる。

しかし、B の着地を検知して案Aの撤去作業を自動起票し、期限超過を失敗にする仕組みは現在ない。

条件の検査手段はあるが、解消を強制する自動 trigger はない。

案Aを採用する場合は、実装 Issue に B の予定日、A の終了日、終了時の担当、上記 command を書き、期限を変更するときはユーザー決定を残す必要がある。

これを行わないと legacy script が production のまま固定され、H-2、checkout 独立、producer 責任境界が未達のまま一時 topology が正本になる。

### 4.2 案B：Slice 6 runbook による本番切替

案Bは、accepted な Slice 6 runbook を実装し、launchd が installed binary の `pipeline` を直接起動する。

```text
launchd
  -> installed scale2sheet pipeline --period ...
     -> 公開済み JSONL を読む
```

status は、production cutover 後に最初に完了した scheduled run から更新される。

この案は H-2、producer 責任境界、checkout 独立、README の最終形と一致する。

先に必要なのは、Slice 3から6の直列実装、candidate binary の provenance、一時 label の受け入れ、transfer と通知の fault injection、rollback snapshot である。

production 切替は repository の merge では自動実行せず、利用者が runbook を明示的に実行する。

rollback は、新 label を二つとも `bootout` し、snapshot から legacy plist と binary を戻して二つの legacy label を `bootstrap` する。

案Aより操作は多いが、accepted な手順と証跡場所が既に定義されている。

### 4.3 案C：legacy run に status を書かせる

案Cは、切替まで `run` にも status を書かせる。

schema reducer と atomic writer を `run` 側へ複製してはならない。

採用するなら、`syncMeasurements` が terminal observation を返し、`run` と `pipeline` が同じ orchestration、run lease、reducer、writer を使う構造が必要になる。

しかし現在の `run` は stable snapshot の outcome、段階別 counts、入力異常候補を返さない。

既存 schema に値を作るには、legacy reader の結果を pipeline observation へ変える refactor が要る。

未計測の件数を0として合成すると、schema を共有したことにはならず、既存契約へ虚偽の観測を入れる。

案Cは案Aと同程度に早く status を動かせる可能性があるが、実装量が大きく、B の後には不要になる。

#### 撤去されなかった場合

B の後も案Cが残ると、scheduled `pipeline` と manual `run` が同じ status を更新する二つ目の入口になる。

manual `run` の成功が `lastDoneAt`、連続失敗、health を更新すると、launchd が止まっている事実を隠し得る。

status schema は「production schedule の観測」と「人が実行した compatibility command の観測」を区別する field を持たない。

`doctor` は、どちらが更新した最新値かを判定できない。

さらに、二つの CLI 契約、入力 reader、試験、README の説明を維持し続けることになる。

案Cの撤去を自動的に強制する仕組みも現在ない。

一時 bridge が残ると、B が着地しても status の意味が一意にならない。

### 4.4 効き始める日数の比較

日数は現時点で算出できない。

案Aの実装日、案Bの Slice 3から6の完了日、production runbook の実行日が計画されていないためである。

推測値を置くと、その値が案の採否を誤って支える。

実装計画では次の二つを JST の日付と scheduled run まで確定する。

```text
A_first = 案Aの deploy 後、status を書く最初の scheduled run
B_first = 案Bの cutover 後、status を書く最初の scheduled run
差日数  = calendar_date(B_first) - calendar_date(A_first)
```

案Aの価値はこの差日数に限られる。

差が0日なら、案Aは二重管理と逸脱だけを増やす。

差が正なら、その期間だけ #46 の status 記録を早く動かす。

| 比較軸 | 案A：script 暫定切替 | 案B：Slice 6 本番切替 | 案C：run bridge |
| --- | --- | --- | --- |
| #46 の status | `A_first` から動く | `B_first` から動く | bridge deploy 後の最初の run から動く |
| 日数 | B との差を計画時に算出 | 基準日 | A と同様に実装日が必要 |
| status writer | `pipeline` だけ | `pipeline` だけ | `run` と `pipeline` の二入口 |
| README | 一時 topology を追加し、Bで削除 | 最終 topology へ更新 | 二 command の差を説明し続ける |
| rollback | script と binary を戻す | runbook の複数操作 | code、binary、文書を戻す |
| Slice 6 整合 | 期限付き逸脱 | 一致 | Slice 6 外の暫定実装 |
| 残存リスク | 暫定 topology の固定化 | cutover まで status 不在 | bridge が残り status の意味が混ざる |

## 5. 論点2の選択肢

### 5.1 案2-A：run には書かず、切替を進める

`run` に status を追加せず、案Aまたは案Bの `pipeline` 切替を進める。

切替までは documented な経路で `pipeline-status.json` が更新されない。

その期間は #46 の連続失敗、最後の `done`、最後の実転記、health を status から検知できない。

一方、schema と writer の入口は `pipeline` に一つだけ残り、後で撤去する bridge を作らない。

案Aを選んでも案Bとの差が0日になるなら、本案と案Bの組合せが最小である。

### 5.2 案2-B：共有 orchestration から run にも書く

案Cの構造で、`run` が同じ reducer と writer を使う。

切替前から status を作れるが、legacy `run` の観測を既存 schema へ正しく写す refactor と撤去 gate が要る。

bridge の実装とレビューにより案Aまたは案Bが遅れる場合、暫定策が空白期間を短くしない可能性もある。

### 5.3 案2-C：shell が status を合成する

shell の終了コードと標準出力から JSON を組み立てる。

この案は counts、diagnostic、run lease、atomic reducer、定義版を再実装する。

未計測と0を区別できず、schema 設計をやり直さないという制約にも反する。

本案は候補から外す。

### 5.4 推奨

案2-Aを推奨する。

案2-Bの恒久的な二入口を作るより、`pipeline` の一入口を production へ載せる作業へ資源を使う方が、最終形への距離が短い。

ただし案Bの `B_first` が計画されない限り、案2-Aは無期限の検知空白を意味する。

案2-Aを採る場合も、`B_first` または期限付きの案Aを同時に決める必要がある。

## 6. 通知回数への帰結

### 6.1 現行 pipeline をそのまま載せた場合

Issue #46 の実測では、2026-07-18から27の10日間に evening pipeline の異常が継続した。

それとは別に、1か月で macOS 通知が少なくとも60回発生し、一度も行動につながらなかった。

現在の `runPipeline` は、各 input failure または transfer failure で notifier を1回呼ぶ。

同じ alert が続いても抑制しない。

一つの period には一日2回の scheduled run がある。

同じ period の障害が10日続くと、direct binary の案Bでは次の回数になる。

```text
2 runs/day x 10 days = 20 notification attempts
```

morning と evening の両方で同じ障害が続く場合は次の回数になる。

```text
4 runs/day x 10 days = 40 notification attempts
```

案Aで script の末尾だけを変えると、pipeline 内の通知に加え、nonzero を受けた shell も「シート転記が失敗しました」と通知する。

一つの period の10日障害では最大40回、両 period では最大80回になる。

```text
案A、1 period  2 runs/day x 2 notifications x 10 days = 40
案A、2 periods 4 runs/day x 2 notifications x 10 days = 80
```

exporter 自体が3attempt後に失敗した場合は pipeline を呼ばず、shell 通知だけなので一実行一回である。

### 6.2 state transition 実装後

AC-112 どおりなら、同じ alert の継続中には再通知しない。

10日間に一つの period が `normal -> alert` へ変わる場合、障害期間中の alert 通知は一回である。

morning と evening の両方が alert になる場合は、period ごとに一回の計二回である。

回復時には各 period の `alert -> normal` を一回ずつ試みる。

step 5 を先に入れない cutover は、status を動かす一方で、10日間の継続障害に対する通知要求を、accepted な一 period 一回から案Bでは20回、単純な案Aでは最大40回へ増やし得る。

morning と evening の両方で継続する場合は、accepted な計二回に対し、案Bでは40回、単純な案Aでは最大80回になる。

これは「状態変化時だけ」という accepted な決定に反する。

## 7. 論点3の選択肢

### 7.1 step 4 と step 5 は切替前に実装できる

ここでいう先行は production cutover より前に実装することであり、§16 の順序を入れ替えることではない。

step 4 は step 3 の #63 同一性と件数および `definitionsVersion: 2` を前提にする。

その上で、pipeline が持つ input と Sheets response を同じ run の observation として reducer へ渡し、V-3 と health evaluator を入れて `definitionsVersion: 3` へ上げる。

step 5 は、その health transition を claim して通知し、`doctor` から読む実装である。

両方とも isolated HOME、fake clock、fake notifier、mock Sheets response で production cutover 前に試験できる。

### 7.2 切替前に動かないもの

documented な launchd が `run` を呼ぶ間、次は production では動かない。

- V-3 observation の status 保存
- 実更新セル数による `completed:transferred` と `failed:transfer` の区別
- health transition の claim
- state transition ごとの macOS 通知
- `doctor` が読む最新の production pipeline status

code と fixture が増えても、利用者の自動実行はそれらへ到達しない。

`doctor` だけを先に公開すると、存在しない status または manual shadow run の status を読む。

それを production の監視結果として README に書くことはできない。

### 7.3 先行実装の帰結

先行実装は、cutover 前に V-3 と notification transition の負のコントロールを通し、cutover の一回で最終 semantics を載せられる利点がある。

一方、cutover 日が決まらなければ、実装済み code が production で動かない期間を延ばす。

step 5 を先に入れずに案Aまたは案Bを行うと、6節の通知増加が起きる。

したがって、既存の proposed 設計が示す step 3、step 4、step 5 の順序を維持し、step 5 と cutover を同じ release train に置く案を推奨する。

この推奨は、案Bの全 Slice を無期限に待つという意味ではない。

案Aを選ぶ場合も、step 5 を先に実装するか、現行 notifier を一時的に無効化して status だけを先に動かすかをユーザーが決める必要がある。

後者では #46 の能動通知が cutover 後も動かない帰結を受け入れる。

| 順序 | production status | V-3 | 通知 | doctor | 帰結 |
| --- | --- | --- | --- | --- | --- |
| step 4 / 5 後に cutover | cutover まで無し | cutover から動く | cutover から transition-only | cutover 後の実データを読む | accepted な最終 semantics を一度に載せる |
| cutover 後に step 4 / 5 | version 1 は先に動く | 後日まで無し | 現行の毎回通知 | version 1 の範囲だけ | status は早いが通知契約へ違反する期間がある |
| step 4 / 5 だけ先行 | 無し | shadow だけ | shadow だけ | production 判定不能 | code は積み上がるが #46 は効かない |

## 8. 起草者の推奨

最終 topology には案Bを推奨する。

案Bは accepted な H-2、Slice 6 runbook、producer 責任境界、README の自己完結性を同時に満たせる。

`run` に status を書く案Cは採らず、writer の入口を `pipeline` に一つだけ残す。

案Bの `B_first` が計画され、案Aとの差が0日なら案Aを作らない。

差が正で、その期間の #46 検知を優先する場合だけ、案Aを期限、終了担当、終了証跡つきの逸脱として選べる。

案Aを選ぶ場合も、production binary の provenance と step 5 の通知規則を cutover 前の gate にする。

## 9. ユーザーが決めること

| 論点 | 選択肢 | 起草者の推奨 |
| --- | --- | --- |
| 1. status を本番へ載せる経路 | 案Aの期限付き暫定切替 / 案Bの Slice 6 本番切替 / 案Cの run bridge | 案B。日数差が正なら案Aを条件付きで比較 |
| 2. 切替まで run に status を書くか | 書かない / shared orchestration から書く / shell で合成する | 書かない。shell 合成は候補外 |
| 3. step 4 / 5 の順序 | step 3 後に先行して cutover と同一 release train / cutover を先行 / step だけ先行 | step 3、step 4、step 5、cutover の順で間隔を空けない |
| 4. binary provenance | build 元 commit と artifact hash の照合を cutover gate にする / 手順記録だけにする | 機械照合を gate にする |

本書は案を採用しない。

ユーザー決定後に実装範囲と AC を確定し、新しい AC が必要なら予約 PR を先に作る。

## 10. 受け入れ観点

本書は新しい AC を定義せず、番号も予約しない。

採用後の実装では、Issue #114 の受け入れ条件案に次を加えて reservation の要否を判断する。

- documented な launchd 経路を実行した後、対象 period の status が同じ run の outcome、時刻、counts で更新される
- status writer の接続を外す変異で、documented path の自動試験が失敗する
- compiled shadow acceptance の running 検査を schema v1 の `periods.<period>.activeRun` へ追従させ、cutover 前に harness 全体が成功する
- `run` と `pipeline` が併存する期間に、どちらが status を書くかを README、設計、実装、試験で一致させる
- reviewed head、candidate binary、production binary の provenance を full SHA と SHA-256 で照合する
- 同じ alert の10日継続で、通知要求が一 period 一回を超えない
- rollback 後に status が更新されない場合、その stale 状態を現行状態として表示しない
- 案Aまたは案Cを採る場合、終了条件を外す変異、または B 後に一時経路を残す変異で移行 gate が失敗する
