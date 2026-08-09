---
type: ImplementationPlan
title: Ph.15 Slice 4（doctor）実装計画
description: accepted な実装分割の §Slice 4 は doctor だけを追加する。read-only 診断、Sheets 読取 port、失敗段階の報告を実装順・AC 対応・負のコントロールへ落とす。
tags:
  - plan
  - scale2sheet
  - installer
  - slice-4
  - doctor
timestamp: "2026-08-07T01:32:26+09:00"
updated: "2026-08-09T21:15:16+09:00"
status: accepted
accepted_by: PR #137 (merged 2026-08-09)
---

# Ph.15 Slice 4（doctor）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

起草: `scale2sheet_architect_claude`（2026-08-07 JST）

検証: 未実施（検証席は codex。Issue #133 により 2026-08-08 まで停止）

| 項目 | 値 |
| --- | --- |
| 基準 main | 初版 `4a33602` / 改訂 `1ca0c8b` |
| 実測日時 | 2026-08-07T01:30:00+09:00 前後 |
| 正本 | [インストーラ実装分割と受け入れ確認の検討書](../../decisions/2026-07-29T173454_インストーラ実装分割と受け入れ確認の検討書.md)（`accepted`）の §Slice 4 |
| 設計 | [INSTALLATION_DESIGN.md](../../INSTALLATION_DESIGN.md)（`accepted`）の §doctor |
| 目標定義 | [インストーラとアンインストーラの目標定義](../../decisions/2026-07-29T084808_インストーラとアンインストーラの目標定義.md) |
| 前提 Slice | **Slice 3。マージ済**（`d1f98bc` / PR #139、2026-08-08） |
| 本書の効力 | 実装順と粒度を提示する。設計を変更しない |

**Goal:** 利用者が明示的に起動したときだけ動く read-only 診断 `doctor` を追加する。

**Architecture:** `src/installation/doctor.ts` と `src/installation/sheets-read.ts` を足し、`src/cli/installation.ts` から接続する。Slice 3 の `paths.ts`、`manifest.ts`、`process.ts` を**読取用途でだけ**再利用し、`planner.ts` と `executor.ts` には依存しない。

**Tech Stack:** TypeScript、Vitest、mock server または network adapter。

## 0. 依頼文の表題を訂正する

pm の依頼文は表題を **「Slice 4（uninstall の残り）」** としていた。
依頼文自身が「Slice 4 が何を追加するのかを accepted な実装分割から特定してください。私は把握していません」と付記していたので、特定した。

**Slice 4 は `doctor` だけである。uninstall の残りは Slice 5 である。**

```text
実装分割 §Slice 4：doctor
  この PR は、read-only の診断機能だけを追加する。

実装分割 §Slice 5：purge と wipe
  この PR は、秘密情報を扱う不可逆境界を独立にレビューする。
  archive.ts / uninstall --purge / uninstall --purge --wipe / --archive <dir> / --yes
```

「uninstall の残り」（`--purge`、`--wipe`、退避）は **Slice 5 の内容である。**
本書は Slice 4 = doctor の計画であり、Slice 5 は扱わない。

依頼文が併記した「doctor は Slice 4 の範囲。**これが Slice 4 の中心かもしれません**」は正しい。
中心どころか**全部である。**

## 0.5 2026-08-09 の追記 — **循環依存が 1 件見つかった**

**初版（2026-08-07）から、決定と実測が 4 件入った。**
**そのうち 1 件は、doctor と cutover のあいだの循環依存だった。**
**判断は 3 件とも出ている（§8）。本節は経緯の記録である。**

### 差分表

| # | 内容 | 反映先 |
| --- | --- | --- |
| 1 | **決定 4: doctor が plist を読んで経路を判定する。** → **範囲内。切り出し不要** | §0.5.1・§8 |
| 2 | **循環依存**: doctor は cutover の前提だが、設計どおりなら cutover 前に PASS しない → **決定 1-a で解決** | **§0.5.2・§8** |
| 3 | programmer2 の指摘 A（`checkSourceAuthFile`）→ **受け入れ条件へ追加** | §0.5.3・Task 2 |
| 4 | programmer2 の指摘 B（行日付）→ **条件付きとして記録**。実態より強く書かない | §0.5.4・Task 3 |
| 5 | 配備検査を足すなら **mtime ではなく `check-binary-source-drift`** → **決定 2-b で本 Slice の対象外** | §0.5.5 |
| 6 | #165（period 非対称）との順序 → **決定: #165 を先に直す** | §0.5.6 |

### 0.5.1 決定 4 は **Slice 4 の範囲内である**

**範囲外ではない。設計書 §診断契約 が既に plist の内容を読むことを要求している。**

```
診断契約より
  二つの plist の構文と固定チェックアウトパスの不在
  二つの launchd label の登録状態
```

**「固定チェックアウトパスの不在」を検査するには、plist の中身を開く必要がある。**
決定 4 が足すのは**読むこと**ではなく、**読んだ結果をどう報告するか**である。
**新規の Slice へ切り出す必要は無い。**

### 0.5.2 doctor は cutover 前に PASS できない（**決定 1-a で解決**）

**manager の実測（2026-08-09、`launchctl print`）:**

```
gui/502/jp.seijin.kappa.scale-pipeline.morning
  arguments  /Users/kappa/Dropbox/data/dev/scale2sheet/scripts/run-pipeline.sh
  Hour 7 / Minute 0、Hour 11 / Minute 30      state = active
gui/502/jp.seijin.kappa.scale-pipeline.evening
  Hour 21 / Minute 0、Hour 23 / Minute 30     state = active
```

**現在の本番 plist は、固定チェックアウトパスを含んでいる。**
設計が「不在」を要求している、まさにそのものである。

**したがって設計どおりに実装すると、doctor は cutover 前の本番に対して必ず異常を報告する。**

**一方、cutover runbook（PR #138）は doctor を cutover の前提条件に置いている。**

```
doctor が PASS しないと cutover できない
cutover しないと plist は置き換わらない
plist が置き換わらないと doctor は PASS しない
```

**これは循環である。** 初版が「§8 決めること: 無い」と書けたのは、
**doctor を単体で見て、cutover との関係を見ていなかった**からである。

**決定 1-a により解決した**（plist を読んで経路を判定し、報告を変える）。
**設計書 §診断契約 へ「実行経路の判定」を追記済み**（同 PR の別コミット）。詳細は §8。

### 0.5.3 指摘 A — **本人の指摘より重い。受け入れ条件へ入れる**

```
doctor の checkSourceAuthFile が見ているキー   google-fit-token-path
起動を実際に止めるキー（src/config/env.ts:199）  client ID と client secret の 2 つだけ
                                                redirect URI は zod の既定値を持ち、欠落しえない
```

`requireGoogleFitConfig` は `config.googleFit`（client id / secret）が無いと `ConfigError` を投げる。
**`google-fit-token-path` は見ていない。**

**つまり doctor は「起動を止めない項目を warn し、起動を止める項目を検査していない」。**
「3 つとも欠落するケースを検出できない」より強い言い方が要る。**検査対象そのものが違う。**

→ **Task 2 の受け入れ条件と負のコントロールへ追加した。**

### 0.5.4 指摘 B — **条件付きである。実態より強く書かない**

```
production の行日付   buildLatestMeasurementSet:215  weightReading?.measuredAt ?? capturedAt
doctor               findTodayRow(dateColumnIndex, deps.now())
```

「measuredAt で上書きする」は**そのとおり**である。
ただし `isReadingInPeriodWindow`（`measurements.ts:157`）が `measuredAt.hasSame(targetDate, "day")` を要求するため、
**通常経路では weight は referenceTime と同じ暦日に限られ、両者は一致する。**

**食い違うのは次の場合だけである。**

```
run --date <過去日> の遡り実行
doctor の実行と run の実行が日付をまたぐ
```

**「PASS と報告したのに書き込まない」は起こりうるが、常時ではない。**
**台帳や AC へ「常に起こるギャップ」として載せないこと。**

→ **Task 3 に条件付きの注記として入れた。AC には昇格させない。**

### 0.5.5 配備検査を足すなら mtime を使わない

**mtime だけを見る配備チェックは偽陽性を出す。実測がある。**

```
本番 dist/scale2sheet の mtime   Aug 9 13:22（9062698 から build）
main                             1ca0c8b
git diff --name-only 9062698 1ca0c8b  →  README.md / scripts/run-pipeline.sh
src/ の変更                       0 件
→ 13:22 のバイナリで挙動は変わらない。「古い」が「乖離」ではない
```

**正しい問いは「最後のビルド以降に `src/` が変わったか」である。**
`scripts/check-binary-source-drift.py` は **binary と source の両方を実際に走らせて突き合わせる**形を持ち、
**#128 で `npm test` へ統合済み**である。**流用するならこちらを使う。**

> **ただし配備検査は設計書 §診断契約 の 14 項目に無い。**
> 14 項目にあるのは「実行中バイナリ、マニフェスト、plist の**配置先整合性、実行権限、`--version`**」であり、
> **source との乖離ではない。**
> **決定 2-b により、本 Slice では実装しない。**
> **行き先は `#129` §6 条件3（W-7 / Slice 6 が所有）である。** 新規 Issue は起こさない（§8 決定 2）。

### 0.5.6 #165 との順序 — **#165 を先に直す**

**依存関係は無い。** #165 は `status.ts` の**書込経路**の欠陥、Slice 4 は**読取経路**であり、コードは交わらない。

**それでも #165 を先にすることを推奨する。**

```
#165 が先   doctor は lastNotificationAttempt をそのまま報告してよい
Slice 4 が先  doctor は「通知したと記録されているが実際は配送されていない」値を、
              そのまま「通知済み」として報告する  ← 診断が嘘をつく
```

**診断ツールが嘘の値を表示する状態は、診断が無いより悪い。**
順序を変えられない場合は、**doctor が `lastNotificationAttempt` を報告しない**か、
**「配送は保証されない」旨を併記する**こと。

## 1. AC の所有と分担

pm は「owner Slice 列で数えてください」と指示した。
前回（Slice 3）に、備考欄の文字列で絞り込んだ数と列の数が食い違った経緯による。

**列で数えた。**

```text
grep -cE '^\| AC-[0-9]+ \| Slice 4 \|' docs/ACCEPTANCE_TEST_REPORT.md   →  2
そのうち PENDING                                                        →  2
```

| owner 列 | 件数 |
| --- | ---: |
| Slice 2 | 15 |
| Slice 3 | 14 |
| **Slice 4** | **2** |
| **Slice 4 / 6** | **1** |
| Slice 5 | 4 |
| Slice 6 | 10 |
| Slice 7 | 3 |

**Slice 4 が単独で owner の AC は 2 件である（AC-25、AC-33）。**
`Slice 4 / 6` は列の値が別なので `grep -cE '\| Slice 4 \|'` に入らない。**AC-48 の 1 件がこれにあたる。**

### 1.1 前回と同じ数え方が、今回は答えにならない

前回の教訓は「所有範囲を問うなら owner 列で数える」だった。
**今回の問い（Slice 4 が何を追加するか）に対しては、列の数だけでは足りない。**

**owner 列は「どの Slice が判定を閉じるか」を表し、「どの Slice が作るか」を表さない。**

実装分割の AC 割当表は、Slice 4 に**判定を閉じない作業**を割り当てている。

| AC | owner 列 | 実装分割が Slice 4 へ割り当てている作業 |
| --- | --- | --- |
| AC-24 | Slice 6 | 「**Slice 4 で** write method を持たない fake port を自動検査し、Slice 6 で実 Spreadsheet の read-only 到達を確認する」 |
| AC-36 | Slice 6 | 「**Slice 4 で** status fixture 表示を自動検査し、Slice 6 の実 run 後に履歴表示を確認する」 |
| AC-41 | Slice 2 | 目標定義が「部分入力時に `partialInput: true` を保存し、**`doctor` が報告する**」を要求する |

**したがって Slice 4 が実装を負う AC は 6 件である。**

```text
閉じる    AC-25  AC-33            2 件
共有      AC-48（Slice 4 / 6）    1 件
作るが閉じない  AC-24  AC-36  AC-41   3 件
```

pm の見立て（AC-25 / AC-33 / AC-41 / AC-48）は **4 件中 3 件が当たっている。**
**AC-41 の owner 列は `Slice 2` である**が、doctor の報告を要求するので作業は Slice 4 に来る。
見立ての側が実態に近く、**列だけを数えた私の初手が狭かった。**

### 1.2 正本と台帳の食い違い 1 件

**AC-36 の備考が、実装分割の指定を写していない。**

```text
実装分割 §AC 割当表
  AC-36 | Slice 6 | 自動、手動 | Slice 4 で status fixture 表示を自動検査し、
                                Slice 6 の実 run 後に履歴表示を確認する。超過判定は検査しない

ACCEPTANCE_TEST_REPORT.md
  | AC-36 | Slice 6 | 自動、手動 | … | status history | PENDING | Slice 6 で判定 |
```

**備考が「Slice 6 で判定」だけで、Slice 4 の分担が落ちている。**
AC-24 と AC-41 は備考に「Slice 4 fake + Slice 6 real read-only」「Slice 2/4 で判定」と書いてあるので、**AC-36 だけが欠けている。**

台帳を読んだだけの担当者は、**AC-36 に Slice 4 の作業があることを知りえない。**
Task 5 で備考を実装分割へ揃える。**owner 列と判定は変えない。**

## 2. PR 粒度

### 2.1 結論: 1 PR

Slice 3 と同じ理由である（accepted な実装分割が Slice = PR を粒度とし、決定 U-2 が stacked PR を落としている）。

**Slice 4 は Slice 3 より小さい。**
成果物は `doctor.ts`、`sheets-read.ts`、CLI 接続、隔離試験の 4 つで、副作用を持つ操作が 1 つも無い。
分割の議論をする規模ではない。

### 2.2 開始条件: Slice 3 のマージ — **充足済み（2026-08-09 追記）**

**Slice 4 は Slice 3 がマージされるまで開始できない。**
決定 U-2（直列 PR）に加え、実体としても `paths.ts`・`manifest.ts`・`process.ts` に依存する。

**2026-08-09 実測: 3 モジュールとも現 main に存在する。開始条件は満たされている。**

```text
src/installation/paths.ts       存在
src/installation/manifest.ts    存在
src/installation/process.ts     存在（LaunchctlAdapter / ProcessRunner を公開）
```

> **以下は初版（2026-08-07）時点の記録である。現在の状態ではない。**
>
> ```text
> origin/feature/slice3-install-uninstall（origin/main から 3 commit）
>   b50503d  Task 1: model.ts / paths.ts
>   52dfb24  Task 2: manifest schema と atomic I/O
>   822f576  Task 2 continued: state 遷移と再開
>
> 未着手: Task 3（planner）以降
> ```
>
> 初版の時点では、Slice 4 が依存する 3 モジュールのうち `process.ts` が**まだ存在しなかった**
> （Slice 3 の Task 4）。Issue #133 により 2026-08-08 まで PR がマージされない状況でもあった。
> **したがって初版は「Slice 3 のマージ後に着手する計画」だった。**
>
> **Slice 3 は `d1f98bc`（PR #139）でマージ済みであり、この制約は解消している。**

## 3. 実装順

各 Task は TDD で進める。**先に失敗するテストを書き、失敗を確認してから実装する。**

### Task 1: Sheets 読取専用 port

**Files:**
- Create: `src/installation/sheets-read.ts`
- Create: `test/installation/sheets-read.test.ts`

**Interfaces:**
- `SheetsReadPort` は認証、Spreadsheet 読取、当日行特定だけを公開する。
  **セル更新、行追加、sheet 作成のメソッドを型として持たない**（設計書 §モジュール境界）。

- [ ] **Step 1: 失敗するテストを書く。** 認証、Spreadsheet 読取、当日行特定を順に返す fake と、**write メソッドが型に存在しないこと**を検査する。
- [ ] **Step 2: テストが失敗することを確認する。**
- [ ] **Step 3: port と adapter を実装する。**
- [ ] **Step 4: テストが通ることを確認する。**
- [ ] **Step 5: 負のコントロール N-1 を実行する。**

**既存の `src/sheets/adapter.ts` を再利用しない。**
同 adapter は書込メソッドを持つ。読取専用であることを**型で**保証するのが本 port の目的なので、書込を持つ型から派生させると保証が消える。

### Task 2: doctor の診断本体

**Files:**
- Create: `src/installation/doctor.ts`
- Create: `test/installation/doctor.test.ts`

**Interfaces:**
- 入力は path resolver、manifest reader、process adapter、`SheetsReadPort`、settings reader。**すべて注入する。**
- 出力は `PASS | WARN | FAIL` と失敗段階コード。

- [ ] **Step 1: 失敗するテストを書く。** 設計書 §診断契約 の 14 項目それぞれについて、正常系と異常系を 1 対ずつ置く。
- [ ] **Step 2: テストが失敗することを確認する。**
- [ ] **Step 3: 実装する。**
- [ ] **Step 4: テストが通ることを確認する。**
- [ ] **Step 5: §5 の負のコントロールのうち、doctor 本体に関わるもの（`N-3`・`N-4`・`N-5`・`N-6`・`N-7`・`N-8`・`N-8b`・`N-9`・`N-10`・`N-11`）を実行する。**
      **範囲（「N-3 から N-7」）で書かない。** 表に行を足したとき、範囲は黙って古くなる

**検査する 14 項目**（設計書 §診断契約 をそのまま使う。増減させない）:

```text
manifest の schema と state
実行中バイナリ / manifest / plist の配置先整合性、実行権限、--version
settings.json の JSON と schema
Google Sheets 鍵ファイルの存在と読取可否
source に必要な追加認証ファイル（google-fit のみ）
scale_exporter 出力ディレクトリの存在と読取可否
二つの plist の構文と固定チェックアウトパスの不在
二つの launchd label の登録状態
登録有無、best-effort の raw 診断出力、stderr ログの存在
run receipt による serve の稼働状態
pipeline-status.json の直近開始・完了・結果
Google Sheets 認証
対象 Spreadsheet と対象 sheet の読取
日付列と当日行の特定
```

**失敗段階コードは 8 つ**（設計書 §診断契約）:

```text
KEY_MISSING              必要な鍵が存在しない
AUTH_FAILED              Google 認証に失敗した
SHEET_NOT_SHARED         Spreadsheet を読めない
TODAY_ROW_MISSING        当日行を特定できない
INSTALL_PATH_MISMATCH    実行中バイナリ / manifest / plist の配置先が一致しない
BINARY_NOT_EXECUTABLE    存在する実行体に実行権限が無い
BINARY_VERSION_MISMATCH  実行中バイナリと manifest の version が一致しない
LAST_RUN_FAILED          直近の pipeline が失敗した
```

**やってはならないこと**（いずれも設計書に明記があり、§5 の負のコントロールで守らせる）:

```text
Spreadsheet のセル更新・行追加・sheet 作成
ローカル設定・manifest・launchd の状態変更
Google Fit OAuth の再認証の開始
期待時刻の超過判定（AC-36。判定は利用者が行う）
バイナリ欠落時の代替検出（AC-33 の適用範囲外）
```

**未インストール状態は `WARN` とする。`FAIL` にしない。**
設定だけを診断できるようにするためである（設計書 §診断契約）。

**一つでも `FAIL` があれば非ゼロ終了する。**

#### 2026-08-09 追加の受け入れ条件 — `source に必要な追加認証ファイル`（指摘 A）

**この 1 項目は、素直に実装すると「起動を止めない項目を warn し、起動を止める項目を検査しない」**
**という形になる**（`feature/slice4-doctor` の現行実装が実際にそうなっている）。

```
起動を実際に止めるのは   client credentials
  src/config/env.ts:228  requireGoogleFitConfig は config.googleFit が無いと ConfigError を投げる
  google-fit-token-path は見ていない
```

> **訂正（2026-08-09、reviewer 指摘 B-2）**
>
> **初版の本項は必須を 3 項目（client-id / client-secret / redirect-uri）と書いていた。誤りである。**
>
> **実測（`src/config/env.ts`）:**
>
> ```
> :199   if (clientId && clientSecret) { config.googleFit = { ... } }   ← gate はこの 2 つだけ
> :51-55 GOOGLE_FIT_REDIRECT_URI は zod の .default("http://localhost:3000/oauth2callback")
>        → 未設定でも常に値が入る。欠落しえない
> :196   credentials file 側も  redirectUri = credentials.redirectUri ?? redirectUri  で optional
> ```
>
> **必須は client ID と client secret の 2 つである。redirect URI は既定値を持つ。**
>
> **なぜ間違えたか。** 依頼文が「`client-id / -secret / -redirect-uri` を見ていない」と
> 3 つ並べて書いており、**私は診断（`requireGoogleFitConfig` を読む）では一次資料に当たったのに、
> 処方（AC を書く）では依頼文の列挙をそのまま写した。**
> **一次資料を開くのは、問題を特定するときだけでは足りない。対策を書くときにも要る。**

- [ ] **AC 追加**: `source` が `google-fit` のとき、**client ID と client secret の欠落を検出する。**
      環境変数（`GOOGLE_FIT_CLIENT_ID` / `GOOGLE_FIT_CLIENT_SECRET`）、`settings.json`、
      `google-fit-credentials.json` を、**`requireGoogleFitConfig` と同じ解決順で**見る
- [ ] **redirect URI を必須項目として検査しない。** 既定値があるため常に値が入る。
      **必須として扱うと、正常な構成を異常と報告する**
- [ ] **負のコントロール N-8**: **`google-fit-token-path` だけが在り、client ID と secret が無い**状態を作る。
      **doctor がこれを検出しなければ FAIL とする**
- [ ] **負のコントロール N-8b**: **ID と secret は在り、redirect URI を明示していない**状態を作る。
      **doctor がこれを異常として報告したら FAIL とする**（偽陽性の検出）

> **「3 つとも欠落するケースを検出できない」より強い問題である。**
> **検査対象そのものが違う。** token-path の warn は残してよいが、**それを充足の根拠にしない。**

### Task 3: 直近実行の報告

**Files:**
- Modify: `src/installation/doctor.ts`
- Modify: `test/installation/doctor.test.ts`

- [x] **Step 1: 失敗するテストを書く。** status fixture から、対象日、直近開始時刻、直近完了時刻、outcome、転記件数、launchd stderr のパスを表示すること。
- [x] **Step 2: `APP_VERSION`、period ごとの最後の `done` と実転記、各経過日数の報告を検査する。**
      **異常継続日数は実装しない。** status に開始時刻がなく、連続実行回数を日数へ換算すると誤報になるため、AC-48 のこの部分は Issue #192 へ繰り延べた。
- [x] **Step 3: `partialInput: true` が記録されている場合だけ報告することを検査する**（AC-41）。
      producer は Issue #182 まで未実装なので、未定義を「部分入力なし」とは報告しない。
- [x] **Step 4: テストが失敗することを確認してから実装する。**
- [ ] **Step 5: 負のコントロール N-5 を実行する。** Task 5 の全負のコントロール実行で記録する。

**過去の記録が無い項目は「未観測」とし、`done` を転記成功と呼ばない**（目標定義 AC-48）。
`done` と実転記は別の値である。**片方をもう片方の代理にしない。**

#### 2026-08-09 の注記 — 当日行の日付（指摘 B）。**AC へ昇格させない**

```
production の行日付   buildLatestMeasurementSet:215  weightReading?.measuredAt ?? capturedAt
doctor（現行実装）    findTodayRow(dateColumnIndex, deps.now())
```

「measuredAt で上書きする」は**事実である。**
**ただし通常経路では両者は一致する。** `isReadingInPeriodWindow`（`measurements.ts:157`）が
`measuredAt.hasSame(targetDate, "day")` を要求するため、weight は referenceTime と同じ暦日に限られる。

**食い違うのは次の 2 つの場合だけである。**

```
run --date <過去日> の遡り実行
doctor の実行と run の実行が日付をまたぐ
```

- [ ] **注記として記録する。** 「doctor が today-row を PASS と報告したのに実際の run はその行へ書かない」は
      **起こりうるが常時ではない**
- [ ] **AC へ昇格させない。台帳へ「常に起こるギャップ」として載せない**

> **実態より強い主張にしないこと。**
> 条件付きの事象を無条件の欠陥として台帳に載せると、
> **後から読む人が「常に壊れている」と誤解し、優先度を誤る。**

### Task 4: CLI 接続

**Files:**
- Modify: `src/cli/installation.ts`
- Create: `test/cli/doctor.test.ts`

- [x] **Step 1: 失敗するテストを書く。** `doctor` の起動、終了コード（`FAIL` があれば非ゼロ）、`install` と `uninstall` から呼ばれないこと。
- [x] **Step 2: テストが失敗することを確認する。**
- [x] **Step 3: 接続する。**
- [x] **Step 4: `npm run typecheck` と `npm test` を通す。**
- [x] **Step 5: 負のコントロール N-2 を実行する。** install action に `runDoctorCommand` を足す変異を、隔離テストが検出することを確認した。

`--purge` と `--wipe` は**公開しない**（Slice 5 の範囲）。

### Task 5: 隔離試験と記録

**Files:**
- Modify: `scripts/run-installer-acceptance.sh`（Slice 3 で作る harness へ追加）
- Modify: `docs/ACCEPTANCE_TEST_REPORT.md`

- [ ] **Step 1: 設計書 §隔離統合テスト の 10 と 11 を自動化する。**
      10「`install` は network adapter を呼ばず、明示的な `doctor` だけが Google Sheets の読取 API を呼ぶ」
      11「doctor の fake API は認証、Spreadsheet 読取、当日行特定を順に返し、write API の呼出回数がゼロ」
- [ ] **Step 2: AC-25 の隔離 Bun 試験を入れる。** network deny の compiled install が成功または認証不足まで進み、外部通信しない。
- [ ] **Step 3: §5 の負のコントロール表の**全行**を実行し、期待どおり FAIL することを確認する。**
      **件数を書かない。** 表と本文で集合がずれ、**足した分を実行しなくても完了扱いになる**
- [ ] **Step 4: AC-25 と AC-33 を `PASS` にする。**
- [ ] **Step 5: AC-24 / AC-36 / AC-41 / AC-48 の Slice 4 分担分を記録する。判定は動かさない。**
- [ ] **Step 6: §1.2 の食い違いを直す。** AC-36 の備考を実装分割へ揃える。**owner 列と判定は変えない。**
- [ ] **Step 7: `npm run preflight:ac-ledger` が通ることを確認する。**

**doctor 前後で対象 Spreadsheet とローカル状態が不変であることを検査する**（設計書 §macOS 手動受け入れ の項目に対応する自動側）。

## 4. AC 対応表

| AC | owner 列 | Slice 4 での扱い | 閉じる Task |
| --- | --- | --- | --- |
| AC-25 | Slice 4 | **閉じる。** install から doctor / auth / network adapter の呼出ゼロ | Task 4・Task 5 |
| AC-33 | Slice 4 | **閉じる。** 設定破損・認証切れ・権限不足・配置不整合の検出と復旧手順 | Task 2・Task 5 |
| AC-48 | Slice 4 / 6 | `APP_VERSION`、`done`・実転記・経過日数を Task 3 で報告。**異常継続日数は Issue #192 へ繰り延べ**（開始時刻が status に無い） | Task 3 / #192 |
| AC-24 | Slice 6 | **作るが閉じない。** write method を持たない fake port の自動検査 | Task 1 |
| AC-36 | Slice 6 | **作るが閉じない。** status fixture 表示の自動検査。**超過判定は検査しない** | Task 3 |
| AC-41 | Slice 2 | **作るが閉じない。** status API は `partialInput?: boolean` を保持し、doctor は記録された `true` だけを報告する。producer 未実装（#182）のため現時点の production 値は未定義であり、「部分入力なし」とは報告しない | Task 3 |

**新規 AC は不要である。**
6 件はすべて既存の AC-01〜AC-49 の範囲にあり、目標定義または設計書に条件文がある。
台帳へ新しい予約を足す必要はない。

## 5. 負のコントロール

Slice 4 の要求は **「〜してはならない」型が多い。**
禁止は、実装しなくても試験が緑になるため、**壊して落ちることを確かめないと守られているか分からない。**

| # | 変異 | FAIL すべき試験 | これが検出する事故 |
| --- | --- | --- | --- |
| **N-1** | `SheetsReadPort` に write method を 1 つ足す | 「port が write method を持たない」（AC-24 の Slice 4 分担） | doctor が Spreadsheet を書き換えられる状態 |
| **N-2** | `install` の適用段階から `doctor` を呼ぶ | AC-25 の「install から doctor / auth / network 呼出ゼロ」 | install の副産物として外部通信と認証が起きる |
| **N-3** | doctor が manifest の `state` を書き直す | 「doctor 前後でローカル状態が byte-identical」 | 診断が状態を変える。**読取専用の前提が崩れる** |
| **N-4** | `launchctl print` の**出力文字列**から登録判定する | `process.ts` の「終了コードだけで判定する」（Slice 3 の N-7 と同型） | macOS の出力形式変更で静かに壊れる |
| **N-5** | doctor が「期待時刻を超過した」と判定するコードを足す | 「超過判定を行わない」（AC-36、目標定義の「判定は行わない」） | **doctor が能動的な判断をするように見え、利用者が確認をやめる** |
| **N-6** | 未インストール状態を `FAIL` として報告する | 「未インストールは `WARN`」 | 設定だけを診断したい利用者が非ゼロ終了で止まる |
| **N-7** | `FAIL` があっても終了コード0 を返す | 「一つでも `FAIL` があれば非ゼロ終了」 | 自動化から失敗が見えない |
| **N-8** | `google-fit-token-path` だけが在り、client ID と secret が無い状態 | 「client credentials の欠落を検出する」（§Task 2） | **起動を止める項目を検査していない**（指摘 A） |
| **N-8b** | ID と secret は在り、redirect URI を明示しない状態 | 「redirect URI を必須として検査しない」 | 既定値のある項目を必須扱いし、**正常な構成を異常と報告する** |
| **N-9** | legacy 経路（`run-pipeline.sh`）の plist を与える | 「legacy 経路では固定チェックアウトパスを `WARN` とし `FAIL` にしない」 | cutover 前に doctor が必ず異常を出し、**前提条件として使えない** |
| **N-10** | installed 経路の plist に固定チェックアウトパスを混ぜる | 「installed 経路では設計どおり検査する」 | **N-9 だけだと「常に WARN を返す実装」が通る** |
| **N-11** | doctor が `notifier.notify` を呼ぶコードを足す | **「doctor の実行で notifier が 1 度も呼ばれない」** | **doctor を実行するたびに通知が出る**（下記） |

**N-9 と N-10 は対で置くこと。** 片方だけでは、緩すぎる実装と厳しすぎる実装のどちらかが通る。
**N-8 と N-8b も同じ理由で対である。**

### N-11 を置く理由（2026-08-09 追加）

**現在の doctor は通知に一切触れていない。** programmer の実測を独立に確認した。

```
git show origin/feature/slice4-doctor:src/installation/doctor.ts | grep -c 'notification\|health'
  → 0 件。参照しているのは periods[period].lastTerminal のみ
```

**したがってこの禁止は、いま構造として満たされている。だが何も強制していない。**

**doctor は健全性診断であり、「通知状態も報告しよう」は後から自然に足される。**
配送まで足された場合、**doctor は書き戻さないので claim が消費されず、
doctor を実行するたびに通知が出る。**

**満たされているうちに試験を置く。** これが N-11 の目的である。

**N-5 が本 Slice で最も見落としやすい。**
「判定しない」は機能の**不在**であり、実装者が良かれと思って足しうる。
足しても既存の試験は全て通る。**足したことを落とす試験を先に置く。**

目標定義はこの点を明示している。

> `doctor` が「動いていないこと」を教えてくれる → **教えない。** AC-36 は最後に成功した実行を報告するだけで、**期待時刻の超過を判定しない**

**N-3 も同型である。**
診断が状態を変えないことは、変えてみて落ちることを確かめるまで保証されない。

## 6. Slice 3 の成果物の再利用

pm が指定した 4 つ（manifest / planner / executor / paths）について、**再利用するものとしないものを分ける。**

| Slice 3 の成果物 | Slice 4 での扱い | 根拠 |
| --- | --- | --- |
| `paths.ts` | **再利用する。** 同じ path resolver を使う | 設計書 §モジュール境界「`doctor.ts` は `planner.ts` と同じ path resolver と process adapter を使う」 |
| `process.ts` | **再利用する。** ただし `launchctl print` の読取だけ | 同上。変更系は呼ばない |
| `manifest.ts` | **読取だけ再利用する。** schema 検証と read を使い、write を使わない | §診断契約「manifest の schema と `state`」を読む。§5 の N-3 が write を禁じる |
| `model.ts` | 型を再利用する | 同じ概念を別名で定義しない（設計書 §主要な型） |
| **`planner.ts`** | **再利用しない** | 設計書 §モジュール境界「`doctor.ts` は…**write 系の依存を持たない**」 |
| **`executor.ts`** | **再利用しない** | 同上。executor は唯一の副作用境界であり、doctor は副作用を持たない |

**`planner.ts` と `executor.ts` へ依存しないことが、read-only の構造的な保証である。**
依存を持った時点で、N-3 の変異は「試験で検出する」問題から「いつでも起こりうる」問題へ変わる。

Slice 3 以外からの再利用は次のとおりである。

| 資産 | 使い方 |
| --- | --- |
| `installation/settings-read.ts` | `settings.json` の読取と schema 検証。**ファイルを生成しない**契約がそのまま要る |
| `scheduler/run-lease.ts` の receipt 読取 | §診断契約「run receipt による `serve` の稼働状態」 |
| `pipeline/status.ts` の parser | §診断契約「`pipeline-status.json` の直近開始、完了、結果」。**parser を再実装しない** |
| `version.ts` の `APP_VERSION` | AC-48 の build identifier |
| `installation/plist.ts` | §診断契約「二つの plist の構文と固定チェックアウトパスの不在」の期待値生成 |

**`sheets/adapter.ts` は再利用しない**（Task 1 の理由）。

## 7. 完了判定

| # | 条件 | 検査 |
| --- | --- | --- |
| S-1 | `npm run typecheck` が通る | 終了コード0 |
| S-2 | `npm test` が通る | 終了コード0 |
| S-3 | `npm run build:bun` が通る | 終了コード0 |
| S-4 | `npm run acceptance:installer` が通る | 終了コード0 |
| S-5 | **§5 の負のコントロール表の全行**で、対応する試験が FAIL する | Task 5 Step 3 の出力。**表の行数と実行数が一致すること** |
| S-6 | AC-25 と AC-33 が `PASS` | ACCEPTANCE_TEST_REPORT |
| S-7 | AC-24 / AC-36 / AC-41 / AC-48 の Slice 4 分担が記録され、**判定が動いていない** | 同上 |
| S-8 | AC-36 の備考が実装分割と一致する | 同上 |
| S-9 | `npm run preflight:ac-ledger` が通る | 終了コード0 |
| S-10 | `--purge` と `--wipe` が公開されていない | `--help` の出力 |
| S-11 | `SheetsReadPort` の型に write method が無い | `npm run typecheck` と Task 1 の試験 |

## 8. 決めること

> **初版は「無い」と書いた。訂正する。**
> **初版は doctor を単体で見ており、cutover との関係を見ていなかった。**
> 設計書 §診断契約 の中だけを探せば、確かに裁量は無い。
> **裁量は、doctor と cutover runbook の**あいだ**に生じていた。**
> **1 つの文書の中を全文検索しても、文書と文書の矛盾は出ない。**

> ## 決定は 3 件とも出た（2026-08-09、ユーザー決定・manager 経由）
>
> | 決定 | 結果 |
> | --- | --- |
> | 1（循環依存） | **1-a。** plist を読んで経路を判定し、報告を変える |
> | 2（配備検査） | **2-b。** Slice 4 に含めない。**行き先は `#129` §6 条件3（W-7 / Slice 6）。新規 Issue は起こさない** |
> | 3（#165 との順序） | **#165 を先に直す** |
>
> **決定 1 に伴い、`INSTALLATION_DESIGN.md` §診断契約 へ「実行経路の判定」を追記した**（同 PR の別コミット）。
> **追記先を設計書にした理由**:
>
> - 変更が狭い。**14 の検査項目も 8 の失敗段階も増減しない。** 報告の解釈を経路で分けるだけである
> - **実装者が読むのは設計書である。** 計画書にだけ書くと、Slice 4 が出荷された時点で規則が失われる
> - 別途 `docs/decisions/` を立てると、**Issue #114 と本書 §0.5.2 と三重になる。**
>   検証席の枠を 1 本余計に使う
>
> **設計書は `status: accepted` なので、追記には出所を明記した**——
> 「2026-08-09 ユーザー決定（manager 経由）。決定そのものは reviewer の検証範囲外」。
>
> **同じ PR に入れた理由**: 設計の追記は本計画が成立するための前提である。
> **別 PR にして片方だけ落ちると、残った側が誤りになる。** 依存を可視化して不可分にした。

### 決定 1【決定済み: 1-a】cutover 前の本番 plist を doctor はどう報告するか

**§0.5.2 の循環依存。**

```
設計         二つの plist の「固定チェックアウトパスの不在」を検査する
現在の本番   /Users/kappa/Dropbox/data/dev/scale2sheet/scripts/run-pipeline.sh を含む
runbook      doctor を cutover の前提条件に置いている

→ doctor が PASS しないと cutover できない
  cutover しないと plist は置き換わらない
  plist が置き換わらないと doctor は PASS しない
```

| 案 | 内容 | 帰結 |
| --- | --- | --- |
| **1-a（推奨）** | **plist を読んで経路を判定し、報告を変える。** legacy 経路なら「cutover 前は正常」として `WARN`、新経路なら設計どおり判定する | **ユーザー決定 4 と一致する。** 循環が解ける。doctor が cutover 前後の両方で使える。**設計の「不在を検査する」を「経路を判定する」へ広げる**ことになるので、設計書側の追記が要る |
| 1-b | 設計どおり `FAIL` のままにし、**doctor を cutover の前提条件から外す** | 設計を変えない。**ただし cutover 前に doctor を使えない。** #138 の前提条件表から 1 行消す判断が要る |
| 1-c | `doctor --expect-route legacy\|installed` を受け取る | 判定を利用者に委ねる。**利用者が正しい値を渡せる前提**に依存する。渡し間違えると誤った合格が出る |

**推奨は 1-a。** 決定 4 と一致し、循環を解く唯一の案である。
**1-b は「cutover の前に健全性を確かめる」という doctor の存在理由と衝突する。**

**1-a を採る場合、`pipeline-status.json` の報告も経路で変える必要がある**（§0.5.6 と判断 2 の回答）。

```
legacy 経路   status が無いのは正常   「この経路では書かれない」と報告する
新経路        status が無いのは異常   「未実行」と報告する
```

**「未実行」と一律に報告すると誤診になる。** 現行本番は毎日動いているが status は書かれない。

### 決定 2【決定済み: 2-b】配備検査を Slice 4 に含めるか

**§0.5.5 のとおり、設計書 §診断契約 の 14 項目に配備検査は無い。**
14 項目にあるのは「配置先整合性、実行権限、`--version`」であって、**source との乖離ではない。**

| 案 | 内容 | 帰結 |
| --- | --- | --- |
| 2-a | Slice 4 に含める。`check-binary-source-drift` を流用する | doctor が配備の乖離を検出できる。**設計書 §診断契約 に 15 項目目を足すことになる** |
| **2-b（推奨）** | **含めない。既存の受け入れ条件へ委ねる** | Slice 4 の範囲が設計書と一致したままになる。**配備検査は #157 の D3（図と実装の一致）でも埋まらない穴**であり、独立した価値がある |

**推奨は 2-b。** 理由は範囲の潔癖さではなく、**この検査が doctor 固有ではない**ため。
`check-binary-source-drift` は既に `npm test` に統合されており（#128）、
**doctor から呼ぶより、独立した gate として持つほうが「人が doctor を実行したときだけ分かる」状態を避けられる。**

**mtime を判定に使わないこと**は、どちらの案でも守ること（§0.5.5 の実測）。

### 決定 3【決定済み: #165 を先に直す】#165 と Slice 4 の順序

**依存関係は無い**（書込経路と読取経路でコードが交わらない）。**しかし順序に意味がある。**

| 案 | 帰結 |
| --- | --- |
| **3-a（推奨）** | **#165 を先に直す。** doctor は `lastNotificationAttempt` をそのまま報告してよい |
| 3-b | Slice 4 を先にする。**doctor が「通知済み」と表示するが実際は配送されていない値を出す。** 診断が嘘をつく |

**3-b を採るなら、doctor は `lastNotificationAttempt` を報告しないか、
「配送は保証されない」旨を併記すること。**

#### #165 の実装形について（2026-08-09、programmer と合意）

**`parseStatusDocument` / `claimStateLossNotification` への full split は行わない。**

初版の判断 2 回答では split を推奨したが、**#165 の B-1 がそれを不要にする。**

```
B-1 は両 period の claim を配送する
  → parseDocument は両方の claim を返す必要がある
  → currentPeriod の唯一の仕事は「どちらか一方を選ぶ」こと
  → 選ぶ相手がいなくなり、構造的に死ぬ
```

**`currentPeriod` の削除は B-1 の帰結であって、付随的な掃除ではない。**
**消費者のいない `claimStateLossNotification` を今切り出すと、要求が固まる前に API を決めることになる。**

**doctor 側の懸念（claim が消費されず毎回通知が出る）は、禁止の根拠であって
現状の指摘ではなかった。** 現在の doctor は通知に触れていない（実測）。
**その禁止は N-11 で守らせる。**

---

### 決定を受けて、実装側に確定した事項

```
Task 2 へ追加   plist の ProgramArguments を読み、legacy / installed を判定する
                固定チェックアウトパスの存在は、legacy 経路なら WARN（FAIL にしない）
Task 3 へ追加   pipeline-status.json が無い場合の報告を経路で変える
                legacy   「この経路では書かれない」   異常ではない
                installed 「未実行」
負のコントロール N-9  legacy 経路の plist を与えて FAIL にならないこと
負のコントロール N-10 installed 経路の plist を与えて、固定チェックアウトパスが FAIL になること
```

**N-9 と N-10 は対で置くこと。** N-9 だけだと「常に WARN を返す実装」が通る。

**配備検査（決定 2 で除外）は本 Slice で実装しない。**

> **2026-08-09 追記: 新規の Issue を起こす必要は無い。行き先が既にある。**
>
> **`#129`（Issue #114 cutover 実装計画）の §6 条件3 が、まさにこの検査である。**
>
> ```
> 条件3  reviewed head の full SHA / candidate binary の SHA-256 /
>        production へ配置した binary の SHA-256 / launchd の ProgramArguments が指す path
>        の 4 者を機械照合し、不一致で FAIL する
>        command 集合の一致（acceptance:binary-drift）を provenance の証拠として数えない
>
> 所有   W-7（Slice 6）        完了判定 D-8        後置き検査 C-7
> ```
>
> **「別 Issue へ」と書いたまま起票すると、`#129` W-7 と重複する。**
>
> **一般化**: **行き先を名指さない先送りは、二重起票か消失のどちらかになる。**
> 「別 Issue とする」は決定ではなく、**行き先の指定を後回しにしただけ**である。
> **先送りするなら、その場で行き先を名指すこと。**

**#165 を先に直す（決定 3）。** Slice 4 の着手可否は #165 に依存しないが、
**マージ順を守ること。** 逆順になった場合は、doctor が `lastNotificationAttempt` を
報告しないか、「配送は保証されない」旨を併記する（§0.5.6）。

---

**上記 3 件以外に、実装者の裁量に残る設計判断は見つかっていない。**
**実装中に裁量が要る箇所が見つかったら、実装内で決めずに起票すること。**

## 9. 本書が扱っていないこと

- **Slice 5（`--purge` / `--wipe` / 退避）。** 依頼文が「uninstall の残り」と呼んだもの。§0 を参照
- Slice 3 の実装内容。**本書は依存先として参照するだけ**（`d1f98bc` / PR #139 でマージ済み）
- Slice 6 の実 Spreadsheet 到達（AC-24 の Slice 6 分）と実 run 後の履歴表示（AC-36 の Slice 6 分）
- `doctor` が期待時刻の超過を判定する機能。**設計が明示的に除外している**（§5 の N-5）
- バイナリ欠落時の検出。**AC-33 の適用範囲外**。doctor 自身が起動しないため原理的に不可能

## 10. 実測コマンド一覧

```sh
# 1. AC の owner 列
grep -cE '^\| AC-[0-9]+ \| Slice 4 \|' docs/ACCEPTANCE_TEST_REPORT.md
grep -E '^\| AC-[0-9]+ \| Slice 4 \|' docs/ACCEPTANCE_TEST_REPORT.md | grep -c PENDING
grep -oE '^\| AC-[0-9]+ \| Slice [0-9/ ]+ \|' docs/ACCEPTANCE_TEST_REPORT.md \
  | sed -E 's/^\| AC-[0-9]+ \| (Slice [0-9/ ]+) \|/\1/' | sort | uniq -c

# 1.1 / 1.2 正本との突き合わせ
grep -nE '^\| AC-(24|25|33|36|41|48) \| Slice' \
  docs/decisions/2026-07-29T173454_インストーラ実装分割と受け入れ確認の検討書.md
grep -nE '^\| AC-(24|25|33|36|41|48) \|' docs/ACCEPTANCE_TEST_REPORT.md

# 2.2 Slice 3 の進捗
git log --oneline origin/main..origin/feature/slice3-install-uninstall
git diff --stat origin/main origin/feature/slice3-install-uninstall
```

**本番へ副作用のあるコマンドは実行していない。**
`install` / `uninstall` / `doctor` 系、`run` / `pipeline` / `serve` / `auth` はいずれも起動していない。
`git`、`grep`、`sed`、`sort` の読取のみである。
