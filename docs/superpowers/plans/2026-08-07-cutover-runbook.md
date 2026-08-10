---
type: Runbook
title: cutover 手順書
description: scale_exporter との責任境界確定後の本番切替手順。当日実行用。
timestamp: 2026-08-07T00:00:00+09:00
updated: "2026-08-10T09:49:57+09:00"
status: proposed
basis:
  - Issue #114
  - PR #129
  - PR #136
  - PR #160（当方の run_exporter 呼び出し撤去）
  - docs/decisions/2026-08-05T193008_運用経路とpipeline_status配線についての検討書.md
---

# cutover 手順書

## 改訂 2026-08-10 — 前提を再実測し、既知の誤判定を除いた

**初版（2026-08-07）から、cutover の前提と実装が変わった。**
**初版の判定のうち 3 つは対象を測っておらず、過去の阻害要因 2 つは解消済みである。**

| # | 変更 | 節 |
| --- | --- | --- |
| 1 | **順序が確定した。** 先方の PR #83 → 当方の呼び出し撤去（#160、済）→ 連続 2 日観測 | §0 |
| 2 | **G-2 は排他条件である。** 当方が exporter を呼ぶ限り原理的に満たせない | §0 |
| 3 | **観測日程は本書で固定しない。** 実施日程はユーザー判断に従う | §0 |
| 4 | **§2 の停止判定を差し替えた。** 「ファイルの有無」では本日の失敗モードを捕まえられない | §2 |
| 5 | **§3 の `jq` が誤っていた。実文書に対して常に PASS を返す** | §3 |
| 6 | **§6 の `jq` が誤っていた。`null` を返す** | §6 |
| 7 | 前提を再実測した。**349 tests / 37 files、doctor 実装済み、acceptance 8 本を `npm test` に接続済み** | §前提条件 |
| **8** | **reviewer 指摘 B-1: §2 が「必ず停止する」条件だった。** 当方の launchd は走り続ける | **§2** |
| **9** | **reviewer 指摘 B-2: mtime 非更新から「launchd 未起動」を断定できない** | **§6** |
| **10** | **reviewer 指摘 B-4: P-2 は別の実行体を見ており P-1 の裏づけにならない。** P-1 をハッシュ照合へ変更 | **§2** |

## 0. 現在地と、確定した順序

### 0.1 順序（ユーザー決定）

```
1  先方が PR #83（flock + exit 6 + 監査の誠実化）をマージ・配備
2  当方が run_exporter の呼び出しを撤去        ← 済（PR #160、2026-08-09T13:46+09:00）
3  その翌日から連続 2 日観測
4  判定
```

### 0.2 観測日程（ユーザー判断）

**本書は観測日と判定日を固定しない。**
ユーザーが決定した日程を実行記録へ残し、**連続 2 日の各日で §2 の P-1・O-1・O-2 がすべて取れた場合だけ** gate に数える。
判定不能だった観測枠を、日程上の都合で充足へ読み替えない。

### 0.3 G-2 は排他条件である

```
G-2  直近 2 日について、morning と evening の両方に google-fit の JSONL が
     exporter 自身のスケジュール時刻で公開されている
```

**「exporter 自身のスケジュールだけで」は排他条件である。**
**当方が run_exporter を呼んでいる限り、この条件は原理的に満たせない。**

**flock を入れても帰属は作れない。** flock は同時実行を防ぐが、
「**誰がそのファイルを書いたか**」を記録しない。
**したがって #160 による呼び出しの撤去が、G-2 を観測可能にする唯一の前提だった。**

> **次に読む人へ**: ここを「flock を入れれば解決する」と読まないこと。
> **排他制御と帰属は別の問題である。**

### 0.4 2026-08-09T07:00 に実際に起きたこと

**初版の停止判定が想定していない失敗モードが、実際に発生した。**

```
先方のジョブ    exit 4 で失敗
公開されたファイル  4 件。ただし **当方が書いたもの**
先方の監査ツール  last_exit=4 を読みながら result=ok を返した
```

**「ファイルが在る」は「先方が公開した」を意味しない。**
**「先方のツールが ok と言う」は「成功した」を意味しない。**

この 2 点が §2 の判定を書き換えた理由である。

## 背景

### cutover の目的

- launchd が直接 `scale2sheet pipeline --period <morning|evening>` を起動（installed binary）
- 開発ツリーと本番を分離
- exporter との責任境界を確定
  - scale_exporter: LaunchAgent の登録・実行・削除は当方で行わない
  - scale2sheet: producer の起動に関与しない（**#160 で達成済み**）

### なぜ分離が要るか

2026-08-05、検証のための `npm run build:bun` が本番実行体を置き換えた。
**開発リポジトリの作業ツリーが本番挙動を直接変更する状態にある。**

## 前提条件

実行前に以下がすべて満たされていること。**2026-08-10 時点の状況を併記する。**

| 項目 | 確認方法 | 2026-08-10 の状況 |
| --- | --- | --- |
| ユニットテスト全 PASS | `npm test`（**bun が PATH に必要**） | **充足**（349 tests / 37 files） |
| Slice 3 install コマンド | `src/cli/installation.ts` に `.command("install")` | **充足**（`:482` / `uninstall` は `:493`） |
| binary provenance 検査 | **`npm test` に統合済み**（#128） | **充足** |
| **doctor 実装完了** | `src/cli/installation.ts` に `.command("doctor")` | **充足**（`:502`） |
| shadow 受け入れ試験 PASS | `npm test` | **充足**（Issue #168 は CLOSED。`test/acceptance/` の 8 本を接続済み） |
| 当方の run_exporter 撤去 | `scripts/run-pipeline.sh` に exporter の呼び出しが無い | **充足**（#160） |

> **初版は「`src/cli/index.ts` に `install` が存在する」と書いていたが、実際の登録は
> `src/cli/installation.ts` である**（`registerInstallationCommands`）。確認先を訂正した。

> **doctor と shadow acceptance は実装・接続済みである。**
> ただし、過去の PASS を当日の確認へ代用せず、cutover 直前に前提条件をすべて再確認する。

## 実行順序

### 1. 先方が LaunchAgent を登録し、PR #83 を配備

**実行者**: scale_exporter manager

**期待される状態**:

- `launchctl print gui/<uid>/jp.seijin.kappa.scale-exporter` が終了コード 0
- ProgramArguments が `--source google-fit` を含む
- **PR #83（flock + exit 6 + 監査の誠実化）が配備されている**

---

### 2. 帰属の観測（**初版から全面差し替え**）

**実行者**: 双方

> #### 訂正（2026-08-09、reviewer 指摘 B-1）
>
> **本節の第 2 版は「当該時刻に当方の launchd / run-pipeline.sh が走っていないこと」を必須にしていた。これは誤りである。**
>
> **当方の launchd は 07:00 / 11:30 / 21:00 / 23:30 に走り続ける**（manager 実測、両 label とも `state = active`）。
> 先方の 07:00 / 21:00 と重なるため、**この条件を課すと観測日に必ず停止する。**
>
> **#160 が撤去したのはスクリプト全体ではなく exporter の呼び出しである。**
> **当方のスクリプトが走ることは正常であり、停止条件ではない。**
>
> **§3 で私が見つけた「必ず PASS する検査」と、ちょうど逆向きの誤りだった。**
> 同じ手順書に**常に通る検査と常に止まる検査**が同居していたことになる。
> **どちらも「実際に当てて出力を見る」でしか分からない。**

#### 前提 — **観測日ごとに 1 回確認する（時刻ごとではない）**

**「当方が exporter を起動していない」は、時点の観測ではなく構造の性質である。**
**したがって観測窓ごとではなく、その日 1 回確かめれば足りる。**

> #### 訂正（2026-08-09、reviewer 指摘 B-4）
>
> **第 3 版は P-2（`acceptance:pipeline-shadow`）を P-1 の裏づけとして挙げていた。成立しない。**
>
> ```
> P-1 の対象   scripts/run-pipeline.sh
> P-2 が実行   compiled pipeline
> ```
>
> **別の実行体を見ている。P-2 で P-1 を裏づけることはできない。**
> **私は「動的な負のコントロールが既に存在する」と書いたが、それは別経路路のものだった。**
>
> **さらに、パターン照合で「呼び出しが無い」を証明しようとしたのも誤りだった。**
> 第 3 版は「呼び出しの形で探せ」と書いたが、**実際に試すと成立しない。**
>
> ```
> 非コメント行の scale_exporter の出現（実測）
>   scale_exporter_${today}_...     公開ファイル名の glob
>   scale_exporter側のス...          notify のメッセージ文字列の中
> ```
>
> **「直後が `_` なら command 位置ではない」という性質を立てたが、
> メッセージ文字列中の出現が反例になった。**
> シェルの command 位置を正規表現で判定しようとした自作の抽出器も、
> 変数代入や here-doc の中身を拾って**明らかに雑だった。**
>
> **否定をパターン照合で証明するのをやめる。** 下記の P-1 はハッシュで固定する形へ変えた。

**`run-pipeline.sh` を実行してはならない**（本番副作用）。**実行せずに確かめる。**

| # | 確認 | 方法 |
| --- | --- | --- |
| **P-1** | 配備された `run-pipeline.sh` が、**レビュー済みの内容とバイト一致する** | sha256 の照合 |
| **P-1 補助** | exporter の**絶対パス**が現れない | 単純 grep（**補助であって証明ではない**） |

#### P-1 — ハッシュで固定する

```sh
PROD=/Users/kappa/Dropbox/data/dev/scale2sheet/scripts/run-pipeline.sh
shasum -a 256 "$PROD"
# 期待値（PR #160 でレビュー済みの内容）
# 8c3c181281144fe516e8632107342e0466e025bde728ddfd3aa15ee68cf45523
```

**一致すれば、そのコミットに対して確認された性質——exporter の呼び出しが撤去されていること——が
そのまま成り立つ。** 再解析も実行も要らない。

**2026-08-09 実測: 本番と main の当該ファイルは一致している**（上記ハッシュ）。

> **なぜ照合がパターン照合より強いか。**
> パターンは「私が思いついた形」しか捕まえない。**ハッシュは内容そのものを固定する。**
> レビューが確認したのは**そのバイト列**であり、一致していれば確認の対象と同一物である。
> これは `check-binary-source-drift` が binary と source に対して採っているのと同じ形である。

#### P-1 補助 — 絶対パスの不在（**証明ではない**）

```sh
grep -c 'scale_exporter/\.build/release/scale_exporter' "$PROD"   # 期待: 0
```

**0 なら、絶対パスによる起動はできない。**
**PATH 経由の起動を否定するものではない。** そこは P-1 のハッシュ照合が担う。

#### この確認の限界（**claim の脇に書く**）

```
実行して確かめていない。run-pipeline.sh は本番副作用があるため実行禁止である
成り立つのは「配備物がレビュー済みの内容と同一である」まで
「そのレビューが正しかったか」は、この手順では検証していない
```

**§7 の方針（実行できないなら、実行して確かめていないことを併記する）に従う。**

> **P-2 は削除した。** `acceptance:pipeline-shadow` は compiled `pipeline` 経路の検査であり、
> **cutover 後の経路には有効だが、現在の `run-pipeline.sh` の裏づけにはならない。**
> 同 acceptance は隔離され、`npm test` に接続済みである（**Issue #168 は CLOSED**）。
> それでも検査対象は現在の wrapper ではないため、P-1 のハッシュ照合を代用しない。

#### 観測 — 時刻ごとに次の 2 つを取る

**1 つでも取れなければ「判定不能」とする。**

| # | 取るもの | 注意 |
| --- | --- | --- |
| **O-1** | **先方ジョブの終了コード** | **当方が独立に読む。先方の監査ツールの `result` を使わない**（§0.4） |
| **O-2** | 公開ファイルの mtime と、先方のスケジュール時刻の一致 | — |

#### 判定

| 観測 | 判定 |
| --- | --- |
| P-1 充足、かつ O-1 が 0、かつ O-2 が一致 | **その日は充足** |
| **O-1 が非ゼロなのに公開ファイルが在る** | **帰属不明。止める** ← 2026-08-09T07:00 に起きた形 |
| 公開ファイルが無い | 止める |
| **P-1 が満たされない**（ハッシュ不一致） | **その日は観測日に数えない。** 配備物がレビュー済みの内容と違う。まず何が変わったかを調べる |
| O-1 または O-2 が取れない | **判定不能。止める** |

**当方の launchd が当該時刻に走っていたことは、停止条件ではない。**
**当方が走ること自体は正常である。問うているのは「当方が exporter を起動したか」であり、
それは P-1（配備物がレビュー済みの内容と同一であること）が担保する。**

#### 停止判定の書き方についての原則

**「期待した成功の形」だけで判定を書かない。**

2026-08-09 の失敗が初版の網を抜けたのは、それが
**「成功でも、既知の失敗でもない」形だった**からである。
想定外を列挙で追いかけても、次の想定外が出る。

```
fail-closed を既定にする   成功の形に一致しない = 止める
他者のツールの判定を、当方の合格条件の根拠に使わない
```

---

### 3. 二重取得が起きていないかを件数で確認

**実行者**: scale2sheet

#### 初版の `jq` は誤っていた（実測で確認）

> **初版はこう書いていた:**
>
> ```
> jq '.state.readings | {windowedReadingCount: (.reading | length), uniqueMeasurementCount: (.measurementSet | length)}'
> ```
>
> **実際の文書に当てた結果:**
>
> ```
> { "windowedReadingCount": 0, "uniqueMeasurementCount": 0 }
> ```
>
> **エラーではない。0 が返る。**
> 初版の停止判定は「差が 2 以上 → 止める」なので、**0 − 0 = 0 で必ず PASS する。**
> **この判定は、どんなデータであっても「二重取得なし」と報告する。**
>
> `.state` というキーは文書に存在しない。実際の構造は
> `periods.<period>.lastTerminal.counts` である。

#### 正しい確認方法

```sh
STATUS=~/.config/scale2sheet/pipeline-status.json
ls -l "$STATUS"                      # 存在と mtime を記録
jq -c '.periods.morning.lastTerminal | {outcome, counts}' "$STATUS"
jq -c '.periods.evening.lastTerminal | {outcome, counts}' "$STATUS"
```

**実文書での出力例**（実測）:

```json
{"outcome":"completed:transferred","counts":{"matchedFileCount":1,"readLineCount":3,"windowedReadingCount":2,"uniqueMeasurementCount":1}}
```

#### 判定

- `windowedReadingCount` は**公開レコード数**、`uniqueMeasurementCount` は**物理測定数**
  （`src/pipeline/status.ts` の型定義コメント）。
  **同一測定が複数ソースから公開されれば、両者は正常時にも差が出る**（上の例は 2 と 1）
- 二重取得が起きれば、**公開レコード側だけが膨らむ**

> **未解決**: 初版の閾値「差が 2 以上 → 止める」の妥当性を、私は確認できていない。
> **正常時にどれだけ差が出るかは、AC-59 と #63 の実装が決める。**
> **実運用のデータを 2 日ぶん取ってから閾値を決めるほうが確実である。**
> 閾値を確定させるまでは、**数値を記録して先方と共有するにとどめ、自動判定にしない。**

#### 注記

**cutover 前は `run` 経路が status を書かない**（`src/cli/index.ts:112-150`）。
**したがって cutover 前にこのファイルが無いのは正常である。**

> **初版は「ファイルが無い → 入力 missing の兆候 → 止める」と書いていた。これは誤りである。**
> cutover 前の経路では原理的に書かれない。**「無い」を異常として扱うと、常に止まる。**

---

### 4. Manager 間で 1〜3 の完了を確認

**実行者**: manager 間（agmsg）

双方の manager が「準備完了」で合意する。
いずれかが「確認できない」を報告したら**止める**。

---

### 5. 当方が cutover を実行

**実行者**: scale2sheet

**実行内容**（コマンド行は記載しない。理由は §注記）:

1. **install 実行** — installed binary を配置し、plist を生成する
2. **plist 登録** — `morning` / `evening` とも `pipeline --period <period>` を起動する
3. **検査**
   - **判定 P**: plist の各 path が git work tree を参照していないこと
   - **判定 B**: production 実行体が作業ツリーの `dist/scale2sheet` と異なること
     （inode・mtime・size・sha256）

**判定 P・B は plist 登録の直後に実行する。**

**失敗時**: install エラー / plist 登録失敗 / 判定 B が FAIL のいずれも**止める**。
判定 B の FAIL は「cutover が失敗した」ではなく「**分離できていない状態が続いている**」である。

> **旧 plist（run-pipeline.sh 経由）は削除しない。** Slice 7 で扱う。

**cutover 実行後は、[README 差し替え案](./2026-08-09-cutover-readme-installation.md)を同じ release train で反映し、旧手動 plist の導入手順を残さない。**

---

### 6. cutover 後も入力が届いていることを実測

**実行者**: scale2sheet

#### 初版の `jq` は誤っていた（実測で確認）

> **初版**: `jq '.state.outcome'` → **実文書に対して `null` を返す。**
> `.state` は存在しない。

#### 正しい確認方法

```sh
STATUS=~/.config/scale2sheet/pipeline-status.json
ls -l "$STATUS"                                       # mtime が cutover 後であること
jq -r '.periods.morning.lastTerminal.outcome' "$STATUS"
jq -r '.periods.evening.lastTerminal.outcome' "$STATUS"
jq -c '.periods.morning.health' "$STATUS"             # {state, causes}
```

#### 判定

| 観測 | 判定 |
| --- | --- |
| mtime が cutover 実行時刻より後、かつ `outcome` が `completed:` で始まる | 充足 |
| **mtime が更新されない** | **`pipeline` が最初の status 書込に到達していない。止める**（下記の切り分けへ） |
| `outcome` が `failed:input-missing` | exporter が公開していない。**止める**（先方へ報告） |
| `outcome` が他の `failed:*` | pipeline 内部エラー。**止める** |
| `jq` が `null` を返す | **判定不能。止める**（文書の構造が想定と違う） |

> #### 訂正（2026-08-09、reviewer 指摘 B-2）
>
> **第 2 版は「mtime が更新されない → launchd が起動していない」と書いていた。断定できない。**
>
> **`pipeline` は status writer を作る前に、失敗しうる処理を 4 つ通る**（`src/cli/index.ts:59-72`、実測）。
>
> ```
> resolvePipelineSettings()          設定の解決
> loadConfig()                       設定の読込
> requireGoogleSheetsConfig(config)  ConfigError を投げうる
> acquireRunLease({kind:"pipeline"}) lease 取得。失敗・待機しうる
> ───────────────────────────────── ここまで status は書かれない
> new AtomicPipelineStatusWriter(...)
> runPipeline() → 最初の "running" 書込
> ```
>
> **したがって mtime が変わらないことから言えるのは、次の 1 点だけである。**
>
> ```
> pipeline が最初の status 書込に到達していない
> ```
>
> **言えないこと**: launchd が起動しなかった。

#### mtime が更新されないときの切り分け

**plist の `StandardErrorPath` が指すログを見る。**

| ログ | 言えること |
| --- | --- |
| ログが更新されている | **launchd は起動した。** 設定検証か lease で落ちた。ログの内容で特定する |
| ログも更新されていない | **launchd が起動していない可能性が高い。** `launchctl print` で label の状態を確認する |

**ログを見ずに「launchd が起動しなかった」と報告しないこと。**

**`health.state` も併せて記録すること。** `alert` なら `causes` に理由が入る。

---

## Rollback 手順

cutover 後に以下が発生した場合のみ実行する。

| 症状 | トリガー |
| --- | --- |
| status が更新されない | 次の scheduled 時刻 + 30 分を過ぎても mtime が変わらない |
| `outcome` が `failed:input-missing` で継続 | 連続 2 回以上 |
| `outcome` が他の `failed:*` | 連続 3 回以上 |

> **初版の「5 分以上改善しない」は削除した。**
> スケジュールは 07:00 / 11:30 / 21:00 / 23:30 であり、**5 分では次の実行が来ない。**
> 判定できない基準を置かない。

**実行内容**:

1. 新しい plist（`pipeline` 経路）をアンロードする
2. 旧 plist（`run-pipeline.sh` 経路）が存在することを確認し、再度ロードする
3. 次の scheduled 時刻を待ち、動作を確認する

**報告**: 先方の manager へ rollback の実行と、入力が再開したことを報告する。

---

## 検査チェックリスト

- [ ] 前提条件をすべて再確認した
- [ ] step 1：先方の LaunchAgent 登録と PR #83 配備の報告を受けた
- [ ] step 2：**観測 1 日目** — P-1（配備物の sha256 が `8c3c181…` と一致）を確認した
- [ ] step 2：**観測 1 日目** — O-1（先方の終了コードを独立に読む）と O-2（mtime）を取得した
- [ ] step 2：**観測 2 日目** — P-1 を確認した
- [ ] step 2：**観測 2 日目** — O-1 と O-2 を取得した
- [ ] step 3：件数を記録し、先方へ共有した（**自動判定はしない**）
- [ ] step 4：manager 間で準備完了を合意した
- [ ] step 5 判定 P：plist が git work tree を参照していない
- [ ] step 5 判定 B：production 実行体が作業ツリーと異なる
- [ ] step 6：`.periods.<period>.lastTerminal.outcome` が `completed:*`
- [ ] step 6：`health.state` を記録した
- [ ] step 6：先方へ完了報告を送信した

---

## 注記

### 実行コマンドを記載しない理由（初版から維持）

過去に調査用コマンドの実行が本番に影響を与えた。
この手順書は実行される前提で書かれるため、コマンド行の明示は事故の種になる。

**例外として、§3・§6 の `jq` は記載する。** これらは**読取専用**であり、
**かつ初版の記載が誤っていて実害が出る形だった**ため、正しいものを明示する必要がある。

### 判定の「止める」について

手順が止まった場合、その理由を記録し、先方の manager へ報告する。
判定を追加するか、再度の準備を求めるかは manager 間で決める。

### Slice 7 について

本手順では旧 plist を削除しない。Slice 7（連続 7 日観測後の削除）は別の runbook で扱う。

---

**初版作成**: 2026-08-07（ベース main `4a33602`）
**改訂**: 2026-08-09（ベース main `1ca0c8b`）
**改訂**: 2026-08-10（ベース main `586c5b8`）
**準拠**: Issue #114 / PR #129 / PR #136 / PR #160
