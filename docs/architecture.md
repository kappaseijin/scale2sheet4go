# scale2sheet Architecture

## 目的

scale2sheet は、朝・夜の身体測定値を Google Fit REST API または Apple Health XML エクスポートから取得し、Google Spreadsheet の既存当日行へ転記する TypeScript サービスである。Node.js 上で完結し、OS 固有 API、ネイティブバインディング、LLM、外部推論サービスは使わない。

## 対象データ

最新値として扱う項目は次の通り。

| 項目 | 単位 | 備考 |
| --- | --- | --- |
| 体重 | kg | Google Fit / Apple Health の体重レコード |
| 体温 | ℃ | Apple Health の body temperature、Google Fit は利用可能な場合のみ |
| 血圧上 | mmHg | 収縮期 |
| 血圧下 | mmHg | 拡張期 |
| 脈拍 | bpm | heart rate |

Spreadsheet は `月日` 列で当日行を検索し、朝または夜の測定列だけを更新する。

```text
月日 | 朝体重 | 朝体温 | 朝血圧上 | 朝血圧下 | 朝脈拍 | 夜体重 | 夜体温 | 夜血圧上 | 夜血圧下 | 夜脈拍
```

## ディレクトリ構成案

```text
scale2sheet/
  docs/
    architecture.md
  src/
    cli/                  # 手動実行コマンド
    config/               # 環境変数と設定検証
    domain/               # 測定値、行データ、共通型
    scheduler/            # 朝・夜 cron と常駐制御
    service/              # ユースケース orchestration
    sheets/               # Google Sheets 書き込み adapter
    sources/
      apple-health/       # Apple Health XML parser
      google-fit/         # Google Fit REST client
    shared/               # logger、date/time、errors
    index.ts              # package entry point
  package.json
  tsconfig.json
```

## モジュール設計

依存方向は `cli/scheduler -> service -> sources/sheets/domain` とし、`domain` は外部パッケージへ依存させない。

- `domain`
  - 測定値、単位、ソース、Spreadsheet 行の型を定義する。
  - Google Fit と Apple Health の差分を吸収する正規化後モデルを持つ。
- `sources/google-fit`
  - OAuth 認可済みクライアントを使って Google Fit REST API から期間内の data point を取得する。
  - Google Fit 固有の data type name を domain model へ変換する。
- `sources/apple-health`
  - Apple Health の `export.xml` を streaming parser で読み、必要な Record だけを抽出する。
  - 大きい XML を全量オブジェクト化しない。
- `sheets`
  - Google Sheets API の batchUpdate で既存行の対象セルだけを更新する。
  - `月日` 列で当日行を検索し、行の自動作成はしない。
  - Spreadsheet ID、sheet name、認証情報は `config` から受け取る。
- `service`
  - 朝・夜の対象時間帯を決め、各 source から最新値を集約し、Spreadsheet row を組み立てる。
  - 朝は `05:00` から `12:00`、夜は `20:00` から `23:30` の測定値だけを採用する。
  - source が混在した場合は `sources` の内訳を保持し、行の `ソース` は `mixed` とする。
- `scheduler`
  - `node-cron` で朝・夜の実行時刻を登録する。
  - 常駐モードでは signal を受けて graceful shutdown する。
- `cli`
  - `run --period morning|evening` の手動実行を提供する。
  - `serve` で常駐 cron を開始する。

## 使用パッケージ

2026-06-18 時点の npm 公開版を確認したうえで、初期 package.json には caret range で指定する。

| package | 用途 | 選定理由 |
| --- | --- | --- |
| `googleapis` | Google Fit / Google Sheets API | Google 公式 API client。Fitness と Sheets の両方を 1 つの client で扱える。 |
| `saxes` | Apple Health XML parser | Streaming XML parser。大きな `export.xml` を全量展開せず処理でき、ネイティブ依存がない。 |
| `node-cron` | 朝・夜 cron | Node.js のみで常駐スケジュールを組める。OS cron に依存しない。 |
| `zod` | 設定・入力値検証 | 環境変数や外部データの runtime validation を型に寄せられる。 |
| `commander` | CLI | 手動実行と常駐起動の subcommand を明示しやすい。 |
| `dotenv` | ローカル設定読込 | `.env` による手元実行を簡潔にする。 |
| `luxon` | 日付・時刻処理 | timezone を明示して朝・夜区分と Spreadsheet 表示値を作れる。 |
| `pino` | logging | 常駐サービス向けの構造化ログ。高速でネイティブ依存がない。 |
| `typescript` | build | strict TypeScript の基盤。 |
| `tsx` | dev 実行 | TypeScript の手動実行を軽く保つ。 |
| `vitest` | test | TypeScript と相性が良く、domain/service の単体テストを素早く回せる。 |

## データモデル

型定義は `src/domain/measurement.ts` に置く。中心となるモデルは次の通り。

- `MeasurementReading`
  - source から取得した単一測定値。
  - `kind`, `value`, `unit`, `measuredAt`, `source` を必須にする。
- `LatestMeasurementSet`
  - Spreadsheet 1 行に対応する正規化済み最新値セット。
  - 欠測を許容するため、数値項目は optional にする。
- `SpreadsheetRow`
  - append 直前の表示用モデル。
  - 列順は Ph.1 指定の行形式に固定する。
- `MeasurementSource`
  - `google_fit`, `apple_health_export`, `mixed`。

## 実行モード

- 手動実行
  - `scale2sheet run --period morning`
  - `scale2sheet run --period evening`
- 常駐実行
  - `scale2sheet serve`
  - `MORNING_CRON` と `EVENING_CRON` で実行タイミングを指定する。

## 設定項目案

```text
TIME_ZONE=Asia/Tokyo
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
GOOGLE_SHEET_ID=163Lc0YeN5ZnGeXdYqx6T_JGSMa91kpvfpoODjF7q8C0
GOOGLE_SHEET_NAME=体温・血圧
APPLE_HEALTH_EXPORT_XML=/path/to/export.xml
MORNING_CRON=0 7 * * *
EVENING_CRON=0 21 * * *
```

OAuth の扱いは Ph.2 で確定する。Google Fit は個人 health data のため、service account ではなく installed app OAuth が必要になる可能性が高い。一方で Google Sheets 書き込みは service account でも運用できる。この差を吸収できるよう、Google 認証は `sources/google-fit` と `sheets` で別設定に分けられる構造にする。

## Ph.2 実装方針

1. `config` に zod schema を追加する。
2. `sources/apple-health` で XML から対象 Record を抽出する。
3. `sources/google-fit` で Fitness API から対象 data type を取得する。
4. `service` で最新値選択と朝・夜区分の行生成を実装する。
5. `sheets` で append を実装する。
6. `cli` と `scheduler` を接続する。
7. domain と source parser からテストを追加する。
