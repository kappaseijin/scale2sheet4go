---
type: Plan
title: Go開発品質ゲートとCI実装計画
description: Issue #5 の検討結果に基づき、ローカルと macOS GitHub Actions で共有する Go 品質ゲートを実装する計画。
tags:
  - plan
  - go
  - quality-gate
  - ci
timestamp: "2026-08-13T14:48:32+09:00"
status: active
---

# Go 開発品質ゲートと CI 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ローカルと GitHub Actions が同じ Go 品質ゲートを実行し、scale2sheet の Go 開発環境を再現可能にする。

**Architecture:** `scripts/check-go-quality-gates.sh` をローカルと CI の唯一のゲート入口にし、整形・依存 checksum・全テスト・標準静的検査・配布 build・Go toolchain 契約を順番に確認する。GitHub Actions は Darwin 固有 lease を実行できる `macos-14` runner 上で、このスクリプトを呼ぶ。

**Tech Stack:** Go 1.22 module、Go 標準 CLI、GitHub Actions、`actions/checkout@v6`、`actions/setup-go@v7`。Staticcheck、race detector、coverage は今回の必須経路へ追加しない。

**Spec:** `docs/decisions/2026-08-13T144832_Go開発品質ゲートとCIの採否についての検討書.md`

## Global Constraints

- 1 Issue = 1 課題 = 1 PR とし、PR 本文に `Closes #5` を付ける。
- `go.mod` の `go 1.22` を Go の最低宣言とし、CI は `go-version-file: go.mod` を使う。
- 品質ゲートの全 Go コマンドに `GOTOOLCHAIN=local` を付け、CI で暗黙に別 toolchain を取得しない。
- テストと build は `CGO_ENABLED=0` で実行する。
- CI runner は `macos-14` とし、Darwin 固有 lease の検査を Linux へ置き換えない。
- README は開発者がローカルで品質ゲートを再現できるよう、入口コマンドと前提を自己完結で記載する。
- 対向 LLM エージェントは配置せず、`scale2sheet_owner_codex` が自己検証する。

---

### Task 1: 品質ゲート入口を追加する

**Files:**
- Create: `scripts/check-go-quality-gates.sh`
- Modify: `docs/NOTES.md`

**Interfaces:**
- Consumes: repository root, `go.mod`, `go.sum`, Go source directories `cmd` and `internal`.
- Produces: exit `0` only when all standard gates and the Issue #4 toolchain contract pass; exit non-zero at the first failed gate.

- [x] **Step 1: Write the gate script**

  Implement an executable Bash script that accepts an optional repository root argument, changes into that root, and runs these commands in this exact order:

  ```bash
  test -z "$(gofmt -l cmd internal)"
  GOTOOLCHAIN=local go mod verify
  GOTOOLCHAIN=local CGO_ENABLED=0 go test -count=1 ./...
  GOTOOLCHAIN=local CGO_ENABLED=0 go vet ./...
  GOTOOLCHAIN=local CGO_ENABLED=0 go build -o dist/scale2sheet ./cmd/scale2sheet
  bash scripts/check-go-toolchain-contract.sh
  ```

  Print a named `PASS` line after each gate so a CI failure identifies its stage. Do not mutate source files in the checker.

- [x] **Step 2: Verify the normal gate**

  Run `bash scripts/check-go-quality-gates.sh` from the repository root. Expected: exit `0`, all six named stages pass, and `dist/scale2sheet` exists.

- [x] **Step 3: Verify the formatting failure path**

  Copy `go.mod`, `go.sum`, `cmd`, `internal`, `README.md`, `scripts/check-go-toolchain-contract.sh`, and the new checker into a temporary directory. Add trailing whitespace to a copied Go file, run the checker with the temporary directory argument, and assert a non-zero exit with a formatting-stage failure. Do not change the repository copy.

### Task 2: Add the macOS GitHub Actions workflow

**Files:**
- Create: `.github/workflows/go.yml`
- Modify: `docs/NOTES.md`

**Interfaces:**
- Consumes: `scripts/check-go-quality-gates.sh` and `go.mod`.
- Produces: pull-request and main-push checks on the same command used locally.

- [x] **Step 1: Define the workflow**

  Create a workflow named `Go quality` with `pull_request` and `push` triggers for `main`, `contents: read` permissions, concurrency cancellation for superseded runs, `macos-14`, and a 15-minute timeout.

- [x] **Step 2: Pin the setup inputs**

  Use `actions/checkout@v6` and `actions/setup-go@v7` with `go-version-file: go.mod` and `cache: true`. Add a `go version` diagnostic step followed by `bash scripts/check-go-quality-gates.sh`.

- [x] **Step 3: Validate the workflow text**

  Check that the workflow contains no npm, Bun, Node, Linux runner, or duplicate Go gate commands. Run `git diff --check` after adding it.

### Task 3: Make the developer contract self-contained

**Files:**
- Modify: `README.md`
- Modify: `docs/PLAN.md`
- Modify: `docs/NOTES.md`

**Interfaces:**
- Consumes: adopted decision and the quality checker.
- Produces: user-facing instructions that reproduce the same local gate and current plan status.

- [x] **Step 1: Update README development instructions**

  Document Go 1.22+, the normal formatting command `gofmt -w cmd internal`, the single gate command `bash scripts/check-go-quality-gates.sh`, the individual stages it runs, and the fact that CI uses `macos-14` plus `GOTOOLCHAIN=local`/`CGO_ENABLED=0`. Keep the existing product acceptance commands after the standard gate.

- [x] **Step 2: Update current plan status**

  Add the adopted Issue #5 quality-gate boundary to the current section of `docs/PLAN.md` without rewriting historical Node/Bun sections. State that Issue #5 is implemented only when the workflow and local checker are merged.

- [x] **Step 3: Record external investigation and decision**

  Append the official Go, GitHub Actions, runner, and Staticcheck references, the Darwin lease constraint, the adopted gates, and the non-adoption of Staticcheck/race/coverage to `docs/NOTES.md` with an RFC3339 JST timestamp.

### Task 4: Run all verification and prepare the single PR

**Files:**
- Modify: `docs/ACCEPTANCE_TEST_REPORT.md`
- Modify: `docs/superpowers/plans/2026-08-13-go-quality-gates.md`

**Interfaces:**
- Consumes: Tasks 1–3 and the current Go binary.
- Produces: reproducible evidence for one Issue #5 PR.

- [x] **Step 1: Run standard gates and negative controls**

  Run `gofmt -w cmd internal`, `git diff --check`, `bash scripts/check-go-quality-gates.sh`, and the temporary formatting-negative control. The normal gate must pass and the negative control must fail.

- [x] **Step 2: Run existing acceptance and documentation gates**

  Run `bash scripts/run-bun-binary-smoke.sh`, `bash scripts/run-pipeline-shadow-acceptance.sh`, `bash scripts/run-installer-acceptance.sh`, `bash scripts/run-runtime-safety-acceptance.sh`, `bash scripts/run-google-sheets-deadline-acceptance.sh`, `bash scripts/run-binary-source-drift-acceptance.sh`, `node scripts/verify-readme-config-keys.mjs`, `python3 scripts/check-doc-refs.py`, and `python3 scripts/check-ac-ledger.py`.

- [x] **Step 3: Record evidence and close the plan**

  Add exact commands, timestamps, runner/tool versions, normal PASS results, and the intentional negative-control failure to `docs/ACCEPTANCE_TEST_REPORT.md`. Change this plan frontmatter to `status: completed` and mark all steps checked.

- [ ] **Step 4: Commit, PR, merge, and synchronize**

  Commit only Issue #5 files, push `issue-5-go-quality-gates`, create one PR with `Closes #5`, inspect the exact head and available CI result, merge autonomously after all gates pass, synchronize local `main` with `origin/main`, delete the merged local branch, and verify a clean tree.
