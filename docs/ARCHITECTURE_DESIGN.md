---
type: Design
title: scale2sheet — アーキテクチャ設計
description: scale2sheet のコンポーネント構成、依存関係、技術選定、リスクを定義する。
tags:
  - design
  - architecture
  - scale2sheet
timestamp: "2026-07-04T18:00:00+09:00"
---

# scale2sheet — アーキテクチャ設計

## 目的

朝・夜の身体測定値（体重・体温・血圧上/下・脈拍）を、[scale_exporter](https://github.com/kappaseijin/scale_exporter) が出力した JSONL（既定・推奨）、Google Fit REST API、または Apple Health XML エクスポートから取得し、Google Spreadsheet の当日行へ転記する。ソースコードは Node.js（>= 22）互換の TypeScript を維持し、配布・運用は Bun コンパイル済み単体バイナリ `scale2sheet` を優先する。OS 固有 API・ネイティブバインディング・LLM・外部推論サービスは使わない。

## 重要な外部制約

- Google Fit REST API は 2026 年末で終了予定。`google-fit` ソースは非推奨として残すが、標準の入力は `scale-exporter`（ファイル入力）に切り替え済み。
- 配布・運用の正式経路は `bun build --compile` で生成する `scale2sheet` バイナリとする。Node.js での `npm run build && node dist/index.js` は開発・デバッグ用の補助経路として残す。
- Google Sheets への書き込みは既存行の更新のみ。`月日` 列で当日行を検索し、行の自動作成はしない。
- 標準の入力は `scale_exporter`（別リポジトリ、Swift/HealthKit）が出力した JSONL（`--source scale-exporter`、既定）。`--source apple-health` による Apple Health `export.xml` の直接読み込みも互換・補助経路として引き続き提供する。

## 技術選定

| package | 用途 | 選定理由 |
| --- | --- | --- |
| `googleapis` | Google Fit / Google Sheets API | Google 公式 API client。Fitness と Sheets を1つのclientで扱える |
| `saxes` | Apple Health XML parser | streaming parserで大きな`export.xml`を全量展開せず処理でき、ネイティブ依存がない |
| `node-cron` | 朝・夜 cron（`serve`常駐時） | Node.jsのみで常駐スケジュールを組める |
| `zod` | 設定・入力値検証 | 環境変数・settings.json・scale_exporter出力行のruntime validationを型に寄せられる |
| `commander` | CLI | `run` / `serve` / `auth` サブコマンドを明示しやすい |
| `dotenv` | ローカル設定読込 | `.env` による上書きを簡潔にする |
| `luxon` | 日付・時刻処理 | timezoneを明示して朝・夜区分とSpreadsheet表示値を作る |
| `pino` | logging | 常駐サービス向けの構造化ログ |
| `typescript` / `tsx` / `vitest` | ビルド・開発実行・テスト | strict TypeScriptとTypeScriptネイティブなテスト実行 |

## パッケージ構成（ディレクトリ）

```text
scale2sheet/
  src/
    auth/                  # Google Fit OAuth・Google Sheets 認証
    cli/                   # run / serve / auth サブコマンド
    config/                # 環境変数・settings.json の読込・検証
    domain/                # 測定値・行データ・共通型、選択ロジック
    scheduler/             # node-cron による朝・夜常駐実行
    service/               # ユースケース orchestration（取得→選択→書込）
    sheets/                # Google Sheets 書き込み adapter
    sources/
      apple-health/        # Apple Health export.xml parser
      google-fit/          # Google Fit REST client（非推奨）
      scale-exporter/       # scale_exporter 出力 JSONL reader（既定）
    index.ts               # package entry point
  test/                    # src/ 各モジュールに対応するユニットテスト
  docs/
    PLAN.md
    ARCHITECTURE_DESIGN.md
    EXTERNAL_DESIGN.md
    INTERNAL_DESIGN.md
    EXTERNAL_TEST_DESIGN.md
    INTERNAL_TEST_DESIGN.md
    ACCEPTANCE_TEST_REPORT.md
    decisions/
  README.md
```

依存方向は `cli/scheduler → service → sources/sheets/domain` とし、`domain` は外部パッケージへ依存しない。

## ターゲット責務

- `domain` — 測定値・単位・ソース・Spreadsheet行の型、および朝/夜の体重アンカー選択ロジックを持つ。Google Fit / Apple Health / scale_exporter の差分を吸収する正規化後モデル。
- `sources/scale-exporter`（既定） — scale_exporterが出力した当日分のJSONLファイル群を読み、domain modelへ変換する。連番ファイル境界の重複除去を行う。
- `sources/google-fit`（非推奨） — OAuth認可済みクライアントでGoogle Fit REST APIから期間内のdata pointを取得する。
- `sources/apple-health` — `export.xml`をstreaming parserで読み、必要なRecordだけを抽出する。
- `sheets` — Google Sheets APIのbatchUpdateで既存行の対象セルだけを更新する。行の自動作成はしない。
- `service` — 朝・夜の対象時間帯を決め、各sourceから最新値を集約し、Spreadsheet rowを組み立てる。体重を必須アンカーとする。
- `scheduler` — `node-cron`で朝・夜の実行時刻を登録する常駐モード。signalを受けてgraceful shutdownする。
- `cli` — `run --period morning|evening`（手動実行）、`serve`（常駐)、`auth`（Google Fit OAuth初回認証）を提供する。

## 実行フロー

```
[cli: run/serve] → [service.syncMeasurements]
  → [sources.readLatestMeasurementsForSource]（scale-exporter | google-fit | apple-health）
  → [domain.filterReadingsByPeriodWindow]（朝 05:00-12:00 / 夜 20:00-23:30）
  → [domain.selectReadingsByWeightAnchor]（体重必須、他項目は体重測定時刻に最も近いものを採用）
  → [domain.toSpreadsheetRow]
  → [sheets.updateSpreadsheetMeasurements]（月日列で当日行検索→batchUpdate）
```

体重測定値が対象時間帯に存在しない場合、Spreadsheetは更新せず正常終了する（他項目のみの存在では転記しない）。

## データモデル境界

- `MeasurementReading` — sourceから取得した単一測定値（`kind`, `value`, `unit`, `measuredAt`, `source`）。
- `LatestMeasurementSet` — 1回の同期処理で採用された、朝/夜1行分の正規化済み最新値セット。欠測項目はoptional。
- `SpreadsheetRow` — Spreadsheetへの書き込み直前の表示用モデル。
- `MeasurementSource` — `google_fit` / `apple_health_export` / `mixed`。複数sourceが混在した場合は`mixed`。

## 設定ファイル方針

設定・認証ファイルの構造は scale_exporter と同じ `~/.config/scale2sheet/` を標準とする（2026-07-02、PR #2 で統一）。優先順位: 環境変数（`.env`含む）> `settings.json` > 組み込み既定値。詳細は [EXTERNAL_DESIGN.md](./EXTERNAL_DESIGN.md#設定ファイル) を参照。

## セキュリティとプライバシー

- Google Fit の `client_id` / `client_secret` / token は `~/.config/scale2sheet/google-fit-credentials.json` / `google-fit-token.json` に保存する（scale_exporterと同形式）。
- Google Sheets のサービスアカウント鍵は `~/.config/scale2sheet/google-sheets-service-account.json`。
- `settings.json` には秘密情報を保存しない。
- リポジトリにはドットファイル・`*.bak` を含めない（`.gitignore`で除外済み）。

## 主要リスク

| ID | リスク | 影響 | 対策 |
| --- | --- | --- | --- |
| R-01 | Google Fit REST API の2026年末終了 | `google-fit` ソースが使用不能になる | `scale-exporter` ソースを既定・標準経路とし、`google-fit`は互換ソースとして残す |
| R-02 | scale_exporter側の連番ファイル境界での重複 | 同一測定値が複数ファイルに跨って現れる | `(measuredAt, kind, value, source)` 完全一致で重複除去する |
| R-03 | Spreadsheetのヘッダ列変更 | 列マッピングが崩れ、誤った列へ書き込む | ヘッダを都度読み取ってマッピングを構築し、`月日`列欠如時はエラーにする |
| R-04 | scale_exporter出力の不正行 | 誤ったデータをそのまま転記してしまう | zodスキーマ検証を行い、不正行はファイル名・行番号つきエラーで失敗させる（黙って捨てない） |

## 設計判断

- 体重を必須アンカーとし、朝は最も早い体重、夜は最も遅い体重を採用する。体重がない場合はSpreadsheetへ転記しない。
- 体温・血圧上・血圧下・脈拍は、採用した体重の測定時刻に最も近い同種別レコードを採用する。
- source混在時は内部モデル（`LatestMeasurementSet.source`）を`mixed`とし、`sourcesByKind`で内訳を保持する。この値はSpreadsheetの列としては書き込まれない（batchUpdate対象は測定5項目のみ）。
- Google Fit直接取得は非推奨ソースとして維持しつつ、`scale-exporter`ファイル入力を主戦略とする。
