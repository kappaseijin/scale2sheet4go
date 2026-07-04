---
type: TestDesign
title: scale2sheet — 内部テスト設計
description: scale2sheet のユニットテスト構成とモジュール別検証方針を定義する。
tags:
  - test
  - unit
  - integration
  - scale2sheet
timestamp: "2026-07-04T18:00:00+09:00"
---

# scale2sheet — 内部テスト設計

## テスト構成

```text
test/
├── apple-health/
│   └── parser.test.ts
├── cli/
│   └── index.test.ts
├── config/
│   └── settings.test.ts
├── domain/
│   └── measurement.test.ts
├── scale-exporter/
│   └── reader.test.ts
├── service/
│   └── measurements.test.ts
└── sheets/
    └── adapter.test.ts
```

実行: `npm test`（vitest run）。`vitest.config.ts` でプロジェクトの `test/` 配下のみを対象にしている。

## domain（`test/domain/measurement.test.ts`）

| ケース | 期待 |
| --- | --- |
| 期間ラベルの正規化 | `morning` → `朝`、`evening` → `夜` |
| kindごとの最新値選択 | `latestByKind` が各kindで`measuredAt`最大のreadingを返す |
| 期間別の体重選択 | 朝は最も早い体重、夜は最も遅い体重 |
| 体重アンカーによる周辺選択 | `selectReadingsByWeightAnchor` が体重時刻に最も近い他kindを選ぶ |

## config（`test/config/settings.test.ts`）

| ケース | 期待 |
| --- | --- |
| settings.json自動生成 | 未存在時に既定値で生成される |
| settings値の読込・`~`展開 | 設定値とパスが期待通りに反映される |
| 環境変数によるsettings上書き | 空文字は未設定扱いとして無視され、非空の環境変数が優先される |
| 不正JSONで`ConfigError` | settings.jsonのJSON構文エラーを検出する |
| google-fit-credentials.jsonへのフォールバック | 環境変数未設定時にクレデンシャルファイルから読む |
| 環境変数優先 | 環境変数がクレデンシャルファイルより優先される |
| Google Fitトークンパスの`~`展開 | 展開されたパスが返る |
| `settingsPath: null`でsettings層を無効化 | テスト時に環境変数のみで動作する |

## sources/scale-exporter（`test/scale-exporter/reader.test.ts`）

| ケース | 期待 |
| --- | --- |
| 連番ファイルの読込・フィールドマッピング | 両ソース（apple-health/google-fit）の連番ファイルを読み、exporter kindからdomain kindへ正しく変換する |
| 対象日以外のファイルを無視 | ファイル名の日付が対象日と一致しないものは除外 |
| ファイル境界の重複除去 | `(measuredAt,kind,value,source)`完全一致の重複を1件にまとめる |
| ディレクトリ不存在時は空配列 | `ENOENT`をcatchして空配列を返す |
| 不正JSON行でエラー | ファイル名・行番号つきで`ScaleExporterFileError`をthrow |
| スキーマ違反行でエラー | 同上 |
| サブディレクトリ・無関係ファイルの無視 | ファイル名パターンに一致しないものは読まない |

## service（`test/service/measurements.test.ts`）

| ケース | 期待 |
| --- | --- |
| タイムゾーンでの朝/夜判定 | `determineMeasurementPeriod` が設定タイムゾーンの時刻で判定する |
| 対象日・期間ウィンドウでのフィルタ | `filterReadingsByPeriodWindow` が朝(05:00-12:00)/夜(20:00-23:30)のみ通す |
| 最新値セット・Spreadsheet行の構築 | `buildLatestMeasurementSet`/`toSpreadsheetRow` が期待形式を返す |
| 夜の最新体重選択 | 夜は最も遅い体重が選ばれる |
| 体重がない場合は値が空 | `hasAnyMeasurementValue`が`false`になり、他項目もセットされない |
| 体重時刻に最も近い他項目の選択 | `selectClosestToReference`相当の挙動を統合レベルで確認 |
| Apple Health読込での日付・期間適用 | Apple Healthソースでも同じウィンドウ・アンカーロジックが適用される |
| 体重なしの期間は同期しない | `syncMeasurements`が`undefined`を返し、Sheets APIを呼ばない |

## sheets（`test/sheets/adapter.test.ts`）

| ケース | 期待 |
| --- | --- |
| 日本語朝/夜ヘッダからのマッピング構築 | `buildSheetColumnMapping`が朝/夜×5項目の列indexを正しく構築する |
| 括弧付き血圧ヘッダからのマッピング | `血圧(上)`/`血圧(下)`表記も認識する |
| 対応日付形式からの当日行検索 | `YYYY-MM-DD`/`YYYY/MM/DD`/`M/D`/`M月D日`いずれからも当日行を見つける |
| 定義済み値のみのbatchUpdateデータ構築 | 未定義値・対応列なしの項目はskipされる |
| 0始まり列indexのA1変換 | `columnIndexToA1`が期待する列名を返す |

## apple-health（`test/apple-health/parser.test.ts`）

| ケース | 期待 |
| --- | --- |
| export.xmlからの全測定値抽出（タイムスタンプ付き） | サポート対象の測定値がすべて抽出される |
| export.xmlからの最新測定値抽出 | 各kindの最新値のみが抽出される |

## cli（`test/cli/index.test.ts`）

| ケース | 期待 |
| --- | --- |
| 正しい`YYYY-MM-DD`日付オプションの受理 | `parseDateOption`が値を返す |
| 不正な日付オプションの拒否 | `InvalidArgumentError`をthrow |
| 設定タイムゾーンでの対象日終端時刻の使用 | `referenceTimeForDate`が指定日の`endOf("day")`をタイムゾーンで解決する |

## 受け入れテストとの対応

| AT | 主な内部テスト |
| --- | --- |
| AT-01〜AT-06 | 手動受け入れ（実 scale_exporter出力・実Google Fit OAuth・実Sheets書き込みが必要なため自動化対象外） |
| AT-07 | `service/measurements.test.ts`（体重なしの期間は同期しない） |
| AT-08 | `service/measurements.test.ts`（体重がない場合は値が空） |
| AT-09 | `scale-exporter/reader.test.ts`（ディレクトリ不存在時は空配列） |
| AT-10 | `scale-exporter/reader.test.ts`（不正JSON行/スキーマ違反行でエラー） |
| AT-11 | `scale-exporter/reader.test.ts`（ファイル境界の重複除去） |
| AT-12 | `cli/index.test.ts`（不正な日付オプションの拒否と同様の引数検証。`--period`自体の自動テストは未整備、[ACCEPTANCE_TEST_REPORT.md](./ACCEPTANCE_TEST_REPORT.md)参照） |
| AT-13 | `sheets/adapter.test.ts`（対応日付形式からの当日行検索：該当なしケース） |
| AT-14〜AT-16 | `config/settings.test.ts` |
| AT-17 | `domain/measurement.test.ts`, `service/measurements.test.ts`（mixed判定） |
| AT-18 | `sheets/adapter.test.ts`（括弧付き血圧ヘッダからのマッピング） |

## CI / ローカル検証

```sh
npm test -- --run
npm run typecheck
npm run build
```

Google Sheets/Google Fitの実APIを使う検証はローカル手動受け入れに分離する（CIでは実施しない）。
