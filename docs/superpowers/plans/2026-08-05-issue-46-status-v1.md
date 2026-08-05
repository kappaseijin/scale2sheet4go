---
type: ImplementationPlan
title: Issue #46 status schema v1 implementation plan
description: AC-118〜121 と AC-123 のうち、definitionsVersion 1 の状態記録の器を実装する計画。
tags:
  - plan
  - scale2sheet
  - issue-46
timestamp: "2026-08-05T11:20:00+09:00"
---

# Issue #46 Status Schema V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pipeline-status.json` を period 別の versioned document として保存し、現行 terminal outcome から連続値と最後の成功時刻を更新する。

**Architecture:** `src/pipeline/status.ts` に v1 document の parser、初期値、terminal reducer、atomic store を置く。`runPipeline` は running と terminal observation を同じ writer へ渡し、CLI は取得済み run lease の owner token を writer に渡す。V-3、health transition 通知、doctor は後続PRの責務とする。

**Tech Stack:** TypeScript、Node.js fs/promises、Vitest。

## Global Constraints

- `schemaVersion: 1`、`definitionsVersion: 1`、`definitionsLabel: "2026-08-04/pre-63"` を書く。
- `periods.morning` と `periods.evening` は常に保持する。
- `failed:*` は連続 no-data を reset せず、`completed:transferred` だけが reset する。
- schema/definitions 版0・未知版・壊れた JSON を自動 migration または上書きしない。
- 一時 file は同一 directory、mode `0600`、rename で置換する。
- V-3、通知、doctor、無制限履歴は本PRの範囲外。

---

### Task 1: Status document reducer and atomic store

**Files:**
- Modify: `src/pipeline/status.ts`
- Create: `test/pipeline/status.test.ts`

**Interfaces:**
- Consumes: current run `{ runId, period, startedAt, targetDate }` and terminal `PipelineStatus`.
- Produces: `PipelineStatusDocumentV1` and `AtomicPipelineStatusWriter.write(status): Promise<void>`.

- [ ] **Step 1: Write failing reducer tests.**

```ts
expect(document.periods.morning.consecutiveNoDataCount).toBe(2);
await writer.write(failedTransfer);
expect(document.periods.morning.consecutiveNoDataCount).toBe(2);
await writer.write(transferred);
expect(document.periods.morning.consecutiveNoDataCount).toBe(0);
expect(document.periods.evening).toEqual(initialPeriodStatus());
```

- [ ] **Step 2: Run `npm test -- test/pipeline/status.test.ts` and confirm the test fails because the versioned document API is absent.**
- [ ] **Step 3: Implement only the v1 types, initial document, strict parser, terminal reducer, and atomic read-modify-write store required by the test.**
- [ ] **Step 4: Run `npm test -- test/pipeline/status.test.ts` and confirm it passes.**

### Task 2: Pipeline and CLI wiring

**Files:**
- Modify: `src/pipeline/pipeline.ts`
- Modify: `src/cli/index.ts`
- Modify: `test/pipeline/pipeline.test.ts`
- Modify: `test/cli/serve-lease.test.ts`

**Interfaces:**
- Consumes: `RunLeaseHandle.ownerToken` from the already-acquired pipeline lease.
- Produces: one active-run write followed by one terminal observation for each pipeline invocation.

- [ ] **Step 1: Write failing tests that assert the lease owner token reaches the status writer and a terminal pipeline result updates only its period.**
- [ ] **Step 2: Run `npm test -- test/pipeline/pipeline.test.ts test/cli/serve-lease.test.ts` and confirm the new assertions fail.**
- [ ] **Step 3: Add the minimal run-id wiring and preserve the existing pipeline outcome behavior.**
- [ ] **Step 4: Run the focused tests and confirm they pass.**

### Task 3: Verification and handoff

**Files:**
- Modify: `docs/ACCEPTANCE_TEST_REPORT.md`

- [ ] **Step 1: Mark only the evidence-backed portion of AC-118〜123; leave V-3, notification, doctor, and lease-contention evidence pending.**
- [ ] **Step 2: Run `npm run typecheck`, `npm test`, and `npm run build:bun`.**
- [ ] **Step 3: Inspect `git diff --check` and `git status --short`; commit the focused change.**
- [ ] **Step 4: Push the topic branch, verify it with `git ls-remote --heads origin <branch>`, create a PR, and request direct review from `scale2sheet_reviewer_claude`.**
