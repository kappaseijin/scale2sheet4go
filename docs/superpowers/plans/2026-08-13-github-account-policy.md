---
type: Plan
title: scale2sheet GitHub 操作アカウント方針の反映計画
description: Issue #20 の主人格・派生席に割り当てる GitHub アカウントと操作経路を資料へ固定する計画。
tags:
  - plan
  - github
  - account
  - pilot
timestamp: "2026-08-13T17:14:23+09:00"
status: active
issue: 20
---

# Issue #20 GitHub 操作アカウント方針の反映計画

## 目的の妥当性

Issue #20 は、製品コードや Go の実行環境を変更せず、現行パイロットの GitHub 操作主体を識別可能にする課題である。
主人格 `codex_product_owner` と派生席 `scale2sheet_owner_codex` が同じ `kappaseijin4codex` を使うことを資料へ固定すると、Issue、PR、push、merge の監査証跡がプロジェクトの担当席と一致する。
一席運用・対向 LLM 不配置という現行方針とも整合するため、プロジェクト全体に対して妥当である。

## 調査と外部解決手段

リポジトリ内に認証機構を追加せず、既存の GitHub CLI プロファイルと SSH alias を利用する。

| 確認対象 | 確認結果 |
| --- | --- |
| `GH_CONFIG_DIR="$HOME/.config/gh-4codex" gh auth status` | active account は `kappaseijin4codex` |
| `git remote get-url origin` | `git@github.com-kappaseijin4codex:kappaseijin/scale2sheet4go.git` |
| 既存の PR 操作経路 | `gh-4codex` 用の設定と SSH alias を利用可能 |
| 既定 `gh` 設定 | `kappaseijin` のため、このプロジェクトでは使用しない |

この外部経路で Issue／PR の主体と Git push の SSH 認証を統一できるため、リポジトリ内の認証ラッパーや秘密情報は追加しない。

## 採用方針

- 主人格 `codex_product_owner` の GitHub アカウントは `kappaseijin4codex` とする。
- 派生席 `scale2sheet_owner_codex` の GitHub アカウントは `kappaseijin4codex` とする。
- `gh` を使うときは常に `GH_CONFIG_DIR="$HOME/.config/gh-4codex"` を指定する。
- Git の `origin` は `github.com-kappaseijin4codex` SSH alias を使う。
- 既定の `kappaseijin` へフォールバックしない。
- 対向 LLM は配置しない。別の reviewer account を導入する変更は別 Issue とする。

## 変更範囲

- `docs/PLAN.md` の現行パイロット運用へアカウント対応表と実行条件を追記する。
- 本計画書へ調査結果と採用方針を記録する。
- 製品コード、README、認証情報、外部サービス設定は変更しない。

## 検証

- `GH_CONFIG_DIR="$HOME/.config/gh-4codex" gh auth status`
- `git remote get-url origin`
- `git config --get user.name`
- `git diff --check`
- `python3 scripts/check-doc-refs.py`
- `python3 scripts/check-ac-ledger.py`

## 完了条件

- [ ] Issue #20 の目的だけを含む一つの PR を作成する。
- [ ] CI と資料検査が成功する。
- [ ] PR を `kappaseijin4codex` で merge し、main を origin と同期する。
- [ ] Issue #20 を完了条件に従って close する。
