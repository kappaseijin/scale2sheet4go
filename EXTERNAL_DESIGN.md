---
type: Design
title: scale2sheet — 外部設計
description: scale2sheet の CLI、設定ファイル、入出力、エラー仕様を定義する。
tags:
  - design
  - external
  - cli
  - scale2sheet
timestamp: "2026-07-04T18:00:00+09:00"
---

# scale2sheet — 外部設計

## CLI

```text
scale2sheet run --period <morning|evening> [--source <source>] [--date <YYYY-MM-DD>]
scale2sheet serve [--source <source>]
scale2sheet auth
```

## オプション

| オプション | サブコマンド | 必須 | 説明 |
| --- | --- | --- | --- |
| `--period <morning\|evening>` | `run` | 必須 | 対象期間 |
| `--source <scale-exporter\|google-fit\|apple-health>` | `run`, `serve` | 任意 | 省略時は `settings.json` の `source`（既定 `scale-exporter`） |
| `--date <YYYY-MM-DD>` | `run` | 任意 | 過去日転記用。省略時は当日（`TIME_ZONE`基準） |

`auth` は Google Fit の installed app OAuth フローを実行し、トークンを保存する。

## 設定ファイル

### パス

`~/.config/scale2sheet/settings.json`（非シークレット・初回実行時に自動生成）

### 自動生成内容

```json
{
  "time-zone": "Asia/Tokyo",
  "source": "scale-exporter",
  "sheet-name": "体温・血圧",
  "sheets-credentials": "~/.config/scale2sheet/google-sheets-service-account.json",
  "scale-exporter-output-dir": "~/Documents/scale_exporter",
  "google-fit-token-path": "~/.config/scale2sheet/google-fit-token.json",
  "morning-cron": "0 7 * * *",
  "evening-cron": "0 21 * * *"
}
```

### スキーマ（キーは scale_exporter と同じ kebab-case）

| キー | 型 | 説明 |
| --- | --- | --- |
| `time-zone` | string | IANA timezone |
| `source` | `scale-exporter` \| `google-fit` \| `apple-health` | `--source` 省略時の既定値 |
| `sheet-id` | string | Spreadsheet ID |
| `sheet-name` | string | シート名 |
| `sheets-credentials` | string(path) | Google Sheetsサービスアカウント鍵のパス |
| `scale-exporter-output-dir` | string(path) | scale_exporter出力ディレクトリ |
| `apple-health-export-xml` | string(path) | Apple Health `export.xml` のパス |
| `google-fit-token-path` | string(path) | Google Fitトークン保存先 |
| `google-fit-lookback-days` | number | Google Fit直接取得時の遡及日数 |
| `morning-cron` / `evening-cron` | string(cron式) | `serve`時の実行時刻 |

パス値の先頭`~`は展開する。

### 環境変数による上書き（`.env`含む）

優先順位: 環境変数 > `settings.json` > 組み込み既定値。変数名は `.env.example` を参照（`TIME_ZONE`, `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_NAME`, `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_FIT_CLIENT_ID`, `GOOGLE_FIT_CLIENT_SECRET`, `GOOGLE_FIT_REDIRECT_URI`, `GOOGLE_FIT_TOKEN_PATH`, `GOOGLE_FIT_LOOKBACK_DAYS`, `APPLE_HEALTH_EXPORT_XML`, `SCALE_EXPORTER_OUTPUT_DIR`, `MORNING_CRON`, `EVENING_CRON`)。

## 認証・クレデンシャルファイル

| ファイル | 内容 | 生成方法 |
| --- | --- | --- |
| `~/.config/scale2sheet/google-sheets-service-account.json` | Google Sheets用サービスアカウント鍵 | 手動配置（`sheets-credentials`で場所変更可） |
| `~/.config/scale2sheet/google-fit-credentials.json` | `{"client_id","client_secret","redirect_uri"?}`（scale_exporterと同形式） | 手動配置 |
| `~/.config/scale2sheet/google-fit-token.json` | Google Fit OAuthトークン | `scale2sheet auth`で自動生成 |

## scale_exporter 入力仕様

### 読み込み先

`SCALE_EXPORTER_OUTPUT_DIR`（既定 `~/Documents/scale_exporter`）

### 対象ファイル

`scale_exporter_{YYYY-MM-DD}_{apple-health|google-fit}_{seq}.jsonl`。対象日は `--date`（または当日）を`TIME_ZONE`で解釈した日付。両ソース・全連番（`_001`以降すべて）を読む。

### 行形式

```json
{"measuredAt": "ISO8601", "kind": "weight|bodyTemperature|bloodPressureSystolic|bloodPressureDiastolic|heartRate", "value": number, "unit": "kg|celsius|mmHg|bpm", "source": "apple_health|google_fit"}
```

### 変換規則

| exporter kind | domain kind |
| --- | --- |
| `weight` | `weight` |
| `bodyTemperature` | `body_temperature` |
| `bloodPressureSystolic` | `blood_pressure_systolic` |
| `bloodPressureDiastolic` | `blood_pressure_diastolic` |
| `heartRate` | `pulse` |

`apple_health` → `apple_health_export`、`google_fit` → `google_fit`（domain source）。

## 日付・時間帯仕様

朝は `05:00`–`12:00`、夜は `20:00`–`23:30`（`TIME_ZONE`基準）。対象時間帯に測定値がない場合、Spreadsheetは更新せず正常終了する。

## Spreadsheet 書き込み仕様

- `月日`列で当日行を検索し、`朝*`または`夜*`列へ書き込む。行の自動作成はしない。
- 列: `月日 | 朝体重 | 朝体温 | 朝血圧上 | 朝血圧下 | 朝脈拍 | 夜体重 | 夜体温 | 夜血圧上 | 夜血圧下 | 夜脈拍`
- 血圧の列名は `血圧上`/`血圧下` と `血圧(上)`/`血圧(下)` の両表記を認識する。
- `月日`列の値は `YYYY-MM-DD` / `YYYY/MM/DD` / `M/D` / `M月D日` を認識する。

## 終了コード

| コード | 意味 |
| --- | --- |
| 0 | 正常終了（転記あり・なし双方を含む） |
| 非0 | 引数エラー、設定ファイル不正、認証情報不足、scale_exporter出力の不正行 |

## エラー出力

`ConfigError`（設定・認証不足）は `console.error` にメッセージのみ出力し、exit code 1 で終了する。それ以外の例外は再throwする。

## エラー一覧

| エラー | 発生条件 |
| --- | --- |
| `invalid settings file` | `settings.json` のJSON構文エラーまたはスキーマ違反 |
| `invalid credentials file` | クレデンシャルJSONの構文エラーまたはスキーマ違反 |
| `Google Fit requires client credentials` | Google Fitソース使用時にclient_id/secret未設定 |
| `Google Sheets requires credentials` | Sheets書き込み時に認証情報未設定 |
| `Apple Health requires apple-health-export-xml` | Apple Healthソース使用時にexport.xml未設定 |
| `Sheet header must contain a "月日" column` | シートヘッダに`月日`列がない |
| `invalid JSON in <file>:<line>` / `invalid reading in <file>:<line>` | scale_exporter出力行の不正 |

## 利用例

```sh
# scale_exporter出力から朝の値を転記
scale2sheet run --period morning

# 過去日を指定して手動転記
scale2sheet run --period evening --date 2026-06-27

# Google Fitから直接取得（非推奨）
scale2sheet run --period morning --source google-fit

# 常駐実行
scale2sheet serve

# Google Fit初回認証
scale2sheet auth
```
