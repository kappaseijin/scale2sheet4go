---
type: Plan
title: macOS本番ビルドとLaunchAgent運用実装計画
description: Issue #6 の検討結果に基づき、universal Go binary、custom prefix doctor、per-user LaunchAgent 運用を確定する計画。
tags:
  - plan
  - macos
  - release
  - launchd
timestamp: "2026-08-13T15:13:18+09:00"
status: active
---

# macOS 本番ビルドと LaunchAgent 運用実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** macOS の Apple Silicon/Intel を一つの universal Go binary で対象にし、配置・LaunchAgent・doctor・uninstall を同じ本番パス契約で再現できるようにする。

**Architecture:** `scripts/build-macos-release.sh` が `darwin/arm64` と `darwin/amd64` を `CGO_ENABLED=0`、`GOTOOLCHAIN=local`、`-trimpath` で build し、macOS の `lipo` で一つへまとめる。installer は既存の per-user `~/Library/LaunchAgents` と `launchctl gui/<uid>` を維持し、doctor だけ custom prefix を受け取って install と同じ `Paths` を解決する。

**Tech Stack:** Go 1.22 module、macOS Go cross-build、Xcode Command Line Tools `lipo` / `file` / `plutil`、per-user launchd。Developer ID signing/notarization は Issue #10 の別目的とする。

**Spec:** `docs/decisions/2026-08-13T151318_macOS本番ビルドとLaunchAgent運用の採否についての検討書.md`

## Global Constraints

- 1 Issue = 1 課題 = 1 PR とし、PR 本文に `Closes #6` を付ける。
- release build は `GOOS=darwin`、`GOARCH=arm64|amd64`、`CGO_ENABLED=0`、`GOTOOLCHAIN=local`、`-trimpath` を明示する。
- universal binary は `lipo -create` 後に `file` と `lipo -info` で二つの architecture を確認する。
- installer は per-user LaunchAgent (`~/Library/LaunchAgents`) と `gui/<uid>` domain を使い、root の LaunchDaemon や `/Library` を使わない。
- `doctor --prefix <dir>` は `install --prefix <dir>` と同じ binary/manifest を診断する。
- README は本番 build、配置、launchd 登録、状態確認、停止、uninstall、署名境界を自己完結で記載する。
- Developer ID、Hardened Runtime、notarytool、stapler は Issue #10 で扱い、本 Issue の acceptance は ad hoc universal artifact で行う。
- 対向 LLM エージェントは配置せず、`scale2sheet_owner_codex` が自己検証する。

---

### Task 1: custom prefix doctor の回帰を TDD で修正する

**Files:**
- Create: `internal/cli/commands_test.go`
- Modify: `internal/cli/commands.go`
- Modify: `internal/cli/invocation_test.go`

**Interfaces:**
- Consumes: `Invocation.Prefix`, `installation.ResolvePaths`, `installation.WriteManifest`.
- Produces: `doctor --prefix <dir>` that reads the shared manifest and reports whether its recorded prefix and binary placement match the requested prefix.

- [x] **Step 1: Write the failing test**

  Add a test in package `cli` that sets `HOME` to `t.TempDir()`, resolves a non-default prefix below that home, writes a valid installed manifest at the shared config path, and calls `runDoctorCommand(Invocation{Prefix: prefix}, Output{Out: &out, Err: &err})`. Assert that output contains `state=installed`, `[PASS] prefix: <prefix>`, and the custom binary path. Do not create a manifest at `~/.local`.

- [x] **Step 2: Run the focused test and verify RED**

  Run `GOTOOLCHAIN=local CGO_ENABLED=0 go test ./internal/cli -run TestDoctorUsesCustomPrefix -count=1`. Expected: FAIL because the current command resolves `~/.local` regardless of `Invocation.Prefix` and reports `not installed`.

- [x] **Step 3: Implement the minimal fix**

  Change `runDoctorCommand` to derive `prefix := invocation.Prefix`; when it is empty use `~/.local`; pass that prefix to `installation.ResolvePaths`. Add a prefix check against `manifest.Prefix` and a manifest binary-path check against `paths.BinaryPath`, while retaining the existing executable/version/settings/plist checks.

- [x] **Step 4: Run the focused test and verify GREEN**

  Re-run the focused test. Expected: PASS. Then run `GOTOOLCHAIN=local CGO_ENABLED=0 go test ./internal/cli -count=1`.

### Task 2: Add the explicit universal macOS release build

**Files:**
- Create: `scripts/build-macos-release.sh`
- Modify: `.gitignore` only if a tracked release fixture is introduced (normally no change)

**Interfaces:**
- Consumes: module root and optional output path argument.
- Produces: executable universal Mach-O at `${1:-dist/scale2sheet}` with `arm64` and `x86_64` slices.

- [x] **Step 1: Write the build script contract**

  Implement an executable script that rejects missing `go`, `lipo`, or `file`; creates a temporary directory with `mktemp -d`; cleans it on exit; builds both targets with:

  ```bash
  GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 GOTOOLCHAIN=local go build -trimpath -o "$tmp/scale2sheet-arm64" ./cmd/scale2sheet
  GOOS=darwin GOARCH=amd64 CGO_ENABLED=0 GOTOOLCHAIN=local go build -trimpath -o "$tmp/scale2sheet-amd64" ./cmd/scale2sheet
  lipo -create "$tmp/scale2sheet-arm64" "$tmp/scale2sheet-amd64" -output "$output"
  ```

  Resolve a relative output path from the repository root, create its parent directory, set mode `0755`, and fail unless `file` reports Mach-O and `lipo -info` reports both `arm64` and `x86_64`. Do not sign with a developer identity in this script.

- [x] **Step 2: Run the normal build**

  Run `bash scripts/build-macos-release.sh /tmp/scale2sheet-issue6-universal` and assert exit `0`, executable mode, `file` output containing `Mach-O`, and `lipo -archs` containing `arm64 x86_64` (order-independent).

- [x] **Step 3: Run the negative control**

  Invoke the script with `PATH=/usr/bin:/bin` and an empty temporary Go shim that exits non-zero, or with a non-existent output parent that the script must create; assert the missing-tool/build failure is non-zero and no partial output remains. Preserve the repository tree.

### Task 3: Make installer acceptance use and inspect the production artifact

**Files:**
- Modify: `scripts/run-installer-acceptance.sh`
- Create: `scripts/run-macos-release-acceptance.sh`
- Modify: `docs/INSTALLATION_DESIGN.md`

**Interfaces:**
- Consumes: `scripts/build-macos-release.sh`, isolated HOME, fake launchctl, network-deny environment.
- Produces: acceptance evidence that the universal artifact is executable, can install/uninstall, and that the generated plist is valid macOS XML.

- [x] **Step 1: Add release acceptance**

  Create an acceptance script that builds a temporary universal binary, checks `file` and `lipo -archs`, prepares a ready isolated HOME with fixture settings/credentials, runs `install --launchd` with a fake `launchctl`, runs `plutil -lint` on the two written plist files, and runs the binary `--version` and `doctor --prefix <custom-prefix>` without contacting Google.

- [x] **Step 2: Switch installer acceptance to the release builder**

  Replace the current thin host build at the top of `scripts/run-installer-acceptance.sh` with `bash scripts/build-macos-release.sh "$binary"`, keeping all existing isolation and negative controls unchanged.

- [x] **Step 3: Document actual launchd boundaries**

  Update `docs/INSTALLATION_DESIGN.md` with the universal build command, `doctor --prefix`, `plutil -lint`, `launchctl print gui/<uid>/<label>` read-only status check, `launchctl kickstart -k gui/<uid>/<label>` manual restart, and the Issue #10 signing boundary.

### Task 4: Update README and project records

**Files:**
- Modify: `README.md`
- Modify: `docs/EXTERNAL_DESIGN.md`
- Modify: `docs/PLAN.md`
- Modify: `docs/NOTES.md`
- Modify: `docs/ACCEPTANCE_TEST_REPORT.md`

**Interfaces:**
- Consumes: decision and tested build/installer behavior.
- Produces: README-only reproducible operator instructions and current plan status.

- [x] **Step 1: Replace production build instructions**

  Make `bash scripts/build-macos-release.sh` the production build command, state that it emits a universal `darwin/arm64` + `darwin/amd64` binary with CGO disabled, and distinguish pilot ad hoc local use from future signed public distribution.

- [x] **Step 2: Complete the operator runbook**

  Document `install --dry-run`, `install --launchd`, `doctor --prefix`, read-only `launchctl print`, `launchctl kickstart -k`, `uninstall --dry-run`, and the retained settings/auth/state/log files after uninstall. Do not instruct users to run `go run` for production.

- [x] **Step 3: Update current plan and notes**

  Add the Issue #6 adopted boundary and Issue #10 follow-up link to `docs/PLAN.md` and `docs/NOTES.md`. Keep old Bun/Node entries historical. Record external URLs and the local command observations with RFC3339 JST timestamps.

### Task 5: Full verification and one Issue #6 PR

**Files:**
- Modify: `docs/superpowers/plans/2026-08-13-macos-production.md`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: one PR that closes Issue #6 after local and CI evidence.

- [x] **Step 1: Run focused and standard gates**

  Run the focused custom-prefix test through its RED/GREEN cycle, `bash scripts/build-macos-release.sh`, `bash scripts/run-macos-release-acceptance.sh`, `bash scripts/run-installer-acceptance.sh`, `bash scripts/run-runtime-safety-acceptance.sh`, `bash scripts/check-go-quality-gates.sh`, `python3 scripts/check-doc-refs.py`, `python3 scripts/check-ac-ledger.py`, `node scripts/verify-readme-config-keys.mjs`, and `git diff --check`.

- [x] **Step 2: Record evidence**

  Add exact commands, `file`/`lipo` output, plist lint result, custom-prefix doctor result, acceptance results, timestamps, and the intentional negative-control failure to the acceptance report and notes.

- [ ] **Step 3: Commit, PR, CI, merge, and synchronize**

  Mark this plan completed, commit only Issue #6 files, push `issue-6-macos-production`, create one PR with `Closes #6`, wait for the macOS CI pass, merge autonomously, close/check Issue #6, synchronize main, delete the merged branch, and verify a clean tree.
