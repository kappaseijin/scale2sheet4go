---
type: Plan
title: AT-10a A-0契約反映計画
description: Issue #14で確定したA-0入力異常ポリシーを、現行Goの正本資料と受入マトリクスへ反映する。
tags:
  - plan
  - go
  - acceptance
  - at-10a
  - issue-14
timestamp: "2026-08-13T19:02:40+09:00"
status: completed
issue: 14
---

# AT-10a A-0契約反映計画

> **For agentic workers:** この計画は本セッションでインライン実行する。別エージェントは起動しない。

**Goal:** ユーザーが確定したAT-10a=A-0を現行Goの入力契約・受入マトリクス・計画資料へ反映し、A-1を現行契約と誤認できない状態にする。

**Architecture:** 現行Go runtimeは変更しない。A-0の既存挙動（parse error、全体失敗、transfer未実行、exit 1）を決定記録と受入資料へ接続する。通知文の明示変更は独立したIssue #31・別PRへ残す。

**Tech Stack:** Go、Markdown、既存の文書・受入検査スクリプト。

**Spec:** `docs/superpowers/specs/2026-08-13-go-input-policy-decision-brief.md`

## Global Constraints

- 1 Issue 1目的、1 Issue 1 PRとする。
- A-0を採用し、対象日の入力に1ファイルでも1行でも不正があれば全体を失敗させ、転記しない。
- A-1、I-before、I-afterのruntime変更は行わない。
- 通知文の明示変更はIssue #31へ分離する。
- READMEは利用者向けの設定・利用手順を自己完結させるが、今回の決定経緯はdocsへ記録する。

---

### Task 1: A-0決定を正本として記録する

**Files:**
- Create: `docs/decisions/2026-08-13T190240_Go版AT-10a入力異常ポリシーをA-0へ確定.md`

- [x] ユーザー理由、契約、既存Go挙動、通知要求、非対象を記録する。

### Task 2: 決定準備書を確定状態へ更新する

**Files:**
- Modify: `docs/superpowers/specs/2026-08-13-go-input-policy-decision-brief.md`

- [x] A-0選択、A-1/I-before/I-after非採用、通知要件、Issue #31への分離を追記する。
- [x] 「ユーザー決定が必要」「決定しない」という未完了表現を現状と矛盾しない説明へ更新する。

### Task 3: 現行Go受入資料をA-0へ整合させる

**Files:**
- Modify: `docs/superpowers/specs/2026-08-13-go-acceptance-matrix.md`
- Modify: `docs/ACCEPTANCE_TEST_REPORT.md`
- Modify: `docs/PLAN.md`
- Modify: `docs/superpowers/specs/2026-08-11-file-level-input-skip-design.md`

- [x] AT-10aを `BLOCKED_DECISION` からA-0契約の `AUTO_PASS` 判定へ移す。
- [x] 現行Goの期待結果を `failed:input-invalid-or-partial`、exit 1、transfer未実行へ統一する。
- [x] A-1比較資料が現行Goの契約ではなく、採用しなかった比較・履歴であることを明示する。

### Task 4: 文書検証を実行する

- [x] `git diff --check` を実行する。
- [x] `python3 scripts/check-doc-refs.py` を実行する。
- [x] `bash scripts/check-go-quality-gates.sh` を実行し、文書変更でGo契約の既存テストが壊れていないことを確認する。
- [x] `bash scripts/run-go-acceptance-matrix.sh` を実行し、現行Goの隔離受入が維持されることを確認する。

### Task 5: Issue #14のPRを作成する

- [x] 差分がIssue #14のA-0契約資料だけであることを確認する。
- [x] `git show --check --oneline HEAD` でcommitを検証する。
- [x] Issue #14をcloseするPRを `kappaseijin4codex` で作成する（[#32](https://github.com/kappaseijin/scale2sheet4go/pull/32)）。

## 検証結果

- `python3 scripts/check-doc-refs.py`: PASS
- `python3 scripts/check-ac-ledger.py`: PASS
- `node scripts/verify-readme-config-keys.mjs`: PASS
- `bash scripts/check-go-quality-gates.sh`: PASS
- `bash scripts/run-go-acceptance-matrix.sh`: 8 scripts PASS
- 通知文のruntime変更はIssue #31へ分離し、本計画では未実施。
