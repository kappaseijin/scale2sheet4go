---
type: Plan
title: macOS公開配布署名と公証の実装計画
description: Issue #10 の Developer ID、DMG、公証、staple、Gatekeeper、CI secret 境界を実装する計画。
tags:
  - plan
  - macos
  - signing
  - notarization
  - ci
timestamp: "2026-08-13T15:44:08+09:00"
status: active
---

# macOS 公開配布署名と公証の実装計画

**Goal:** Issue #6 の universal Go binary を Developer ID Application + Hardened Runtime で署名し、DMG を notarytool 公証・staple・Gatekeeper 検査済みの公開配布 artifact にする。

**Spec:** `docs/decisions/2026-08-13T154408_Developer ID署名とnotarytool公証の採否についての検討書.md`

## Constraints

- 1 Issue = 1 課題 = 1 PR。PR 本文は `Closes #10` とする。
- 署名順序は universal binary → binary codesign → DMG 作成 → DMG codesign → notarytool submit/wait/log → stapler staple/validate → hdiutil/spctl/codesign verification。
- Developer ID identity 以外の identity、`codesign --deep`、`sudo`、リポジトリへの secret 保存は禁止する。
- PR CI では notarization を実行しない。手動または `v*` tag の `macos-release` environment workflow だけが secret を読む。
- credentials が無い環境では fail-closed とし、ad hoc/Apple Development で正常扱いにしない。
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

  Apple Development identity や ad hoc への誤使用、credentials 不足、既存 output への部分書込みを negative control で確認する。正常系は credentials 不在のため未実施として記録する。

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

  Apple Developer ID certificate export、required GitHub environment secrets、manual/tag workflow、DMG output、notary log、Gatekeeper verification、secret retention boundary を README に自己完結で記載する。

- [x] **Step 2: Record external research and credential blocker**

  Apple URLs、local identity/secret observation、credentials 無しの normal acceptance 未実施を RFC3339 JST で記録する。

### Task 4: Verification and one PR

- [x] **Step 1: Run all local Go quality and acceptance gates**

  Existing Go gates and acceptance plus the new contract acceptance、workflow YAML/shell checks、README/doc/AC checksを実行する。全実行可能な検査は PASS。

- [ ] **Step 2: Execute real Developer ID/notary acceptance when credentials are available**

  Signed binary、DMG、notarytool result/log、stapler validate、hdiutil verify、spctl open/execute の正常系を確認する。credentials が無い場合はその事実を blocker として Issue に記録し、success claim をしない。

- [ ] **Step 3: Commit, PR, CI, review, merge, main sync**

  Issue #10 の単一 PR とし、全実行可能なチェックが PASS してからマージする。live credentials が未提供なら PR は fail-closed の実装までに留め、Issue #10 は open のままにする。
