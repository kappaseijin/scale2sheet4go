---
type: Plan
title: macOS公開配布署名と公証の実装計画
description: Issue #10 の fail-closed 契約資産を維持し、Apple=3 の対象外判断を資料へ反映する計画。
tags:
  - plan
  - macos
  - signing
  - notarization
  - ci
timestamp: "2026-08-13T21:19:19+09:00"
status: active
---

# macOS 公開配布署名と公証の実装計画

**Goal:** Apple=3 のユーザー判断に従い、Developer ID 公開配布の正常系を対象外とし、unsigned/local artifact と fail-closed 契約 acceptance の現行境界を資料へ固定する。

**Spec:** `docs/decisions/2026-08-13T211919_Apple3_macOS公開配布正常系を対象外とする判断.md`

## Constraints

- 1 Issue = 1 課題 = 1 PR。資料同期は Issue #37 に紐づけ、Issue #10 の正常系を credentials 待ちとして残さない。
- 署名順序は universal binary → binary codesign → DMG 作成 → DMG codesign → notarytool submit/wait/log → stapler staple/validate → hdiutil/spctl/codesign verification。
- Developer ID identity 以外の identity、`codesign --deep`、`sudo`、リポジトリへの secret 保存は禁止する。
- PR CI では notarization を実行しない。手動または `v*` tag の `macos-release` environment workflow だけが secret を読む。
- Apple=3 により Developer ID credentials の取得・投入・正常系 acceptance は行わない。契約資産は fail-closed のまま維持する。
- 対向 LLM エージェントは配置せず、`scale2sheet_owner_codex` が acceptance と negative control を実施する。

## Tasks

### Task 1: 署名・DMG・公証 script

**Files:**
- Create: `scripts/build-macos-distribution.sh`
- Create: `scripts/run-macos-distribution-contract-acceptance.sh`

- [x] **Step 1: Write the script contract and dry-run/negative tests**

  `--dry-run` は出力を作らず、必要な tool と固定順序を表示する。通常経路は Developer ID identity と notary auth のどちらも無ければ、build/output mutation 前に失敗する。

- [x] **Step 2: Implement signed DMG route**

  Existing universal builder、`codesign`、`hdiutil create -format UDZO`、`xcrun notarytool submit --wait`、`notarytool log`、`stapler`、`spctl`、mount inspection を接続する。API key と Keychain profile の両方を認証方式として受理する。

- [x] **Step 3: Run local contract acceptance**

  Apple Development identity や ad hoc への誤使用、credentials 不足、既存 output への部分書込みを negative control で確認する。正常系は Apple=3 により対象外として記録する。

### Task 2: CI secret/keychain boundary

**Files:**
- Create: `.github/workflows/macos-release.yml`

- [x] **Step 1: Add manual/tag release workflow**

  `macos-14` runner、`macos-release` environment、temporary p12 keychain、temporary App Store Connect `.p8`、distribution script、artifact upload、always cleanup を定義する。

- [x] **Step 2: Verify secret fail-closed and no PR exposure**

  Workflow trigger、permissions、secret names、logs、cleanup を静的検査し、通常 Go quality workflow が secret を要求しないことを確認する。

### Task 3: README/design/acceptance records

**Files:**
- Modify: `README.md`
- Modify: `docs/EXTERNAL_DESIGN.md`
- Modify: `docs/INSTALLATION_DESIGN.md`
- Modify: `docs/PLAN.md`
- Modify: `docs/NOTES.md`
- Modify: `docs/ACCEPTANCE_TEST_REPORT.md`

- [x] **Step 1: Document public distribution setup**

  Apple 正常系が対象外であること、local artifact と fail-closed contract acceptance が対象内であることを README に自己完結で記載する。

- [x] **Step 2: Record external research and Apple=3 scope decision**

  Apple URLs と local identity/secret observation は履歴として保持し、Apple=3 により normal acceptance を対象外とし、秘密情報なしの contract acceptance を現行対象とする判断を RFC3339 JST で記録する。

### Task 4: Verification and one PR

- [x] **Step 1: Run all local Go quality and acceptance gates**

  Existing Go gates and acceptance plus the new contract acceptance、workflow YAML/shell checks、README/doc/AC checksを実行する。全実行可能な検査は PASS。

- [x] **Step 2: Apply the Apple=3 scope decision**

  Issue #10 のユーザー判断 Apple=3 により、signed binary、DMG、公証、staple、Gatekeeper の正常系は対象外とした。秘密情報なしの contract acceptance は対象内として維持する。

- [ ] **Step 3: Synchronize documents and close the follow-up**

  Issue #37 の docs-only PR で README、PLAN、受入報告、関連設計を更新する。全実行可能な検査を通過した後、Issue #37 を close し、Issue #10 を対象外理由付きで close する。
