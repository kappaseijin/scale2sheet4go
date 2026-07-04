---
type: Design
title: scale2sheet — 内部設計
description: scale2sheet のモジュール、型、関数のAPI定義をまとめる。
tags:
  - design
  - internal
  - api
  - scale2sheet
timestamp: "2026-07-04T18:00:00+09:00"
---

# scale2sheet — 内部設計

## domain（`src/domain/`）

### `MeasurementKind`

`"weight" | "body_temperature" | "blood_pressure_systolic" | "blood_pressure_diastolic" | "pulse"`

### `MeasurementUnit`

`"kg" | "celsius" | "mmHg" | "bpm"`

### `MeasurementSource`

`"google_fit" | "apple_health_export" | "mixed"`

### `MeasurementPeriod`

`"morning" | "evening"`。表示ラベルは `measurementPeriodLabels`（`morning: "朝"`, `evening: "夜"`）。

### `MeasurementReading`

単一測定値。`kind`, `value`, `unit`, `measuredAt`（ISO8601）, `source`（`mixed`を除く）, 任意の`sourceRecordId`。

### `LatestMeasurementSet`

1回の同期処理で採用された正規化済み最新値セット。`period`, `capturedAt`, `source`, 各項目（optional number）, `sourcesByKind`（kindごとの採用source）。

### `SpreadsheetRow`

書き込み直前の表示用モデル。`date`, `time`, `periodLabel`, 各測定値（`number | ""`）, `source`。

### 主要関数

- `latestByKind(readings)` — kindごとに`measuredAt`が最も新しいreadingを選ぶ`Map`を返す。
- `selectWeightByPeriod(readings, period)` — 朝は最も早い、夜は最も遅い体重readingを選ぶ。
- `selectReadingsByWeightAnchor(readings, period)` — 体重を選んだ上で、他kindは体重の`measuredAt`に最も近いものを選ぶ`Map`を返す。体重が選べない場合は空`Map`。

## config（`src/config/`）

### `settings.ts`

- `expandHomePath(value)` — 先頭`~`をホームディレクトリへ展開。
- `defaultSettingsPath` = `~/.config/scale2sheet/settings.json`。
- `SettingsFile`（zodスキーマ、kebab-caseキー、`.passthrough()`で未知キー許容）。
- `loadOrCreateSettings(settingsPath?)` — ファイル不存在なら`defaultSettingsContent`で自動生成して返す。存在すればパースし、不正なら`ConfigError`。
- `loadGoogleFitCredentials(configDir)` — `google-fit-credentials.json`（snake_caseキー）を読み、`{clientId, clientSecret, redirectUri?}`へ変換。ファイル不存在時は`undefined`。

### `env.ts`

- `envSchema`（zod） — 環境変数を検証・既定値補完。空文字は未設定扱い。
- `settingsAsEnvOverlay(settings)` — `settings.json`の値を環境変数名にマッピングした overlay object を作る（環境変数のほうが優先されるよう、環境変数を後からmergeする）。
- `AppConfig` — `timeZone`, `defaultSource`, `googleFit?`, `googleSheets?`, `appleHealth?`, `scaleExporter`, `scheduler`。
- `loadConfig(env?, options?)` — settings.json読込 → overlay構築 → 環境変数で上書き → zod parse → 各種`*Config`をoptionalに組み立てる。`options.settingsPath: null`でsettings層を無効化（テスト用）。
- `requireGoogleFitConfig` / `requireGoogleSheetsConfig` / `requireAppleHealthConfig` — 該当設定が無ければ`ConfigError`をthrow。

## sources（`src/sources/`）

### `types.ts`

- `MeasurementSourceOption` = `"scale-exporter" | "google-fit" | "apple-health"`。
- `MeasurementSourceReader` インターフェース — `source`, `readLatestMeasurements(referenceTime)`。
- `sourceOptionToMeasurementSource(source)` — `google-fit`/`apple-health`をdomainの`MeasurementSource`へ変換。

### `scale-exporter/reader.ts`

- `exporterKindToDomainKind` / `exporterSourceToDomainSource` — exporter側の命名からdomainへの変換テーブル。
- `readingLineSchema`（zod） — JSONL 1行の検証スキーマ。
- `fileNamePattern` — `scale_exporter_{date}_{apple-health|google-fit}_{seq}.jsonl`。
- `readScaleExporterMeasurements(config, referenceTime, timeZone)` — 対象日のファイル一覧を取得し、行ごとにparse、`(measuredAt,kind,value,source)`で重複除去して返す。ディレクトリ不存在（`ENOENT`）は空配列。
- `ScaleExporterFileError` — 不正JSON・スキーマ違反時、ファイル名と行番号を含めてthrowする。

### `google-fit/`, `apple-health/`

Google Fit REST client（`client.ts`）とApple Health XML parser（`parser.ts`）。非推奨経路のため詳細割愛（既存実装のまま）。

## service（`src/service/measurements.ts`）

- `collectLatestMeasurementSet(options)` — sourceから読込 → 期間ウィンドウでフィルタ → `buildLatestMeasurementSet`で体重アンカー選択・集約。
- `syncMeasurements(options)` — `collectLatestMeasurementSet`実行 → 体重値が無ければ何もせず`undefined`を返す → `SpreadsheetRow`へ変換 → `updateSpreadsheetMeasurements`呼び出し。
- `filterReadingsByPeriodWindow` / `isReadingInPeriodWindow` — `measurementPeriodWindowMinutes`（朝 05:00-12:00＝300-720分、夜 20:00-23:30＝1200-1410分）でフィルタ。
- `buildLatestMeasurementSet` — `selectReadingsByWeightAnchor`の結果からsource集合を作り、単一sourceなら採用、複数なら`mixed`。
- `determineMeasurementPeriod(referenceTime, timeZone)` — `--period`未指定時、12時を境に朝/夜を自動判定（`serve`では両cronで明示指定するため主にテスト・フォールバック用）。
- `toSpreadsheetRow` — `capturedAt`をtimeZoneへ変換し、`date`/`time`/`periodLabel`等を組み立てる。
- `readLatestMeasurementsForSource` — sourceに応じて`readScaleExporterMeasurements` / `readGoogleFitMeasurements` / `readAppleHealthMeasurements`を呼び分ける。

## sheets（`src/sheets/adapter.ts`）

- `buildSheetColumnMapping(headerRow)` — ヘッダ行から`月日`列インデックスと朝/夜×5項目の列インデックスを構築。`月日`列が無ければthrow。
- `detectMeasurementField(header)` — ヘッダ文字列から`weight`/`temperature`/`systolicBP`/`diastolicBP`/`heartRate`を判定（`血圧上`/`血圧(上)`等の表記ゆれに対応）。
- `findTodayRowNumber(dateColumnValues, targetDate)` / `doesSheetDateMatch` / `parseSheetDate` — `月日`列の値（`YYYY-MM-DD`, `YYYY/MM/DD`, `M/D`, `M月D日`）から当日行を特定。
- `buildMeasurementUpdateData` — `LatestMeasurementSet`とマッピングから`batchUpdate`用の`{range, values}[]`を構築。値未定義または対応列なしはskip。
- `columnIndexToA1(index)` — 0始まり列indexをA1記法の列名へ変換。
- `updateSpreadsheetMeasurements(options)` — ヘッダ取得→マッピング構築→`月日`列取得→当日行特定→更新データ構築→`batchUpdate`実行。当日行が無い、または対応する値が1つも無ければ書き込まず`false`を返す。

## scheduler（`src/scheduler/scheduler.ts`）

- `startScheduler({config, source, logger?})` — `node-cron`で`morning-cron`/`evening-cron`を登録し、各発火時に`syncMeasurements`を呼ぶ。エラーは`logger.error`でcatchし、プロセスを落とさない。

## cli（`src/cli/index.ts`）

- `runCli(argv?)` — commanderで`auth` / `run --period --source --date` / `serve --source`を定義。
- `parsePeriod` / `parseSource` / `parseDateOption` — 引数バリデーション（不正値は`InvalidArgumentError`）。
- `referenceTimeForDate(value, timeZone)` — `--date`指定時、その日の`endOf("day")`を`referenceTime`として使う（当日フィルタが日中どの時刻でも同じ日を拾えるようにするため）。
- `ConfigError`はcatchしてメッセージのみ出力・exit code 1、それ以外は再throw。

## エラー型

| 型 | 発生箇所 |
| --- | --- |
| `ConfigError`（`config/settings.ts`） | 設定・認証情報の不備 |
| `ScaleExporterFileError`（`sources/scale-exporter/reader.ts`） | scale_exporter出力行の不正 |
| （sheets側は`Error`をそのままthrow） | `月日`列欠如、列index範囲外 |

## 並行性

CLIの`run`は単発実行、`serve`は`node-cron`によるシングルプロセス内スケジューリングのみ。並行実行の排他制御は現状不要（1日2回、cron発火のたびに逐次awaitする設計）。

## テスト容易性

`test/`配下は`src/`の各モジュールに1:1対応（`domain`, `config`, `service`, `sheets`, `scale-exporter`, `apple-health`, `cli`）。`loadConfig`は`options.settingsPath: null`でsettings.json層を無効化でき、環境変数のみでのテストが可能。
