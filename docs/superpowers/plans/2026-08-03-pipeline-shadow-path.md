---
type: ImplementationPlan
title: Slice 2 pipeline shadow path
description: 公開 JSONL を消費する内蔵 pipeline を、production launchd を変更せず追加する計画。
timestamp: "2026-08-03T21:00:00+09:00"
---

# Pipeline Shadow Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `scale2sheet pipeline --period <morning|evening>` を Bun compiled binary で手動実行可能にし、公開済み JSONL を安全に消費する。

**Architecture:** pipeline は Slice 1 の `RunLease` を取得し、producer を起動せず `scale-exporter-output-dir` の JSONL を bounded stable snapshot で読む。入力・転記の結果を port 化した notifier、clock、status writer に渡し、CLI は終了コードだけを返す。plist は値を返す純粋関数であり、書込みと `launchctl` 呼出しは含めない。

**Tech Stack:** TypeScript、Bun compile、Commander、Luxon、Vitest、Node `fs` port。

## Global Constraints

- production `scripts/run-pipeline.sh`、既存 launchd plist、`launchctl bootstrap`、本番 label を変更しない。
- producer process と実 network を pipeline から起動・利用しない。
- `INPUT_READ_ATTEMPTS = 3`、`INPUT_STABILITY_INTERVAL_MS = 5_000`。missing / unstable / invalid は exit 1、invalid period は exit 2、exit 3 は予約のまま使わない。
- `newUniqueRecordCount > 0 && periodUniqueRecordCount = 0` の契約不整合分岐は、Issue #54 の照会3回答まで実装・有効化しない。
- `pipeline-status.json` は 0600・atomic replacement、対象 file 数・読取行数・period 適用後 reading 数を記録する。

---

### Task 1: Read-only pipeline settings and input snapshot port

**Files:**
- Modify: `src/config/settings.ts`, `src/installation/settings-read.ts`
- Create: `src/pipeline/input-snapshot.ts`
- Test: `test/pipeline/input-snapshot.test.ts`

**Interfaces:**
- Produces `readPipelineSettings(settingsPath, environment): PipelineSettings` with a resolved output directory and no filesystem creation.
- Produces `InputSnapshotReader.read(targetDate): Promise<StableInput>` whose result has `filesMatched`, `linesRead`, `readings`, and snapshot metadata.

- [ ] **Step 1: Write failing snapshot tests**

```ts
await expect(reader.read("2026-08-03")).rejects.toMatchObject({ outcome: "input-missing" });
expect(delay.calls).toEqual([5_000, 5_000]);
expect(result).toMatchObject({ filesMatched: 1, linesRead: 2 });
```

- [ ] **Step 2: Run `npm test -- test/pipeline/input-snapshot.test.ts` and confirm missing module failure.**

- [ ] **Step 3: Implement the minimum port**

```ts
export const INPUT_READ_ATTEMPTS = 3;
export const INPUT_STABILITY_INTERVAL_MS = 5_000;
export interface InputSnapshotReader { read(targetDate: string): Promise<StableInput>; }
```

Record sorted matching filenames with device, inode, size, and mtime before and after the delay and again after strict JSONL parsing. Retry every mismatch or parse failure through attempt three; never run a producer command.

- [ ] **Step 4: Rerun the focused test and confirm missing, unstable, invalid, and stable cases pass.**
- [ ] **Step 5: Commit `feat: add stable pipeline input snapshot`.**

### Task 2: Pipeline orchestration, status, and notification ports

**Files:**
- Create: `src/pipeline/pipeline.ts`, `src/pipeline/status.ts`, `src/pipeline/notifier.ts`, `src/pipeline/index.ts`
- Modify: `src/service/measurements.ts`
- Test: `test/pipeline/pipeline.test.ts`, `test/pipeline/status.test.ts`

**Interfaces:**
- Consumes `InputSnapshotReader`, `RunLeaseHandle`, an injected `Clock`, `Notifier`, and `PipelineStatusWriter`.
- Produces `runPipeline(options): Promise<0 | 1>` and an atomic per-period status document.

- [ ] **Step 1: Write failing orchestration tests**

```ts
expect(result.exitCode).toBe(1);
expect(sync.calls).toHaveLength(0);
expect(notifier.requests).toEqual([{ stage: "input", period: "morning" }]);
expect(status.last.filesMatched).toBe(1);
```

Cover stable readings, present-but-zero (exit 0 and no transfer), each input failure (one input notification), and transfer failure (one transfer notification).

- [ ] **Step 2: Run `npm test -- test/pipeline/pipeline.test.ts test/pipeline/status.test.ts` and confirm failure.**

- [ ] **Step 3: Implement the minimum orchestration**

```ts
const lease = await acquireRunLease({ kind: "pipeline" });
try { return await runPipelineWithPorts(options); } finally { await lease.release(); }
```

Write `running` then terminal status using a 0600 temporary file and rename. Include timestamps, period, outcome, three required counts, and no-data as a successful no-transfer outcome. Do not compare `newUniqueRecordCount` with the local period count while Issue #54 keeps that branch pending.

- [ ] **Step 4: Rerun focused tests and confirm fake clock, status, notifier, and lease assertions pass.**
- [ ] **Step 5: Commit `feat: add pipeline status and failure stages`.**

### Task 3: CLI command and read-only command resolution

**Files:**
- Modify: `src/cli/index.ts`, `src/config/settings.ts`
- Test: `test/cli/pipeline.test.ts`, `test/config/settings.test.ts`

**Interfaces:**
- Produces `scale2sheet pipeline --period <morning|evening>`.
- Returns process exit 2 for invalid period and preserves the existing `run` and `serve` commands.

- [ ] **Step 1: Write failing CLI tests**

```ts
await runCli(["node", "scale2sheet", "pipeline", "--period", "morning"]);
expect(acquireLease).toHaveBeenCalledWith({ kind: "pipeline" });
expect(process.exitCode).toBe(2);
```

- [ ] **Step 2: Run `npm test -- test/cli/pipeline.test.ts` and confirm command absence.**
- [ ] **Step 3: Add the command and resolver.**

Resolve only existing settings and environment values; the output directory is consumer configuration. Leave exporter execution out of this command and preserve the pending Issue #54 condition in a code comment adjacent to the local-count decision.

- [ ] **Step 4: Rerun CLI and settings tests.**
- [ ] **Step 5: Commit `feat: expose the pipeline shadow command`.**

### Task 4: Pure plist generator and compiled acceptance harness

**Files:**
- Create: `src/installation/plist.ts`, `scripts/run-pipeline-shadow-acceptance.sh`
- Modify: `package.json`, `docs/ACCEPTANCE_TEST_REPORT.md`
- Test: `test/installation/plist.test.ts`

**Interfaces:**
- Produces `buildPipelinePlist(input): string`; it has no filesystem or launchctl dependency.
- Produces `npm run acceptance:pipeline-shadow`.

- [ ] **Step 1: Write failing plist tests**

```ts
expect(plist).toContain("<key>ProgramArguments</key>");
expect(plist).toContain("StandardErrorPath");
expect(plist).not.toContain("scripts/run-pipeline.sh");
```

- [ ] **Step 2: Run `npm test -- test/installation/plist.test.ts` and confirm module absence.**
- [ ] **Step 3: Implement value-only plist generation and acceptance script.**

The harness builds Bun, uses a temporary HOME and JSONL fixture, runs compiled `pipeline` with network denied, asserts no producer invocation, kills a holder with SIGKILL, and verifies a new pipeline lease can be acquired. Its negative control must make an input failure exit nonzero within a bounded interval rather than hang.

- [ ] **Step 4: Run the focused plist test and `npm run acceptance:pipeline-shadow`.**
- [ ] **Step 5: Update AC-07, AC-26, AC-29, AC-30, AC-31, and AC-34 evidence; commit `test: accept compiled pipeline shadow path`.**

### Task 5: Full verification and review handoff

**Files:**
- Modify only the files produced above when verification identifies a defect.

- [ ] **Step 1: Run `npm run typecheck`, `npm test`, `npm run build:bun`, both runtime acceptance scripts, and `git diff --check`.**
- [ ] **Step 2: Run the pipeline acceptance negative control and confirm bounded nonzero exit.**
- [ ] **Step 3: Commit any verification repair separately with a focused message.**
- [ ] **Step 4: Push `feat/pipeline-shadow-path`, create the Slice 2 PR, and request direct review from `scale2sheet_reviewer_claude`.**
