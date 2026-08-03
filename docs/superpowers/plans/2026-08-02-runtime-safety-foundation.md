---
type: ImplementationPlan
title: Runtime Safety Foundation Implementation Plan
description: scale2sheet installer Slice 1 の runtime safety foundation 実装計画。
tags:
  - scale2sheet
  - installer
  - run-lease
  - bun
timestamp: "2026-08-02T12:00:00+09:00"
---

# Runtime Safety Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline execution for this Slice 1 plan). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the shared version, read-only settings, and Darwin/APFS-backed run lease foundation without adding installer, pipeline, plist, or launchctl commands.

**Architecture:** `settings-read.ts` parses an existing settings file but never creates one. `run-lease.ts` owns the stable APFS lock, owner-token socket, receipt, and cooperative-stop polling; `serve` obtains this lease before scheduling and releases it during shutdown. A compiled Bun acceptance harness proves the kernel lock across two processes.

**Tech Stack:** TypeScript (NodeNext), Bun 1.3.14 compiled binary, Vitest, macOS/APFS Unix sockets.

## Global Constraints

- Define raw Darwin `O_EXLOCK_DARWIN = 0x0020`; never use `fs.constants.O_EXLOCK`.
- Restrict the runtime filesystem to APFS `statfs.type === 0x1a` under fixed `/tmp/scale2sheet-<uid>-<namespace>`.
- The stable `active-run.lock` is never unlinked, truncated, or replaced.
- Derive the namespace from the physical real path of the configuration directory, and reject socket paths longer than 103 UTF-8 bytes.
- Tests must separately prove module behavior in Vitest and kernel behavior through two compiled Bun processes, including SIGKILL release.
- Do not add installer/pipeline CLI, plist generation, launchctl interaction, or production launchd changes.

---

### Task 1: Version and read-only settings boundary

**Files:**
- Create: `src/version.ts`
- Create: `src/installation/settings-read.ts`
- Modify: `src/config/settings.ts`
- Test: `test/installation/settings-read.test.ts`

**Interfaces:**
- Produces `APP_VERSION = "0.1.0"`.
- Produces `readSettings(path): SettingsFile | undefined`, which returns `undefined` for a missing file and throws `ConfigError` for invalid JSON/schema.

- [ ] Write tests for missing-file non-creation, valid parsing, and invalid JSON/schema failures.
- [ ] Run `npm test -- test/installation/settings-read.test.ts`; each new assertion must fail because the module is absent.
- [ ] Implement `APP_VERSION` and the shared schema-based read-only loader; make `loadOrCreateSettings` reuse the parser without changing its creation behavior.
- [ ] Re-run the focused test and `npm run typecheck`.

### Task 2: Run lease state machine and serve integration

**Files:**
- Create: `src/scheduler/run-lease.ts`
- Modify: `src/scheduler/index.ts`
- Modify: `src/scheduler/scheduler.ts`
- Modify: `src/cli/index.ts`
- Test: `test/scheduler/run-lease.test.ts`
- Test: `test/scheduler/scheduler.test.ts`

**Interfaces:**
- Produces `RunLease.acquire(options): Promise<RunLeaseHandle>` and `RunLeaseHandle.release(): Promise<void>`.
- `RunLeaseHandle` exposes an owner token and cooperative-stop state; the holder creates an owner-specific socket and receipt only after the APFS lock is held.
- `startScheduler` accepts a lease and stops scheduling when its 15-second cooperative-stop polling observes the matching stop receipt.

- [ ] Write failing unit tests for raw flag construction, unsupported platform/APFS rejection, lock conflict classification, random 128-bit token, socket/receipt token match, owner-only cleanup, and cooperative stop.
- [ ] Run the focused Vitest files and confirm each failure is due to absent lease behavior.
- [ ] Implement the lease state machine using `O_CREAT | O_RDWR | O_EXLOCK_DARWIN | O_NONBLOCK | O_NOFOLLOW`, `fstat`, APFS validation, physical-path namespace hashing, owner-specific sockets, bounded observer retry, and no stable-lock cleanup.
- [ ] Integrate `serve` acquisition/release while retaining existing scheduler behavior for successful ownership.
- [ ] Re-run focused Vitest and `npm run typecheck`.

### Task 3: Compiled Bun two-process acceptance harness

**Files:**
- Create: `scripts/run-runtime-safety-acceptance.sh`
- Modify: `package.json`
- Test: harness itself through `npm run acceptance:runtime-safety`

**Interfaces:**
- The harness starts compiled `scale2sheet serve` under a supplied temporary HOME, which prints readiness only after ownership.
- The harness builds `dist/scale2sheet`, starts one compiled `serve` holder, verifies a second compiled process reports `EAGAIN` or `EWOULDBLOCK`, sends SIGKILL, and verifies a new compiled holder acquires the lease.

- [ ] Write the harness assertions before adding its fixture behavior.
- [ ] Run the harness and confirm the missing fixture/command fails.
- [ ] Implement the harness with temporary HOME/prefix, network-deny environment, cleanup trap, and no production paths.
- [ ] Run `npm run acceptance:runtime-safety` and inspect holder-conflict/SIGKILL evidence.

### Task 4: Installer acceptance report skeleton and final gate

**Files:**
- Modify: `docs/ACCEPTANCE_TEST_REPORT.md`
- Test: documentation static review

- [ ] Add an `Installer AC（AC-01〜AC-38）` table with every AC, final owner Slice, required method, `PENDING` verdict, and no secrets.
- [ ] Record Slice 1 evidence only for the runtime foundation; leave final-owner AC verdicts `PENDING`.
- [ ] Run `npm run typecheck`, `npm test`, `npm run build:bun`, and `npm run acceptance:runtime-safety`.
- [ ] Run `git diff --check` and inspect the diff against Slice 1 boundaries.
