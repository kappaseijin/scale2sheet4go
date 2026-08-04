---
type: TestDesign
title: scale2sheet — 外部テスト設計
description: scale2sheet の受け入れテスト AT-01〜AT-18（PLAN.mdで一覧化）を具体化する。
tags:
  - test
  - acceptance
  - external
  - scale2sheet
timestamp: "2026-07-04T18:00:00+09:00"
---

# scale2sheet — 外部テスト設計

対応する受け入れテスト一覧は [PLAN.md「受け入れテスト」](./PLAN.md#受け入れテスト) を参照。ID（AT-01〜AT-18）は同一の番号体系を使う。本書は各ケースを実行可能な形へ具体化する。

## 前提

- テストは vitest 上のユニット/統合テストと、実 Google API を使う手動受け入れテストの2系統に分かれる（詳細は「自動化方針」）。
- 自動化テストは `loadConfig(env, { settingsPath: null })` で `settings.json` 層を無効化し、環境変数と一時ディレクトリの fixture のみで実行する（`test/config/settings.test.ts` 等）。
- 手動受け入れテストは `~/.config/scale2sheet/` を実運用と分離するため、`HOME` をテスト用一時ディレクトリに差し替えて実行する。
- Google Sheets への書き込みを伴うケースは、検証用の使い捨てSpreadsheet（本番と別ID）を使う。

## 共通検証

Spreadsheet書き込みを伴うケースでは以下を常に確認する。

- `batchUpdate` の対象範囲（range）が期待した列・行と一致する
- 値が期待した型（数値 or 空文字）で入っている
- 対象時間帯・体重アンカーの選定ロジックが仕様通り（[ARCHITECTURE_DESIGN.md](./ARCHITECTURE_DESIGN.md#実行フロー) 参照）
- stderr に不要なログが出ない
- 転記しない場合、対象セルが変化しない（`updateSpreadsheetMeasurements` が`false`を返し、書き込みAPIが呼ばれない）

## AT-01

| 項目 | 内容 |
| --- | --- |
| 目的 | scale_exporter出力からの朝の同期 |
| コマンド | `scale2sheet run --period morning` |
| 前提 | 解決済みの `scale-exporter-output-dir` に当日05:00-12:00の体重を含む出力ファイルあり |
| 期待 | Spreadsheet当日行の朝列が更新される。exit 0 |
| 検証 | 採用した体重の`measuredAt`が朝ウィンドウ内、他項目は体重時刻に最も近いもの |

## AT-02

| 項目 | 内容 |
| --- | --- |
| 目的 | scale_exporter出力からの夜の同期 |
| コマンド | `scale2sheet run --period evening` |
| 前提 | 当日20:00-23:30の体重を含む出力ファイルあり |
| 期待 | Spreadsheet当日行の夜列が更新される。exit 0 |
| 検証 | AT-01と同様、夜ウィンドウで評価 |

## AT-03

| 項目 | 内容 |
| --- | --- |
| 目的 | `--date`指定による過去日転記 |
| コマンド | `scale2sheet run --period morning --date 2026-06-27` |
| 前提 | 指定日のscale_exporter出力ファイルあり |
| 期待 | 指定日を対象日として転記される。exit 0 |
| 検証 | `referenceTimeForDate`が指定日の`endOf("day")`を使い、対象ファイル名の日付と一致 |

## AT-04

| 項目 | 内容 |
| --- | --- |
| 目的 | Google Fit直接取得（非推奨経路） |
| コマンド | `scale2sheet run --period morning --source google-fit` |
| 前提 | Google Fit OAuth認証済み（`scale2sheet auth`実行済み） |
| 期待 | Google Fit REST APIから直接取得して転記される。exit 0 |
| 検証 | `source == "google_fit"` |

## AT-05

| 項目 | 内容 |
| --- | --- |
| 目的 | 常駐実行（serve）の朝夜自動起動 |
| コマンド | `scale2sheet serve` |
| 前提 | `morning-cron` / `evening-cron` 設定済み |
| 期待 | 指定時刻に`syncMeasurements`が自動実行される |
| 検証 | ログに`Updated <period> row: ...`または`No <period> spreadsheet row updated.`が出る |

## AT-06

| 項目 | 内容 |
| --- | --- |
| 目的 | Google Fit初回OAuth認証 |
| コマンド | `scale2sheet auth` |
| 前提 | `google-fit-credentials.json`設定済み、トークン未取得 |
| 期待 | installed app OAuthフローが起動し、`google-fit-token.json`が生成される |
| 検証 | 生成されたトークンファイルで以降`run --source google-fit`が認証エラーにならない |

## AT-07

| 項目 | 内容 |
| --- | --- |
| 目的 | 対象時間帯（朝）に体重測定値がない場合、転記しない |
| コマンド | `scale2sheet run --period morning` |
| 前提 | 対象時間帯に体重測定値なし |
| 期待 | Spreadsheetは更新せず正常終了。exit 0 |
| 検証 | `syncMeasurements`が`undefined`を返す、Sheets APIが呼ばれない |

## AT-08

| 項目 | 内容 |
| --- | --- |
| 目的 | 対象時間帯（夜）に体重以外はあるが体重がない場合、転記しない |
| コマンド | `scale2sheet run --period evening` |
| 前提 | 対象時間帯に体温等はあるが体重測定値なし |
| 期待 | 転記しない（体重必須アンカーのため）。exit 0 |
| 検証 | `hasAnyMeasurementValue`が`false`、他項目もセットされない |

## AT-09

| 項目 | 内容 |
| --- | --- |
| 目的 | scale_exporter出力ディレクトリ・当日ファイル不存在 |
| コマンド | `scale2sheet run --period morning` |
| 前提 | 解決済みの `scale-exporter-output-dir` にディレクトリ・当日ファイルなし |
| 期待 | 空配列扱いで正常終了。exit 0 |
| 検証 | `readScaleExporterMeasurements`が空配列を返す（`ENOENT`をcatch） |

## AT-10

| 項目 | 内容 |
| --- | --- |
| 目的 | scale_exporter出力の不正行 |
| コマンド | `scale2sheet run --period morning` |
| 前提 | 対象ファイルに不正JSON行、またはスキーマ違反行を含む |
| 期待 | ファイル名・行番号つきエラーで失敗（黙って捨てない）。exit非0 |
| 検証 | `ScaleExporterFileError`のメッセージにファイル名・行番号が含まれる |

## AT-10a

| 項目 | 内容 |
| --- | --- |
| 目的 | scale_exporter出力の不正行をファイル単位でスキップする |
| コマンド | `scale2sheet pipeline --period morning` |
| 前提 | 正常なJSONLファイルと、不正JSON行またはスキーマ違反行を含むファイルが混在する |
| 期待 | 不正ファイルだけを除外し、正常ファイルを処理する。除外ファイル名・最初の失敗行番号・除外行数をlogとstatusに記録し、全ファイル不正時は転記しない |
| 検証 | AC-39〜AC-42をfixtureで検証する。三つの件数の重複単位はIssue #63の決定後に確定する |

## AT-11

| 項目 | 内容 |
| --- | --- |
| 目的 | 連番ファイル境界での重複除去 |
| コマンド | `scale2sheet run --period morning` |
| 前提 | `_001.jsonl` / `_002.jsonl` に同一測定値（`measuredAt`,`kind`,`value`,`source`完全一致）が重複して存在 |
| 期待 | 重複が1件として扱われる |
| 検証 | 読込結果の件数が重複排除後の件数と一致 |

## AT-12

| 項目 | 内容 |
| --- | --- |
| 目的 | 不正な`--period`引数 |
| コマンド | `scale2sheet run --period invalid` |
| 期待 | 引数エラー、exit code非ゼロ |
| 検証 | Sheets APIが呼ばれない |

## AT-13

| 項目 | 内容 |
| --- | --- |
| 目的 | Spreadsheetに当日行がない |
| コマンド | `scale2sheet run --period morning` |
| 前提 | `月日`列に当日の行が存在しない |
| 期待 | エラーログ出力、書き込みなし、`false`を返す |
| 検証 | `findTodayRowNumber`が`undefined`を返す |

## AT-14〜AT-16（設定ファイル）

| ID | 前提 | 期待 |
| --- | --- | --- |
| AT-14 | `~/.config/scale2sheet/settings.json` 未存在 | 既定値で自動生成され、その値で実行される |
| AT-15 | `settings.json` に `source: "google-fit"` 設定済み | `--source` 省略時は settings.json の値が既定になる |
| AT-16 | 環境変数 `GOOGLE_SHEET_ID` と `settings.json` の `sheet-id` が両方設定済み | 環境変数が優先される |

## AT-17

| 項目 | 内容 |
| --- | --- |
| 目的 | 複数ソースが混在した場合の内部モデル |
| 前提 | 同一period内で体重がscale_exporter経由、体温がGoogle Fit経由など、`sourcesByKind`に複数sourceが記録される状況（ユニットテストで再現） |
| 期待 | `LatestMeasurementSet.source`が`mixed`になる |
| 検証 | Spreadsheetへは列として書き込まれないこと（`buildMeasurementUpdateData`の出力に`source`関連rangeが含まれない）も併せて確認する |

## AT-18

| 項目 | 内容 |
| --- | --- |
| 目的 | 血圧列の表記ゆれ認識 |
| 前提 | ヘッダに `血圧(上)` / `血圧(下)` 形式の列がある |
| 期待 | `血圧上` / `血圧下` と同様に列として認識される |
| 検証 | `buildSheetColumnMapping`の`periods.morning/evening`に該当フィールドが含まれる |

## 自動化方針

| 区分 | 対象 |
| --- | --- |
| 完全自動（vitest） | AT-07〜AT-11、AT-14〜AT-18（`test/`配下で再現可能。詳細は[INTERNAL_TEST_DESIGN.md](./INTERNAL_TEST_DESIGN.md#受け入れテストとの対応)） |
| 一部自動（要追加） | AT-12（`--period`が不正な値であること自体のCLIバリデーションは、`test/cli/index.test.ts`では`--date`のみ検証しており未整備）、AT-13（`findTodayRowNumber`の「該当行なし→`undefined`」ケースが未テスト）。いずれも[ACCEPTANCE_TEST_REPORT.md](./ACCEPTANCE_TEST_REPORT.md)でPARTIAL扱い |
| 手動受け入れ（実API） | AT-01〜AT-06（実 scale_exporter 出力ファイル、実 Google Fit OAuth、実 Google Sheets 書き込みを要する） |

自動化テストは `sources`/`sheets`層をfixture・in-memoryデータに差し替えて再現する（`googleapis`の実APIコールは行わない）。手動受け入れテストは検証用Spreadsheetと実データで実施し、結果は[ACCEPTANCE_TEST_REPORT.md](./ACCEPTANCE_TEST_REPORT.md)に記録する。

### 自動実行

```sh
npm test -- --run
npm run typecheck
```
