---
type: Plan
title: Go版受入マトリクス現行化計画
description: Issue #13 の Go acceptance runner と AT-01〜18 の現行証跡を整備する計画。
tags:
  - plan
  - go
  - acceptance
  - scale2sheet
timestamp: "2026-08-13T16:19:48+09:00"
status: active
issue: 13
---

# Go版受入マトリクス現行化計画

## Goal

現行 Go バイナリで再実行できる受入証跡を一つの runner と対応表へ集約し、実外部環境待ち・仕様判断待ち・旧経路の履歴を明確に分離する。

## Constraints

- 一つの Issue・一つの PR とする。
- 実作業は `scale2sheet_owner_codex` 一席で行い、対向 LLM は配置しない。
- 実ユーザーの HOME、credential、Spreadsheet を使わない。
- 既存の acceptance script は各自の隔離 fixture と build 契約を維持する。
- AT-10a は Issue #14 の決定なしに変更しない。
- README は利用者向け手順の正本であり、今回の開発経緯は docs に記録する。

## Task 1: 仕様と外部調査を保存する

- [x] 現行 Go acceptance と旧 AT 表の差を調査する。
- [x] Google 公式 Sheets / OAuth / Fit の API 契約を確認する。
- [x] [Go版受入マトリクス現行化設計](../specs/2026-08-13-go-acceptance-matrix.md) を保存する。

## Task 2: 正本 runner を追加する

- [x] `scripts/run-go-acceptance-matrix.sh` を追加する。
- [x] 現行 8 本の Go acceptance script を固定順で実行する。
- [x] 失敗を隠さず non-zero で返し、成功時は実行対象を表示する。

## Task 3: 受入資料を現行化する

- [x] `docs/ACCEPTANCE_TEST_REPORT.md` に現行 Go マトリクスと実測日時を追記する。
- [x] `docs/EXTERNAL_TEST_DESIGN.md` に一括 runner と AT 分類への導線を追記する。
- [x] `docs/INTERNAL_TEST_DESIGN.md` の Go test 対応を確認する。
- [x] `docs/PLAN.md` に Issue #13 の現行受入証跡を追記する。
- [x] `README.md` の受入実行入口を一括 runner へ更新する。
- [x] 旧 TS/Bun の節は履歴として残し、現行 PASS と誤読されない見出しを付ける。

## Task 4: 検証する

- [x] `GOTOOLCHAIN=local CGO_ENABLED=0 go test -count=1 ./...`
- [x] `GOTOOLCHAIN=local CGO_ENABLED=0 go vet ./...`
- [x] `bash scripts/check-go-quality-gates.sh`
- [x] `bash scripts/run-go-acceptance-matrix.sh`
- [x] `node scripts/verify-readme-config-keys.mjs`
- [x] `python3 scripts/check-doc-refs.py`
- [x] `python3 scripts/check-ac-ledger.py`
- [x] `git diff --check`

## Task 5: PR と同期

- [ ] 差分、issue scope、受入証跡を自己確認する。
- [ ] Issue #13 の一つの PR を作成する。
- [ ] reviewer の formal review と全 gate 成功を確認する。
- [ ] PR を main へ merge し、main を origin と同期して作業ブランチを削除する。
- [ ] Issue #13 を完了条件に従って close する。

## 完了時の残存ブロッカー

Issue #13 完了後も、次の分類は自動的に解消しない。

- AT-01〜AT-06: 専用 Google 検証環境と実時刻観測が必要。
- AT-10a: Issue #14 の A-0/A-1 契約決定が必要。
- 公開配布の署名・公証: Issue #10 の Apple credentials が必要。
