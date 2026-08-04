---
type: ImplementationPlan
title: Issue #46 状態伝達経路の設計
description: U-1 の実現可能性を調べ、常設には process が必要という制約を踏まえたユーザー最終決定「常設しない・通知のみ」と、その限界を記録する計画。
timestamp: "2026-08-04T19:46:32+09:00"
updated: "2026-08-04T20:56:20+09:00"
---

# Issue #46 Status Delivery Design Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** デスクトップまたはメニューバーへ常設する U-1 の実現可能性を調べ、採否と、最終的に選ばれた notification-only の成立範囲を定義する。

**Architecture:** T-1 を主、T-3 を従、V-3 を主、V-1 を従とする既決定を変えない。
native menu bar、desktop widget、desktop file、SwiftBar / xbar、U-0 を比較し、常設には常駐 process が必要と確定した後は、既存 pipeline 内の状態記録・状態遷移通知と U-3 だけへ設計を縮退する。

**Tech Stack:** Markdown、macOS SwiftUI / AppKit / WidgetKit / ServiceManagement の一次資料、launchd、GitHub Pull Request、`rg`。

## Global Constraints

- 実装しない。production launchd、pipeline、status schema、通知を変更しない。
- U-1 の候補場所は端末のデスクトップまたはメニューバーだったが、最終決定では常設しない。スプレッドシート案も採らない。
- `pipeline done` を転記成功とみなさない。
- 通知は正常と異常の状態遷移時だけ要求し、異常継続中は繰り返さない。
- status の器を経路より先に入れる Slice 境界を維持する。
- 合格条件は予約済みの AC-110〜123 内だけを使い、未使用末尾は台帳規約に従って解放する。
- status が production にまだ存在しない現状を、初回状態と検証前提に反映する。

---

### Task 1: 現行契約と platform 能力の照合

**Files:**
- Read: `docs/decisions/2026-08-04T184244_連続失敗に人が気づくための目標定義.md`
- Read: `docs/decisions/2026-07-29T084808_インストーラとアンインストーラの目標定義.md`
- Read: `docs/INSTALLATION_DESIGN.md`
- Read: `src/pipeline/status.ts`

**Interfaces:**
- Consumes: T-1 / T-3、V-3 / V-1、U-1 / U-3、状態遷移通知、既存の導入撤収境界。
- Produces: native menu bar、desktop widget、desktop file、既存ツール相乗り、U-0 の成立条件と衝突一覧。

- [x] **Step 1: #46 の user decision と既存 AC-96〜109 を、変更禁止の前提として抽出する。**
- [x] **Step 2: MenuBarExtra / NSStatusItem、WidgetKit、SMAppService、launchd、SwiftBar / xbar の一次資料を照合する。**
- [x] **Step 3: 以前の「単一バイナリ、別監視 job なし」と U-1 の常駐要件が同時には成立しないことを明示する。**

### Task 2: 状態モデルと更新契機

**Files:**
- Create: `docs/decisions/2026-08-04T194632_デスクトップとメニューバーへの常設状態表示の検討書.md`

**Interfaces:**
- Produces: `unobserved | healthy | anomalous | status-unavailable` の表示状態。
- Produces: status 置換時、壁時計 timer、wake 時の再判定と通知 receipt の責務境界。

- [x] **Step 1: 正常時も消えない短い表示と、morning / evening の詳細表示を定義する。**
- [x] **Step 2: status 不在、破損、未知 schema、stale を健康と誤表示しない規則を定義する。**
- [x] **Step 3: pipeline が実行されなくても V-1 の時刻閾値を越えられるよう、表示側の wall-clock 評価を要求する。**
- [x] **Step 4: helper crash、無効化、binary 欠落、端末 sleep / shutdown の検出限界を書く。**

### Task 3: 選択肢、推奨、現状維持

**Files:**
- Create: `docs/decisions/2026-08-04T194632_デスクトップとメニューバーへの常設状態表示の検討書.md`
- Modify: `docs/decisions/2026-08-04T184244_連続失敗に人が気づくための目標定義.md`
- Modify: `docs/decisions/2026-08-04T151338_pipeline入力段階の失敗と部分成功の目標定義.md`
- Modify: `docs/decisions/2026-07-29T084808_インストーラとアンインストーラの目標定義.md`

**Interfaces:**
- Produces: native menu bar helper、desktop widget、desktop file、SwiftBar / xbar、U-0 の比較と推奨。
- Produces: user decision を元文書へ書き戻し、スプレッドシート暫定案を不採用として固定する。

- [x] **Step 1: 各案について当方から書ける範囲、常駐、更新遅延、追加依存、自己監視の限界を比較する。**
- [x] **Step 2: production 推奨と、採用に必要な既存決定の例外を明示する。**
- [x] **Step 3: U-0 が成立する条件を #46 の実測と結び付けて書く。**
- [x] **Step 4: desktop / menu bar の user decision とスプレッドシート案の不採用を元文書へ反映する。**
- [x] **Step 5: U-3 の決定を AC-48 の正本と受け入れ台帳へ追記する。**

### Task 4: AC-110〜123 と予約確定

**Files:**
- Create: `docs/decisions/2026-08-04T194632_デスクトップとメニューバーへの常設状態表示の検討書.md`
- Modify: `docs/ACCEPTANCE_TEST_REPORT.md`

**Interfaces:**
- Produces: 常設表示、状態意味、観測軸、更新契機、通知、常駐、限界、security、導入撤収、代替案、検証を覆う14条件。
- Produces: AC-110〜123 の `PENDING` 行を `CONFIRMED` へ遷移させる台帳更新。

- [x] **Step 1: 予約済み範囲に14条件を1整数 IDずつ定義する。**
- [x] **Step 2: 新しい suffix、範囲外 ID、予約幅との差が無いことを機械照合する。**
- [x] **Step 3: 台帳へ定義件数14、定義文書リンク、`CONFIRMED` を記録する。**

### Task 5: 検証と公開

**Files:**
- Modify only: 上記5文書と本計画書。

**Interfaces:**
- Produces: reviewer が選択肢、常駐の生存性、14条件、台帳遷移を独立再現できる Draft PR。

- [x] **Step 1: 参照 URL、相対リンク、front matter、未解決 placeholder を確認する。**
- [x] **Step 2: `git diff --check`、AC 差分、予約範囲、台帳算術、`npm test` を確認する。**
- [x] **Step 3: topic branch を push し、`git ls-remote origin refs/heads/docs/issue-46-menu-bar-status-design` で remote SHA を確認する。**
- [x] **Step 4: kappaseijin4codex で Draft PR を作成し、`scale2sheet_reviewer_claude` へ直接レビューを依頼する。**

### Task 6: ユーザー決定「常設しない・通知のみ」の反映

**Files:**
- Modify: `docs/decisions/2026-08-04T194632_デスクトップとメニューバーへの常設状態表示の検討書.md`
- Modify: `docs/decisions/2026-08-04T184244_連続失敗に人が気づくための目標定義.md`
- Modify: `docs/ACCEPTANCE_TEST_REPORT.md`

**Interfaces:**
- Consumes: M-1 / R-1 / R-2 を不採用、R-0、単一 binary と別監視 job 無しを維持するユーザー決定。
- Produces: notification-only の責務、状態記録と `doctor` の存続、通知経路故障と人が見逃す場合の限界。
- Produces: AC-110〜117 の確定と、予約余剰 AC-118〜123 の `UNUSED` への分割。

- [x] **Step 1: M-1 の調査を不採用案として保存し、結論と構成を notification-only へ反転する。**
- [x] **Step 2: `osascript` nonzero / timeout と OS 側抑制を分け、検出可能範囲と第二防御不在を定義する。**
- [x] **Step 3: AC-105、AC-108、元文書の推奨まとめを最終決定へ追随させる。**
- [x] **Step 4: AC-110〜117 の8条件を定義し、AC-118〜123 を台帳規約どおり `UNUSED` へ戻す。**
- [ ] **Step 5: 差分・AC・台帳・テストを再検証し、merge 済み PR #92 への追補 PR を作って reviewer の再確認を得る。**
