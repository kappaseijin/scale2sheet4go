---
type: ImplementationPlan
title: AC 番号予約台帳
description: AC 番号を起草前に予約し、並行起草の衝突と予約幅不足をレビューで検出する台帳を導入する計画。
timestamp: "2026-08-04T19:15:47+09:00"
---

# AC Number Reservation Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AC-50〜109 の既存割当を backfill し、以後の起草者が本文を書く前に番号と予定件数を予約する手順を一箇所へ固定する。

**Architecture:** `docs/ACCEPTANCE_TEST_REPORT.md` に、受け入れ試験の判定表とは独立した AC 番号予約台帳を置く。
予約 PR の merge を共有資源の直列化点とし、起草 PR の reviewer gate が予約範囲、定義件数、状態遷移を照合する。
導入前から存在する重複番号は backfill で明示し、新しい重複を許さない。

**Tech Stack:** Markdown、Git、GitHub Pull Request、`rg`。

## Global Constraints

- 予約 PR は Issue、予定件数、開始番号、終了番号を `PENDING` で記録し、起草前に merge する。
- 件数が増えた場合は既存番号を動かさず、追加範囲を別の予約 PR で先に確保する。
- `PENDING` と `CONFIRMED` の意味を番号割当の状態として定義し、試験判定の `PENDING` と混同しない。
- AC-93〜95 は `UNUSED` として記録し、予約済みとして扱わない。
- 導入前の番号重複は renumber せず、legacy overlap として記録する。
- 導入前の `AC-54a` は legacy suffix として記録し、新規予約では1条件につき接尾辞の無い整数番号を1つ使う。
- 起草 PR は、予約漏れ、範囲外番号、件数超過、未更新の `PENDING` があれば reviewer が block する。

---

### Task 1: 既存割当の正本照合

**Files:**
- Read: `docs/decisions/*.md`
- Read: `docs/ACCEPTANCE_TEST_REPORT.md`

**Interfaces:**
- Consumes: main に merge 済みの AC 定義行と各文書の Issue、状態。
- Produces: AC-50〜109 の範囲、件数、所有 Issue、文書パス、重複、欠番の照合表。

- [ ] **Step 1: AC 定義行を列挙する。**

```bash
rg -n '^- \*\*AC-[0-9]+.*\*\*' docs/decisions --glob '*.md'
```

- [ ] **Step 2: 他文書への参照を除外し、合格条件の見出し配下にある定義だけを範囲へ集約する。**
- [ ] **Step 3: AC-66〜69 と AC-66〜71、AC-70〜76 と AC-66〜71 の legacy overlap を記録する。**
- [ ] **Step 4: AC-93〜95 が定義されておらず、意図的な未使用であることを #46 の文書と照合する。**

### Task 2: 予約台帳と状態モデル

**Files:**
- Modify: `docs/ACCEPTANCE_TEST_REPORT.md`

**Interfaces:**
- Produces: 開始番号、終了番号、予定件数、定義件数、Issue、割当状態、定義文書、備考を持つ予約台帳。
- Produces: `PENDING`、`CONFIRMED`、`UNUSED` の状態定義と legacy overlap の記録規則。

- [ ] **Step 1: 予約台帳の列と状態を定義する。**
- [ ] **Step 2: AC-50〜109 の既存割当を backfill する。**
- [ ] **Step 3: 新規予約では `終了番号 - 開始番号 + 1 = 予定件数` かつ予定件数と定義件数が一致することを確認する。**
- [ ] **Step 4: AC-53〜65 は整数枠13個、定義14件であり、AC-54a を legacy suffix として記録する。**
- [ ] **Step 5: 同一番号を使う既存文書を備考へ相互参照し、将来の再利用対象から除外する。**

### Task 3: 起草前手順と reviewer gate

**Files:**
- Modify: `docs/ACCEPTANCE_TEST_REPORT.md`

**Interfaces:**
- Produces: 予約、追加予約、起草、確定、取消の手順。
- Produces: reviewer が予約漏れと幅不足を block する照合項目。

- [ ] **Step 1: 起草者が予定件数を数え、使用可能な連続範囲を選び、予約 PR だけを先に merge する手順を書く。**
- [ ] **Step 2: 起草 PR が新しい AC 定義を追加するとき、同じ Issue の `PENDING` 範囲内であることを確認する手順を書く。**
- [ ] **Step 3: 定義件数が予約を超える場合、追加予約 PR の merge 前には本文を増やさない規則を書く。**
- [ ] **Step 4: 起草 PR で使用済み範囲を `CONFIRMED` にし、未使用部分を `UNUSED` へ分割する規則を書く。**
- [ ] **Step 5: reviewer が次の差分抽出を行い、予約の無い AC 定義を block する手順を書く。**

```bash
git diff --unified=0 origin/main...HEAD -- 'docs/**/*.md' | rg '^\+.*\*\*AC-[0-9]+'
```

### Task 4: 検証と公開

**Files:**
- Modify only: `docs/ACCEPTANCE_TEST_REPORT.md`, `docs/superpowers/plans/2026-08-04-ac-reservation-ledger.md`

**Interfaces:**
- Produces: reviewer が backfill と運用ゲートを再現できる Draft PR。

- [ ] **Step 1: AC-50〜109 の各定義が台帳の所有範囲または legacy overlap に含まれることを照合する。**
- [ ] **Step 2: AC-93〜95 以外の欠番、未記録範囲、予定件数の算術不一致が無いことを確認する。**
- [ ] **Step 3: `git diff --check` と Markdown の表構造を確認する。**
- [ ] **Step 4: 文書2ファイルだけを commit し、topic branch を push する。**
- [ ] **Step 5: `git ls-remote origin refs/heads/docs/ac-reservation-ledger` で remote head を確認する。**
- [ ] **Step 6: kappaseijin4codex で Draft PR を作成し、`scale2sheet_reviewer_claude` へ直接レビューを依頼する。**
