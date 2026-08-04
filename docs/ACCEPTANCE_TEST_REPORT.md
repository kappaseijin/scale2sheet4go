---
type: TestReport
title: scale2sheet — Acceptance Test Report
description: 受け入れテスト実施結果（AT-01〜AT-18）
timestamp: "2026-07-05T00:00:00+09:00"
tags: [acceptance-test, scale2sheet]
---

# scale2sheet — Acceptance Test Report

- 実施日: 2026-07-05
- 対象実装コミット: `6367113`（`feature/bun-priority-rename`）
- ビルド: `npm run build` 成功
- Bunビルド: `npm run build:bun` 成功（出力: `dist/scale2sheet`）
- 型検査: `npm run typecheck` 成功
- テスト: `npm test -- --run` 7 files / 37 tests PASS
- 追加確認: `./scripts/run-bun-binary-smoke.sh` 成功

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
| AT-07 | 朝の対象時間帯に体重測定値なし→転記しない | **COVERED_BY_AUTOMATED_TEST** / **COMPILED_BINARY_SMOKE** | `test/service/measurements.test.ts`「体重なしの期間は同期しない」 / `./scripts/run-bun-binary-smoke.sh` `empty-scale-exporter` |
| AT-08 | 夜の対象時間帯に体重以外はあるが体重なし→転記しない | **COVERED_BY_AUTOMATED_TEST** | `test/service/measurements.test.ts`「体重がない場合は値が空」 |
| AT-09 | scale_exporter出力ディレクトリ・当日ファイル不存在 | **COVERED_BY_AUTOMATED_TEST** / **COMPILED_BINARY_SMOKE** | `test/scale-exporter/reader.test.ts`「ディレクトリ不存在時は空配列」 / `./scripts/run-bun-binary-smoke.sh` `empty-scale-exporter` |
| AT-10 | scale_exporter出力の不正行 | **COVERED_BY_AUTOMATED_TEST** / **COMPILED_BINARY_SMOKE** | `test/scale-exporter/reader.test.ts`「不正JSON行/スキーマ違反行でエラー」 / `./scripts/run-bun-binary-smoke.sh` `invalid-scale-exporter-reading` |
| AT-10a | scale_exporter出力の不正行（ファイル単位スキップ） | PENDING | Slice 2でAC-39〜42を検証。AT-10の全損条件をファイル単位スキップへ改訂する決定（2026-08-04、Issue #56）を反映。三つの件数の重複単位はIssue #63の決定後に確定 |
| AT-11 | 連番ファイル境界での重複除去 | **COVERED_BY_AUTOMATED_TEST** | `test/scale-exporter/reader.test.ts`「ファイル境界の重複除去」 |
| AT-12 | 不正な`--period`引数 | **PARTIAL** | `test/cli/index.test.ts`は日付オプションの検証のみをカバー。`--period`自体のcommander検証は自動テスト未整備 |
| AT-13 | Spreadsheetに当日行がない | **PARTIAL** | `test/sheets/adapter.test.ts`「対応日付形式からの当日行検索」は該当ありケースのみ。当日行が見つからず`undefined`になるケースは未テスト |

## 設定ファイル系（AT-14〜AT-16）

| ID | 内容 | 判定 | 確認方法 |
| --- | --- | --- | --- |
| AT-14 | settings.json自動生成 | **COVERED_BY_AUTOMATED_TEST** / **COMPILED_BINARY_SMOKE** | `test/config/settings.test.ts`「settings.json自動生成」 / `./scripts/run-bun-binary-smoke.sh` `empty-scale-exporter` |
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
| PARTIAL | 2 |
| COVERED_BY_AUTOMATED_TEST | 10 |
| BLOCKED | 6 |
| 合計 | 18 |

## 補足・残タスク

- AT-01〜AT-06（実Google Sheets/Google Fit連携）は、検証用Spreadsheetと`~/.config/scale2sheet/`の実クレデンシャルを用意した上で手動実施する必要がある。次回実機検証時に本レポートを更新すること。
- `./scripts/run-bun-binary-smoke.sh` により、コンパイル済みバイナリ `dist/scale2sheet` の `--help` / `--version` / 空設定 / 不正設定 / 不正読込 / Sheets認証欠如の各経路を確認済み。これは AT-07 / AT-09 / AT-10 / AT-14 のバイナリ経路確認に相当する。
- AT-12（`--period`不正値のCLIレベル検証）はユニットテストの追加候補（`test/cli/index.test.ts`にcommanderのバリデーションを直接テストするケースを足す）。
- AT-13（Spreadsheetに当日行がない場合に`undefined`を返すこと）もユニットテストの追加候補（`test/sheets/adapter.test.ts`の`findTodayRowNumber`に該当なしケースを足す）。
- secret / token の実値はレポートに含めない。

## Installer AC（AC-01〜AC-49）

各 AC は最終 owner Slice が完了するまで `PENDING` とする。Slice 1 は run lease の基盤のみを提供するため、本表の最終判定を閉じない。

| AC | owner Slice | 必須方式 | 実施方式 | 対象 commit | 実施日時 (JST) | 証跡 | 判定 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AC-01 | Slice 3 | 自動 | — | — | — | compiled install | PENDING | Slice 3 で判定 |
| AC-02 | Slice 3 | 自動 | — | — | — | installed `--version` | PENDING | Slice 3 で判定 |
| AC-03 | Slice 6 | 代理指標、手動 | — | — | — | checkout rename | PENDING | Slice 6 で判定 |
| AC-04 | Slice 3 | 自動 | — | — | — | credential failure | PENDING | Slice 3 で判定 |
| AC-05 | Slice 3 | 自動 | — | — | — | launchd opt-in | PENDING | Slice 3 で判定 |
| AC-06 | Slice 6 | 代理指標、手動 | — | — | — | temporary label | PENDING | Slice 6 で判定 |
| AC-07 | Slice 2 | 自動 | — | — | — | pure plist | PENDING | Slice 2 で判定 |
| AC-08 | Slice 3 | 自動 | — | — | — | fake launchctl | PENDING | Slice 3 で判定 |
| AC-09 | Slice 3 | 自動 | — | — | — | default uninstall | PENDING | Slice 3 で判定 |
| AC-10 | Slice 3 | 自動 | — | — | — | manifest prefix | PENDING | Slice 3 で判定 |
| AC-11 | Slice 3 | 自動 | — | — | — | uninstall output | PENDING | Slice 3 で判定 |
| AC-12 | Slice 5 | 自動 | — | — | — | purge notice | PENDING | Slice 5 で判定 |
| AC-13 | Slice 5 | 自動 | — | — | — | noninteractive purge | PENDING | Slice 5 で判定 |
| AC-14 | Slice 3 | 自動 | — | — | — | uninstalled state | PENDING | Slice 3 で判定 |
| AC-15 | Slice 3 | 自動 | — | — | — | repeated install | PENDING | Slice 3 で判定 |
| AC-16 | Slice 3 | 自動 | — | — | — | settings hash | PENDING | Slice 3 で判定 |
| AC-17 | Slice 3 | 自動 | — | — | — | old inode | PENDING | Slice 3 で判定 |
| AC-18 | Slice 3 | 自動 | — | — | — | active serve | PENDING | Slice 3 で判定 |
| AC-19 | Slice 3 | 自動 | — | — | — | dry-run isolation | PENDING | Slice 3 で判定 |
| AC-20 | Slice 7 | 自動 | — | — | — | all-slice isolation | PENDING | Slice 7 で最終集約 |
| AC-21 | Slice 5 | 自動 | — | — | — | interruption points | PENDING | Slice 5 で判定 |
| AC-22 | Slice 6 | 自動 | — | — | — | README path | PENDING | Slice 6 で判定 |
| AC-23 | Slice 5 | 自動 | — | — | — | dry-run tree | PENDING | Slice 5 で判定 |
| AC-24 | Slice 6 | 代理指標、手動 | — | — | — | read-only Sheets | PENDING | Slice 4 fake + Slice 6 real read-only |
| AC-25 | Slice 4 | 自動 | — | — | — | no doctor network | PENDING | Slice 4 で判定 |
| AC-26 | Slice 2 | 自動 | — | — | — | bounded stable snapshot | PENDING | fake clock/stat/delayで3attemptと読取前後一致を判定 |
| AC-27 | Slice 6 | 代理指標、手動 | — | — | — | input failure notification | PENDING | missing/unstable/invalidの要求をSlice 2、実通知をSlice 6で判定 |
| AC-28 | Slice 6 | 代理指標、手動 | — | — | — | input / transfer notification | PENDING | 2段階を区別。実行体欠落は対象外 |
| AC-29 | Slice 2 | 自動 | — | — | — | timestamp logs | PENDING | Slice 2 で判定 |
| AC-30 | Slice 2 | 自動 | — | — | — | missing failure / present-zero no-op | PENDING | code 1/0と転記非呼出を判定 |
| AC-31 | Slice 2 | 自動 | — | — | — | input snapshot ports | PENDING | 実時間5秒待機なしで判定 |
| AC-32 | Slice 7 | 自動 | — | — | — | legacy reference removal | PENDING | Slice 7 で判定 |
| AC-33 | Slice 4 | 自動 | — | — | — | doctor diagnostics | PENDING | Slice 4 で判定 |
| AC-34 | Slice 2 | 自動 | — | — | — | plist stderr | PENDING | Slice 2 で判定 |
| AC-35 | Slice 6 | 自動、手動 | — | — | — | registration check | PENDING | Slice 6 で判定 |
| AC-36 | Slice 6 | 自動、手動 | — | — | — | status history | PENDING | Slice 6 で判定 |
| AC-37 | Slice 6 | 代理指標、手動 | — | — | — | normal active pipeline | PENDING | Slice 6 で判定 |
| AC-38 | Slice 6 | 代理指標、手動 | — | — | — | force stop warning | PENDING | Slice 6 で判定 |
| AC-39 | Slice 2 | 自動 | — | — | — | file-level skip | PENDING | Slice 2 で判定 |
| AC-40 | Slice 2 | 自動 | — | — | — | excluded file diagnostics | PENDING | Slice 2 で判定 |
| AC-41 | Slice 2 | 自動 | — | — | — | partial input status/doctor | PENDING | Slice 2/4 で判定 |
| AC-42 | Slice 2 | 自動 | — | — | — | all-invalid fail-closed | PENDING | Slice 2 で判定 |
| AC-42a | Slice 2 | 自動 | 544c59a | — | — | invalid diagnostic | **PASS** | reviewer end-to-end 確認済み |
| AC-43 | Slice 2 | 自動 | — | — | — | no-data counter | PENDING | Slice 2 で判定 |
| AC-44 | Slice 2 | 自動 | — | — | — | N=4 notification | PENDING | 案件A §5.3.1 の2軸表を根拠に判定 |
| AC-45 | Slice 2 | 自動 | — | — | — | missing vs no-data | PENDING | Slice 2 で判定 |
| AC-46 | Slice 7 | 自動 | — | — | — | no-data observation exclusion | PENDING | Slice 7 で判定 |
| AC-47 | Slice 2 | 自動 | — | — | — | status fields | PENDING | Slice 2 で判定 |
| AC-48 | Slice 4 | 自動 | — | — | — | doctor build identifier | PENDING | Slice 4 で判定 |
| AC-49 | Slice 2 | 自動 | — | — | — | threshold notification distinction | PENDING | Slice 2 で判定 |
