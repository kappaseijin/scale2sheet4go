---
type: TestReport
title: scale2sheet — Acceptance Test Report
description: 受け入れテスト実施結果（AT-01〜AT-18）
timestamp: "2026-07-04"
tags: [acceptance-test, scale2sheet]
---

# scale2sheet — Acceptance Test Report

- 実施日: 2026-07-04
- 対象実装コミット: `310bd4f0e182ef0603d2a9014fe5320ce15dfcf0`（main）
- ビルド: `npm run build` 成功
- 型検査: `npm run typecheck` 成功
- テスト: `npm test -- --run` 7 files / 37 tests PASS

## 判定凡例

| 判定 | 意味 |
| --- | --- |
| PASS | 期待動作を確認 |
| PARTIAL | 一部確認。残りは対話・実機・外部依存 |
| BLOCKED | 環境依存（実API・実クレデンシャル未整備）で未実施 |
| COVERED_BY_AUTOMATED_TEST | 自動化テストで同等ロジックを検証済み |

## データ入出力系（AT-01〜AT-06）

| ID | コマンド | 判定 | 備考 |
| --- | --- | --- | --- |
| AT-01 | `scale2sheet run --period morning` | **BLOCKED** | 実 scale_exporter 出力ファイル・実 Google Sheets 書き込み権限が必要（このセッションには検証用Spreadsheet未設定） |
| AT-02 | `scale2sheet run --period evening` | **BLOCKED** | 同上 |
| AT-03 | `scale2sheet run --period morning --date 2026-06-27` | **BLOCKED** | 同上 |
| AT-04 | `scale2sheet run --period morning --source google-fit` | **BLOCKED** | Google Fit OAuth認証（`scale2sheet auth`）が未実施 |
| AT-05 | `scale2sheet serve` | **BLOCKED** | 常駐実行の実時刻トリガーは手動長時間観測が必要 |
| AT-06 | `scale2sheet auth` | **BLOCKED** | 実 Google Fit OAuth クライアント未設定 |

## エラー・境界値系（AT-07〜AT-13）

| ID | 内容 | 判定 | 確認方法 |
| --- | --- | --- | --- |
| AT-07 | 朝の対象時間帯に体重測定値なし→転記しない | **COVERED_BY_AUTOMATED_TEST** | `test/service/measurements.test.ts`「体重なしの期間は同期しない」 |
| AT-08 | 夜の対象時間帯に体重以外はあるが体重なし→転記しない | **COVERED_BY_AUTOMATED_TEST** | `test/service/measurements.test.ts`「体重がない場合は値が空」 |
| AT-09 | scale_exporter出力ディレクトリ・当日ファイル不存在 | **COVERED_BY_AUTOMATED_TEST** | `test/scale-exporter/reader.test.ts`「ディレクトリ不存在時は空配列」 |
| AT-10 | scale_exporter出力の不正行 | **COVERED_BY_AUTOMATED_TEST** | `test/scale-exporter/reader.test.ts`「不正JSON行/スキーマ違反行でエラー」 |
| AT-11 | 連番ファイル境界での重複除去 | **COVERED_BY_AUTOMATED_TEST** | `test/scale-exporter/reader.test.ts`「ファイル境界の重複除去」 |
| AT-12 | 不正な`--period`引数 | **PARTIAL** | `test/cli/index.test.ts`は日付オプションの検証のみをカバー。`--period`自体のcommander検証は自動テスト未整備 |
| AT-13 | Spreadsheetに当日行がない | **COVERED_BY_AUTOMATED_TEST** | `test/sheets/adapter.test.ts`「対応日付形式からの当日行検索」（該当なしケース） |

## 設定ファイル系（AT-14〜AT-16）

| ID | 内容 | 判定 | 確認方法 |
| --- | --- | --- | --- |
| AT-14 | settings.json自動生成 | **COVERED_BY_AUTOMATED_TEST** | `test/config/settings.test.ts`「settings.json自動生成」 |
| AT-15 | settings.jsonの`source`がデフォルトになる | **COVERED_BY_AUTOMATED_TEST** | `test/config/settings.test.ts`「settings値の読込」 |
| AT-16 | 環境変数優先 | **COVERED_BY_AUTOMATED_TEST** | `test/config/settings.test.ts`「環境変数によるsettings上書き」 |

## 出力（Spreadsheet書き込み）系（AT-17〜AT-18）

| ID | 内容 | 判定 | 確認方法 |
| --- | --- | --- | --- |
| AT-17 | 複数ソース混在で内部モデルが`mixed`になる | **COVERED_BY_AUTOMATED_TEST** | `test/domain/measurement.test.ts`, `test/service/measurements.test.ts` |
| AT-18 | 括弧付き血圧ヘッダの認識 | **COVERED_BY_AUTOMATED_TEST** | `test/sheets/adapter.test.ts`「括弧付き血圧ヘッダからのマッピング」 |

## サマリー

| 判定 | 件数 |
| --- | --- |
| PASS | 0 |
| PARTIAL | 1 |
| COVERED_BY_AUTOMATED_TEST | 11 |
| BLOCKED | 6 |
| 合計 | 18 |

## 補足・残タスク

- AT-01〜AT-06（実Google Sheets/Google Fit連携）は、検証用Spreadsheetと`~/.config/scale2sheet/`の実クレデンシャルを用意した上で手動実施する必要がある。次回実機検証時に本レポートを更新すること。
- AT-12（`--period`不正値のCLIレベル検証）はユニットテストの追加候補（`test/cli/index.test.ts`にcommanderのバリデーションを直接テストするケースを足す）。
- secret / token の実値はレポートに含めない。
