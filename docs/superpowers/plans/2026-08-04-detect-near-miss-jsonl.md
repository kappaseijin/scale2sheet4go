# Detect Near-Miss JSONL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 命名規約に近いが入力採用されない JSONL を検出し、正常な入力処理を継続したまま status と JSON log に記録する。

**Architecture:** reader が NFC 正規化した判定名から正規入力、無視対象、異常候補を分類する。pipeline の snapshot は reader が export する正規入力述語を使用し、候補を snapshot と input error から終端 status と logger へ一度だけ伝搬する。

**Tech Stack:** TypeScript、Node.js fs/promises、Vitest。

## Global Constraints

- 正規入力の述語は reader にだけ実装し、pipeline は export を使用する。
- NFC は分類だけに使い、アクセスと status 保存には readdir の生の名前を使う。
- Finder 複製は .jsonl の直後に続く「のコピー」または「のコピーN」を無視する。
- 異常候補の通知は配線しない。
- 終端 status と JSON log は同じ候補配列と completedAt を使う。

---

### Task 1: ファイル名の分類と共有述語

**Files:**
- Modify: `src/sources/scale-exporter/reader.ts`
- Modify: `src/sources/scale-exporter/index.ts`
- Test: `test/scale-exporter/reader.test.ts`

**Interfaces:**
- Produces: `isScaleExporterTargetFile(name: string, targetDate: string): boolean` と、正規名、生の異常候補を返す分類関数。

- [ ] **Step 1: Write the failing test**

NFD の「のコピー」と「のコピー2」を作成し、reader が正規 JSONL だけを読むことを assert する。

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/scale-exporter/reader.test.ts`

Expected: FAIL。分類 API が未実装で、NFD 複製の除外を保証できない。

- [ ] **Step 3: Write minimal implementation**

正規入力述語と NFC 分類を reader に実装し、pipeline 用に正規入力述語だけを export する。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/scale-exporter/reader.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

`git add src/sources/scale-exporter test/scale-exporter/reader.test.ts && git commit -m "feat: classify near-miss exporter files"`

### Task 2: snapshot と status/log の候補伝搬

**Files:**
- Modify: `src/pipeline/input-snapshot.ts`
- Modify: `src/pipeline/status.ts`
- Modify: `src/pipeline/pipeline.ts`
- Test: `test/pipeline/input-snapshot.test.ts`
- Test: `test/pipeline/pipeline.test.ts`

**Interfaces:**
- Consumes: reader の `isScaleExporterTargetFile` と分類結果。
- Produces: `InputAnomalyCandidate`、終端 status の `inputAnomalyCandidates`、JSON 1行 logger 出力。

- [ ] **Step 1: Write the failing tests**

正規入力と異常候補の共存、異常候補だけ、無視対象だけ、複数候補の順序、running status の field 不在、logger 1回を assert する。

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/pipeline/input-snapshot.test.ts test/pipeline/pipeline.test.ts`

Expected: FAIL。候補と logger 契約が未実装。

- [ ] **Step 3: Write minimal implementation**

候補を StableInputSnapshot と InputSnapshotError へ運び、終端 status と logger に同一配列を一回だけ出力する。

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/pipeline/input-snapshot.test.ts test/pipeline/pipeline.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

`git add src/pipeline test/pipeline && git commit -m "feat: record input filename anomalies"`

### Task 3: 回帰検証

**Files:**
- Modify: `docs/decisions/2026-08-04T171300_命名規約不一致ファイルの検出についての検討書.md`

- [ ] **Step 1: Run type check**

Run: `npm run typecheck`

Expected: PASS。

- [ ] **Step 2: Run complete test suite**

Run: `npm test`

Expected: PASS。

- [ ] **Step 3: Commit documentation and verification-ready changes**

`git add docs && git commit -m "docs: define input anomaly status contract"`
