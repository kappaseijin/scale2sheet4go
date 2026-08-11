---
type: ImplementationPlan
title: Google Sheets 操作期限 #280 の実装計画
description: Google Sheets の認証・読取・書込を単一の30秒deadlineで中断し、pipelineのlease回復までを検証する。
timestamp: "2026-08-11T20:10:48+09:00"
---

# Google Sheets 操作期限 #280 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 無応答のGoogle認証またはSheets APIがpipelineのleaseを保持し続けないよう、adapter一回全体を30秒で中断する。

**Architecture:** `updateSpreadsheetMeasurements` が一つの `AbortController` を所有し、同じ `AbortSignal` をGoogleAuth transportとheader/date/batch-updateへ渡す。abortされた呼出しだけをstageとwrite confirmationを持つtyped errorに正規化し、既存のtransfer失敗経路を通す。

**Tech Stack:** TypeScript、googleapis、Vitest（fake timer）、Bun compiled binary、Node TCP blackhole。

## Global Constraints

- deadline正本は `GOOGLE_SHEETS_OPERATION_DEADLINE_MS = 30_000` 一つだけとし、設定化しない。
- timeoutは既存の `failed:transfer` / exit `1` / V3 `transfer.state: failed` のまま扱い、definitionsVersionを上げない。
- #248のproduction portを前提にせず、unit fakeはtest-localに留める。
- timeout後のbatch updateは結果未確認であり、application retryを追加しない。
- normal response、no-data、run、serveの既存契約を変えない。
- deliveryはstacked方式とする。PR 1はadapter/auth/pipeline/CLI/schedulerと資料を含むreview用feeder、PR 2はcompiled binaryのblackhole acceptanceを含む。両PRを含むaggregate headだけをmainへ取り込む。

---

### Task 1: adapterのtimeout契約をREDで固定する

**Files:**
- Modify: `test/sheets/adapter.test.ts`
- Test: `test/sheets/adapter.test.ts`

**Interfaces:**
- Consumes: 現行 `updateSpreadsheetMeasurements(options)` と `google.sheets()` import境界。
- Produces: P-1〜P-5 と normal control の実行可能なtest-local Sheets fake。

- [x] **Step 1: header/date/batchがabortまで待つfakeを作り、P-1〜P-3を記述する**

  各caseは `vi.useFakeTimers()` で `GOOGLE_SHEETS_OPERATION_DEADLINE_MS` を進め、`GoogleSheetsOperationTimeoutError` の `stage` と `writeConfirmation` をobservable behaviorとしてassertする。

- [x] **Step 2: P-5を記述する**

  成功する三呼出しへ渡ったrequest optionの `signal` objectが同一であることをassertする。これはsignalを省く／別controllerを作るproduction変更で失敗する。

- [x] **Step 3: normal controlを記述する**

  三呼出し成功時に既存の `written` outcomeと件数を返しtimeout diagnosticを出さないことをassertする。

- [x] **Step 4: REDを確認する**

  Run: `npx vitest run test/sheets/adapter.test.ts`

  Expected: normal controlはPASS、P-1〜P-3/P-5はdeadline未実装を理由にFAIL。

### Task 2: adapterとauthに単一期限を実装する

**Files:**
- Modify: `src/sheets/adapter.ts`
- Modify: `src/auth/google-sheets-auth.ts`
- Test: `test/sheets/adapter.test.ts`

**Interfaces:**
- Consumes: Task 1のfakeと `GoogleSheetsAuthConfig`。
- Produces: `GoogleSheetsOperationTimeoutError`、`GoogleSheetsOperationStage`、`GOOGLE_SHEETS_OPERATION_DEADLINE_MS`。

- [x] **Step 1: deadline controllerとtyped timeout errorを追加する**

  adapter入口で一つのcontrollerとtimerを作る。await直前にstageを更新し、controllerのsignalがabortされた時だけ元errorをtimeout errorへ変換する。全経路でtimerをclearする。

- [x] **Step 2: 同一signalをauthと三つのSheets requestへ配線する**

  `createGoogleSheetsAuth(config, signal)` が `clientOptions.transporterOptions.signal` を渡し、header/date/batchのrequest optionにも同じsignalを渡す。

- [x] **Step 3: GREENを確認する**

  Run: `npx vitest run test/sheets/adapter.test.ts && npm run typecheck`

  Expected: P-1〜P-5とnormal controlがPASS。

### Task 3: 既存command境界をtimeoutとして固定する

**Files:**
- Modify: `test/pipeline/pipeline.test.ts`
- Modify: `test/cli/run-exit-code.test.ts`
- Create: `test/scheduler/scheduler.test.ts`
- Test: 上記3ファイル

**Interfaces:**
- Consumes: Task 2のtyped timeout errorと既存pipeline transfer port。
- Produces: P-7、P-9、P-10のregression probes。

- [x] **Step 1: P-7を追加する**

  transferがtyped timeoutをrejectしたとき、terminal statusが `failed:transfer` となりsafeなstage diagnosticを含みexit `1`となることをassertする。

- [x] **Step 2: P-9/P-10を追加する**

  `run` はtimeoutを握り潰さずnonzeroへ、`serve` は一回のtimeout後にもscheduler processを維持する既存境界をassertする。

- [x] **Step 3: GREENを確認する**

  Run: `npx vitest run test/pipeline/pipeline.test.ts test/cli/run-exit-code.test.ts test/cli/serve-lease.test.ts`

  Expected: timeoutが既存transfer失敗経路を通り、正常経路もPASS。

### Task 4: PR 2でcompiled pipelineのblackhole acceptanceとlease回復を加える

**Files:**
- Create: `scripts/run-google-sheets-deadline-acceptance.sh`
- Create: `test/acceptance/google-sheets-deadline.test.ts`
- Modify: `scripts/run-pipeline-shadow-acceptance.sh`
- Test: 新規acceptance wrapper

**Interfaces:**
- Consumes: compiled binary、隔離HOME、構文上有効な偽service account、TCP blackhole。
- Produces: P-6/P-8のbounded failure、status、lease再取得の証拠。

- [x] **Step 1: blackholeとchild watchdogを作る**

  blackholeはTCP connectionを一件以上受理後にHTTP responseを返さない。watchdogはproduction deadlineより長いwall-clock上限でchildだけを回収する。

- [x] **Step 2: timeout後のstatusとlease再取得をassertする**

  第1 runはauth-or-header-read timeoutで `failed:transfer` / exit `1`、lease不存在となる。第2 runは同じnamespaceでleaseを取得し、`RunLeaseConflictError`にならない。

- [x] **Step 3: existing shadow acceptanceのbounded waitを確認する**

  transfer到達後の無期限待機がなく、既存のproducer非起動・status shapeのclaimを維持する。

- [x] **Step 4: focused acceptanceを実行する**

  Run: `npx vitest run test/acceptance/google-sheets-deadline.test.ts`

  Expected: blackhole受理、30秒前後のtimeout、failed:transfer、lease再取得がPASS。build/startup/deadline/postをmonotonic clockで複数回測定し、child lstart、receipt/pipeline startedAt、blackhole accept、terminal/exit、lease再取得も個別に記録する。正常値ではなく内部failure boundからfocused runnerを導出する。startup 60秒、deadline watchdog 45秒、post-reacquire watchdog 30秒、build/fixture/cleanup backstop 45秒により180秒とする。単独3回のnormal phase最大値合計51.27秒、probe不成立0/3、Vitest経由は2 tests / 51.02秒でPASS。

初期の再実行失敗はblackhole serverの`time`未importにより正の制御が落ちたものだった。import修正後、receipt・running status・blackhole接続をstartupの三条件としてmonotonic clockで監視し、上の3回を得た。startup failureはproduct timeoutのKILLEDに混ぜない。

### Task 5: PR 1のnegative controls、利用者向け資料、最終gateを揃える

**Files:**
- Modify: `README.md`
- Modify: `docs/ACCEPTANCE_TEST_REPORT.md`
- Test: adapter/pipeline/CLI/acceptance suites

**Interfaces:**
- Consumes: Tasks 1〜4のtestsとacceptance evidence。
- Produces: M-1〜M-9三値ledgerとREADMEの安全上限制約。

- [x] **Step 1: M-1〜M-9を一つずつ実行し記録する**

  deadline開始、三request signal、auth signal、outcome、write confirmation、lease release、normal responseを各変異で確認する。type errorは `KILLED-BY-TSC`、behavior failureだけを `KILLED` とする。

- [x] **Step 2: READMEとacceptance reportを更新する**

  外部Sheets操作の30秒上限とbatch timeoutが「結果未確認」で即時retryしない制約、blackhole baselineとlease recoveryをREADMEだけで運用可能な形に反映する。

- [x] **Step 3: targeted gateを実行する**

  Run: `npx vitest run test/pipeline test/service test/cli test/installation test/docs && npm run typecheck && npm run build:node`

  Expected: PASS。PR 1はTask 4のblackhole acceptanceを含めないreview用feederであり、mainへ先行mergeしない。`pipeline-shadow`を含む全`npm test`が未達なら、#280以前のhangが原因であることをPR本文へ明記する。
