---
type: TestDesign
title: scale2sheet — 内部テスト設計
description: Go パッケージの責務別テストと受け入れ試験への対応を定義する。
tags:
  - test
  - unit
  - integration
  - scale2sheet
timestamp: "2026-07-29T09:05:20+09:00"
---

# scale2sheet — 内部テスト設計

## テスト構成

| パッケージ | 検証対象 |
| --- | --- |
| `internal/config` | settings.json、環境変数優先、既定値、パス展開、source 別設定 |
| `internal/auth` | Sheets / Google Fit 認証設定、OAuth token の保存権限 |
| `internal/domain` | 測定値、期間、kind、最新値選択 |
| `internal/sources/scaleexporter` | JSONL の安定入力、ファイル分類、異常診断 |
| `internal/sources/applehealth` | Apple Health XML の正規化 |
| `internal/sources/googlefit` | Fitness API の data source、dataset pagination、任意データ型 |
| `internal/service` | 朝夜 window、重複排除、体重アンカー、転記値集合 |
| `internal/sheets` | 見出し、日付行、A1、batch update、UTF-8、期限 |
| `internal/pipeline` | snapshot、status schema、health、terminal outcome、通知 |
| `internal/scheduler` | Darwin lease、receipt、停止要求、cron 判定 |
| `internal/installation` | path guard、manifest、plist、dry-run、操作計画 |
| `internal/cli` | 引数解析、設定 wiring、終了コード、各 command |

## テスト規則

- 純粋ロジックは table-driven test とし、タイムゾーン境界、空値、重複、壊れた入力を含める。
- 外部 API は `httptest` または transport 差し替えで成功・期限超過・HTTP エラーを再現する。
- filesystem、HOME、lease、launchd は一時ディレクトリまたは fake を使い、実ユーザー領域を変更しない。
- 正常系だけでなく、fixture を壊す負の制御が意図した診断で失敗することを確認する。
- acceptance は focused package test の代用にせず、コンパイル済み Go バイナリを起動する。

## 主要ケース

| ケース | 期待 |
| --- | --- |
| 朝夜 window の境界 | 05:00/12:00、20:00/23:30 の包含規則が一定 |
| 体重なし | 他の測定値があっても Sheets 更新を行わず no-data |
| 重複入力 | 同一測定を一件へ縮約し、source 跨ぎ重複も定義どおり扱う |
| 不安定 snapshot | size/mtime/inode が安定するまで再読込し、上限超過は入力失敗 |
| Sheets blackhole | 共有 deadline で停止し、転記済みと誤記録しない |
| lease 競合 | 2 個目は無変更で失敗し、異常終了後は再取得できる |
| install rejection | 設定・認証・lease の検査失敗時にバイナリ/plistを変更しない |
| status schema | 壊れた JSON や counter を fail closed とし、atomic rename を使う |
| OAuth callback | state、code、error、PKCE を検証し、token を mode `0600` で保存 |

## 実行コマンド

```sh
GOTOOLCHAIN=local CGO_ENABLED=0 go test ./...
GOTOOLCHAIN=local go vet ./...
node scripts/verify-readme-config-keys.mjs
python3 scripts/check-doc-refs.py
```

受け入れ試験の一括実行は [EXTERNAL_TEST_DESIGN.md](./EXTERNAL_TEST_DESIGN.md) と [ACCEPTANCE_TEST_REPORT.md](./ACCEPTANCE_TEST_REPORT.md) を参照する。
