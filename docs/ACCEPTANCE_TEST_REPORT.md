---
type: TestReport
title: scale2sheet — Acceptance Test Report
description: 受け入れテスト実施結果（AT-01〜AT-18）と AC 番号予約台帳
timestamp: "2026-07-05T00:00:00+09:00"
updated: "2026-08-05T10:50:33+09:00"
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

## AC 番号予約台帳

AC 番号の採番正本は、この節の予約台帳である。
新しい合格条件を起草する前に、Issue、予定件数、開始番号、終了番号を記録した予約 PR を merge する。
決定文書、目標定義、検討書に AC を書いてから番号を調整する順序は使わない。

この台帳の割当状態は、受け入れ試験の判定とは別の意味を持つ。

| 割当状態 | 意味 |
| --- | --- |
| `PENDING` | 予約 PR は main へ merge 済みだが、予約した AC の定義が main にまだ揃っていない |
| `CONFIRMED` | 予約した番号と定義件数が main の定義文書で固定されている。要件の採否、実装完了、試験の PASS を意味しない |
| `UNUSED` | owner がなく、後続の予約 PR で使用できる |

### 既存割当の backfill

予定件数は、その案件が必要とした AC 定義の数を表す。
予約枠数は `終了番号 - 開始番号 + 1` で求める。
案A の導入後に作る新しい `PENDING` 予約では、1条件につき接尾辞の無い整数番号を1つ使い、`予定件数 = 予約枠数` とする。

| 開始番号 | 終了番号 | Issue | 予定件数 | 予約枠数 | 定義件数 | 割当状態 | 予約 PR／根拠 | 定義文書 | 備考 |
| ---: | ---: | --- | ---: | ---: | ---: | --- | --- | --- | --- |
| AC-50 | AC-52 | #56 | 3 | 3 | 3 | `CONFIRMED` | 導入前、#87 で backfill | [pipeline 入力段階の失敗と部分成功](decisions/2026-08-04T151338_pipeline入力段階の失敗と部分成功の目標定義.md) | 案件A |
| AC-53 | AC-65 | #63 | 14 | 13 | 14 | `CONFIRMED` | 導入前、#87 で backfill | [測定の同一性と件数の単位](decisions/2026-08-04T154921_測定の同一性と件数の単位の目標定義.md) | `AC-54a` を含む legacy suffix。新規予約では再使用しない |
| AC-66 | AC-69 | #56 G-3 追補 | 4 | 4 | 4 | `CONFIRMED` | 導入前、#87 で backfill | [入力失敗の通知を原因別にする追補](decisions/2026-08-04T160408_入力失敗の通知を原因別にする追補.md) | #66 の AC-66〜69 と legacy overlap |
| AC-66 | AC-71 | #66 | 6 | 6 | 6 | `CONFIRMED` | 導入前、#87 で backfill | [命名規約不一致ファイルの検出](decisions/2026-08-04T171300_命名規約不一致ファイルの検出についての検討書.md) | G-3 追補の AC-66〜69、#65 の AC-70〜71 と legacy overlap |
| AC-70 | AC-76 | #65 | 7 | 7 | 7 | `CONFIRMED` | 導入前、#87 で backfill | [数え方の版](decisions/2026-08-04T170446_数え方の版についての目標定義.md) | #66 の AC-70〜71 と legacy overlap |
| AC-77 | AC-84 | #62 | 8 | 8 | 8 | `CONFIRMED` | 導入前、#87 で backfill | [再公開による上書きの検出](decisions/2026-08-04T173602_再公開による上書きの検出についての目標定義.md) | なし |
| AC-85 | AC-92 | #77 | 8 | 8 | 8 | `CONFIRMED` | PR #85 | [入力診断の観測強度と上書き規則](decisions/2026-08-04T184538_入力診断の観測強度と上書き規則の検討書.md) | なし |
| AC-93 | AC-95 | なし | 0 | 3 | 0 | `UNUSED` | #46 で未使用を明記 | なし | 予約済みではない。予定件数が3以下の案件は使用できる |
| AC-96 | AC-109 | #46 | 14 | 14 | 14 | `CONFIRMED` | #46 の目標定義 PR | [連続失敗に人が気づくための目標定義](decisions/2026-08-04T184244_連続失敗に人が気づくための目標定義.md) | なし |
| AC-110 | AC-117 | #46 | 8 | 8 | 8 | `CONFIRMED` | PR #91 | [常設状態表示の検討結果と通知のみの構成](decisions/2026-08-04T194632_デスクトップとメニューバーへの常設状態表示の検討書.md) | 当初14件を予約。ユーザー最終決定により notification-only の8件で確定 |
| AC-118 | AC-123 | #46 | 6 | 6 | 6 | `CONFIRMED` | PR #98 | [pipeline status の永続 schema と更新規則](decisions/2026-08-05T102852_pipeline_statusの永続schemaと更新規則の設計.md) | PR #91 で一度解放した範囲を、同じ Issue #46 の schema 設計へ再予約 |

AC-66〜69 と AC-70〜71 の重複は、この台帳の導入前に main へ入った legacy overlap である。
これらの番号を新しい案件へ割り当てず、既存文書も本件では振り直さない。
新しい overlap は reviewer gate で block する。
legacy overlap を受け入れ試験の判定表へ追加するときは、`AC-66 (#56 G-3)` と `AC-66 (#66)` のように owner Issue を併記し、`(AC 番号, Issue)` を判定行のキーとする。
同じ AC 番号の別条件を1行へ統合せず、片方の判定で他方を上書きしない。

### 起草者が起草前に行うこと

1. AC を必要とする作業の origin GitHub Issue を作る。
2. 合格条件の予定件数を数える。
   新しい合格条件は1条件につき整数番号を1つ使い、`AC-54a` のような接尾辞を追加しない。
3. main を同期し、予約台帳から予定件数が収まる連続した `UNUSED` 範囲を探す。
   十分な `UNUSED` 範囲が無ければ、使用中の最大番号の次から予定件数分を選ぶ。
   小さい未使用範囲と最大番号後の範囲を、1つの初回予約として連結しない。
4. 予約台帳だけを変更する予約 PR を作る。
   Issue、予定件数、開始番号、終了番号、予約枠数を記録し、割当状態を `PENDING`、定義件数を0、定義文書を「未起草」とする。
5. reviewer は予約範囲が既存の `PENDING`、`CONFIRMED`、legacy overlap と重ならず、`予定件数 = 予約枠数` であることを確認する。
6. 予約 PR を main へ merge する。
   起草者は merge 後の main から本文用の topic branch を作り、予約範囲内だけで AC を定義する。

予約 PR が main へ入る前に、AC を含む本文の起草 PR を作らない。
これにより、同じ main を見た複数の起草者が同じ最大番号を選んでも、後から merge する予約 PR の reviewer が overlap を検出できる。

### 追加予約、確定、取消

- 予定件数が増えた場合、既存番号を振り直さない。
  追加分の範囲を `PENDING` で予約する別の予約 PR を先に merge し、その後に本文へ条件を追加する。
- 本文用 PR では、使用した範囲の定義件数を記録し、定義文書へのリンクを追加して、割当状態を `PENDING` から `CONFIRMED` へ変える。
- 予約より少ない件数で確定する場合、使用範囲を `CONFIRMED` とし、未使用の末尾を別行の `UNUSED` へ分割する。
  `CONFIRMED` 行の予定件数と予約枠数は最終的に使用した件数へ揃え、備考に当初の予約件数を残す。
  既に書いた AC は詰め直さない。
- 本文を起草せず取り消す場合、別の予約 PR で `PENDING` を `UNUSED` へ変え、備考に元の Issue を残す。
- `CONFIRMED` の番号は、定義が後から廃止されても別案件へ再割当しない。

### reviewer gate

予約 PR の reviewer は、次をすべて確認する。

1. origin GitHub Issue、予定件数、開始番号、終了番号がある。
2. `予定件数 = 予約枠数` であり、予約範囲が `PENDING`、`CONFIRMED`、legacy overlap と重ならない。
3. branch が最新の origin/main を取り込み、その時点の台帳を基準にしている。
4. 予約 PR に新しい AC 定義が含まれない。

本文用 PR の reviewer は、次をすべて確認する。

1. PR 本文に、先に merge 済みの予約 PR と予約範囲が記載されている。
2. 追加した AC が同じ Issue の `PENDING` 範囲内にあり、接尾辞の無い整数である。
3. 追加した定義件数が予定件数を超えず、確定時には予約枠数と一致する。
4. 同じ PR で定義文書、定義件数、割当状態を更新する。
5. いずれかを満たさない場合は merge を block し、予約 PR または追加予約 PR を先に求める。

追加された AC 定義は次のコマンドで抽出する。

```bash
git diff --unified=0 origin/main...HEAD -- 'docs/**/*.md' | rg '^\+.*\*\*AC-[0-9]+'
```

新しい接尾辞付き番号が無いことは、次のコマンドで確認する。

```bash
git diff --unified=0 origin/main...HEAD -- 'docs/**/*.md' | rg '^\+.*\*\*AC-[0-9]+[a-z]'
```

このコマンドが一致を返した場合、reviewer は整数番号への変更を求める。

main に存在する整数 AC の重複は、次のコマンドで確認する。

```bash
rg -o --no-filename '^- \*\*AC-[0-9]+([^[:alnum:]]|$)' docs/decisions --glob '*.md' \
  | sed -E 's/.*AC-([0-9]+).*/\1/' \
  | sort -n \
  | uniq -d
```

導入時点で許容する出力は、legacy overlap の `66`、`67`、`68`、`69`、`70`、`71` だけである。
それ以外の番号が増えた場合、reviewer は新しい重複として block する。

予約漏れの負のコントロールは、予約台帳に無い AC 定義を本文用 PR の差分へ1件置くことである。
差分抽出には現れるが対応する `PENDING` 行が無いため、reviewer gate は merge を block する。
幅不足の負のコントロールは、11枠の予約に14件の定義を置くことである。
3件が予約範囲外になり、予定件数と定義件数も一致しないため、追加予約 PR の merge 前には本文用 PR を merge できない。

## Installer AC（AC-01〜AC-49）

各 AC は最終 owner Slice が完了するまで `PENDING` とする。Slice 1 は run lease の基盤のみを提供するため、本表の最終判定を閉じない。

| AC | owner Slice | 必須方式 | 実施方式 | 対象 commit | 実施日時 (JST) | 証跡 | 判定 | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AC-01 | Slice 3 | 自動 | `bash scripts/run-installer-acceptance.sh` | 200c8e8 | 2026-08-10T21:07:06+09:00 | compiled install | PASS | isolated HOMEでbinary/settings/manifestの生成、実行可能性、version出力をassert |
| AC-02 | Slice 3 | 自動 | `bash scripts/run-installer-acceptance.sh` | 200c8e8 | 2026-08-10T21:07:06+09:00 | installed `--version` | PASS | installed binaryの`-x`と`--version`非空をassert |
| AC-03 | Slice 6 | 代理指標、手動 | — | — | — | checkout rename | PENDING | C（cutover 待ち）。Slice 6 の checkout rename は、実 checkout と切替後経路が揃ってから測る。対応試験は未確認 |
| AC-04 | Slice 3 | 自動 | `npx vitest run test/installation/planner.test.ts test/cli/installation.test.ts` | 200c8e8 | 2026-08-10T21:07:06+09:00 | credential failure | PENDING | missing file名・nonzero終了・未変更はassert。取得方法の表示は未実装。settings不在の初回install経路はIssue #184 |
| AC-05 | Slice 3 | 自動 | `npx vitest run test/installation/planner.test.ts` | 200c8e8 | 2026-08-10T21:07:06+09:00 | launchd opt-in | PASS | `--launchd`なしではplist/launchctl operationsがzeroであることをassert |
| AC-06 | Slice 6 | 代理指標、手動 | — | — | — | temporary label | PENDING | plannerの代理指標。ACのtemporary labelを実launchdへ登録することは未検査 |
| AC-07 | Slice 2 | 自動 | `npm test -- --run test/installation/plist.test.ts` | 9a3741b, f87ea12 | 2026-08-04 17:28 JST | pure plist | PASS | direct pipeline arguments と shell 非参照を検査 |
| AC-08 | Slice 3 | 自動 | — | — | — | fake launchctl | PENDING | bootout/plist removalを計画するassertはあるが、fake launchctlで実削除することは未検査 |
| AC-09 | Slice 3 | 自動 | `bash scripts/run-installer-acceptance.sh` | 200c8e8 | 2026-08-10T21:07:06+09:00 | default uninstall | PASS | uninstall後もsettings/logの存在と内容を保持し、manifest/binを除去することをassert |
| AC-10 | Slice 3 | 自動 | `npx vitest run test/installation/planner.test.ts` | 200c8e8 | 2026-08-10T21:07:06+09:00 | manifest prefix | PASS | prefix変更後もmanifest記録のbinary pathを使う計画をassert |
| AC-11 | Slice 3 | 自動 | `npx vitest run test/cli/installation.test.ts` | 200c8e8 | 2026-08-10T21:07:06+09:00 | uninstall output | PASS | 残置absolute path、runtime artifact、manual rebuild+purge commandの出力をassert |
| AC-12 | Slice 5 | 自動 | — | — | — | purge notice | PENDING | C（**実装待ち**。cutover 待ちではない）。Slice 5 purge notice の実装・試験が現行に無く、purge 仕様が着地してから測る |
| AC-13 | Slice 5 | 自動 | — | — | — | noninteractive purge | PENDING | C（**実装待ち**。cutover 待ちではない）。Slice 5 noninteractive purge の実装・試験が現行に無く、purge 実体と隔離入力が揃ってから測る |
| AC-14 | Slice 3 | 自動 | `npx vitest run test/installation/planner.test.ts test/cli/installation.test.ts` | 200c8e8 | 2026-08-10T21:07:06+09:00 | uninstalled state | PASS | manifestなしでoperationsなし、`nothing to do`をassert |
| AC-15 | Slice 3 | 自動 | `bash scripts/run-installer-acceptance.sh` | 200c8e8 | 2026-08-10T21:07:06+09:00 | repeated install | PASS | 2回目installの成功とsettings content不変をassert |
| AC-16 | Slice 3 | 自動 | — | — | — | settings hash | PENDING | install前後の不変は検査するが、利用者の任意編集の保持は未検査 |
| AC-17 | Slice 3 | 自動 | `npx vitest run test/installation/binary-copy-source.test.ts` | 200c8e8 | 2026-08-10T21:07:06+09:00 | old inode | PASS | atomic replace、old inode、直接overwrite負の制御、temp cleanupをassert |
| AC-18 | Slice 3 | 自動 | `bash scripts/run-installer-acceptance.sh` | 200c8e8 | 2026-08-10T21:07:06+09:00 | active serve | PASS | 隔離Bun process側でserve lease保持中のinstall --launchd非zero、tree不変、mutating launchctlなしをassert。Vitest側のactive serve adapter経路は未検査 |
| AC-19 | Slice 3 | 自動 | `bash scripts/run-installer-acceptance.sh` | 200c8e8 | 2026-08-10T21:07:06+09:00 | dry-run isolation | PASS | dry-runのplan出力、filesystem tree不変、mutating launchctlなしをassert。**外部 API 通信の非発生は AC-25（network deny）で別途検査** |
| AC-20 | Slice 7 | 自動 | — | — | — | all-slice isolation | PENDING | C（cutover 待ち）。Slice 7 の全 Slice 隔離・最終集約は、cutover 後の全成果物と観測結果が揃ってから測る |
| AC-21 | Slice 5 | 自動 | — | — | — | interruption points | PENDING | manifest rename中断とresumeは検査するが、全installation interruption pointsは網羅していない |
| AC-22 | Slice 6 | 自動 | — | — | — | README path | PENDING | C（cutover 待ち）。Slice 6 の README path は、配布・導入経路が確定してから README と実体を突合して測る |
| AC-23 | Slice 5 | 自動 | `bash scripts/run-installer-acceptance.sh` | 200c8e8 | 2026-08-10T21:07:06+09:00 | dry-run tree | PASS | install/uninstall双方のdry-runでtree不変とmutationなしをassert |
| AC-24 | Slice 6 | 代理指標、手動 | `npx vitest run test/installation/sheets-read.test.ts test/installation/doctor.test.ts` | 200c8e8 | 2026-08-10T08:04:29+09:00 | read-only fake Sheets port | PENDING | fake Sheetsの認証→header→当日行順とwrite methodなしは検査するが、実Spreadsheetのread-onlyは未検査 |
| AC-25 | Slice 4 | 自動 | `npm run acceptance:installer`、`npx vitest run test/cli/doctor.test.ts` | 200c8e8 | 2026-08-10T08:04:29+09:00 | compiled install under network deny | **PASS** | compiled install は network deny で成功し、install/uninstall は doctor deps を生成せず network adapter に到達しない |
| AC-26 | Slice 2 | 自動 | `npm test -- --run test/pipeline/input-snapshot.test.ts` | ee89df3 | 2026-08-04 17:28 JST | bounded stable snapshot | PASS | fake delay で3 attempt・metadata 一致・missing/unstable/invalid を検査 |
| AC-27 | Slice 6 | 代理指標、手動 | — | — | — | input failure notification | PENDING | 通知claim/state transitionは検査するが、missing/unstable/invalid全ての実通知は未検査 |
| AC-28 | Slice 6 | 代理指標、手動 | — | — | — | input / transfer notification | PENDING | input failureとtransfer経路の分離は検査するが、両段階の実通知を区別して検査していない。実行体欠落は対象外 |
| AC-29 | Slice 2 | 自動 | `npm run acceptance:pipeline-shadow` | ee89df3, e7d3b8a | 2026-08-04 17:28 JST | isolated compiled status | PASS | running の `startedAt` と terminal の `completedAt`、input-missing の `matchedFileCount=0` と未到達 count key 欠落、0600、atomic replacement を観測。transfer 未到達のため network deny は未検証 |
| AC-30 | Slice 2 | 自動 | `npm test -- --run test/pipeline/pipeline.test.ts`、`npm run acceptance:pipeline-shadow` | ee89df3 | 2026-08-04 17:28 JST | no-data / missing input | PASS | present-but-zero は exit 0・転記なし、missing は bounded exit 1 を検査 |
| AC-31 | Slice 2 | 自動 | `npm test -- --run test/pipeline/input-snapshot.test.ts test/pipeline/pipeline.test.ts test/cli/serve-lease.test.ts` | ee89df3 | 2026-08-04 17:28 JST | input/status/notifier/lease ports | PASS | snapshot・status・notifier・lease の差替えを検査。3件数の証跡は AC-29 に集約。#63/#65 の未決契約は対象外 |
| AC-32 | Slice 7 | 自動 | — | — | — | legacy reference removal | PENDING | C（**観測待ち**）。Slice 7 legacy reference removal。観測期間完了後、旧経路・旧 plist 参照ゼロの材料が揃ってから測る |
| AC-33 | Slice 4 | 自動 | `npx vitest run test/installation/doctor.test.ts test/cli/doctor.test.ts` | 200c8e8, 4001974 | 2026-08-10T08:11:33+09:00 | doctor diagnostics | **PASS** | 設定破損、認証切れ、権限不足を fake port/deps で検出。配置先・実行権限・version 不整合では共通の `scale2sheet install --prefix <prefix> --launchd` 復旧手順も表示する。設計との差異と将来の表示変更は Issue #201 で決定する。実行体欠落は適用範囲外 |
| AC-34 | Slice 2 | 自動 | `npm test -- --run test/installation/plist.test.ts` | 9a3741b, f87ea12 | 2026-08-04 17:28 JST | plist stderr | PASS | period 別 `StandardErrorPath` を生成値で検査。spawn failure は対象外 |
| AC-35 | Slice 6 | 自動、手動 | `npx vitest run test/installation/doctor.test.ts` | — | 2026-08-10T21:07:06+09:00 | registration check | PENDING | doctor側の登録状態報告は検査済み。**installerによる登録直後の実行体検証は未実装** |
| AC-36 | Slice 6 | 自動、手動 | `npx vitest run test/installation/doctor.test.ts` | 310b5bd | 2026-08-10T07:44:24+09:00 | status history | PENDING | status fixtureの対象日・成功時刻・結果は検査するが、実run後の履歴表示と超過判定は未検査 |
| AC-37 | Slice 6 | 代理指標、手動 | — | — | — | normal active pipeline | PENDING | active receipt/latest runのfixture報告はあるが、normal active pipelineを実行して完了する経路は未検査 |
| AC-38 | Slice 6 | 代理指標、手動 | — | — | — | force stop warning | PENDING | B（書けば測れる）。force-stop warning を検査する試験は見つからない。停止・中断時の警告契約を確定すれば隔離試験可能 |
| AC-39 | Slice 2 | 自動 | — | — | — | file-level skip | PENDING | **分類枠に収まらない（Issue #246）。決定と実装が食い違う。**2026-08-04（Issue #56）は file-level skip へ改訂すると決定したが、実装は `test/pipeline/input-snapshot.test.ts:155-171` で「1 行不正なら全 input reject」を固定している |
| AC-40 | Slice 2 | 自動 | — | — | — | excluded file diagnostics | PENDING | **分類枠に収まらない（Issue #246）。試験を書こうとしても書けない。**一次文書 `docs/decisions/2026-08-04T151338_pipeline入力段階の失敗と部分成功の目標定義.md:478-479` は 3 要素（除外ファイル名・最初の失敗行・除外行数）を log と status の**双方**へ出すことを要求するが、**除外行数を保持する情報が実装に無い** |
| AC-41 | Slice 2 | 自動 | `npx vitest run test/installation/doctor.test.ts` | b85dd84, 310b5bd | 2026-08-10T07:44:24+09:00 | partial input status/doctor | PENDING | Slice 4 は記録済み `partialInput: true` だけを報告する。producer は Issue #182 まで未実装で、未定義を「部分入力なし」とは報告しない |
| AC-42 | Slice 2 | 自動 | — | — | — | all-invalid fail-closed | PENDING | B（書けば測れる）。**AC-39 とは別条件である**（AC-39 = 一部 file が読めないとき読めた file だけ転記／AC-42 = **全 file** が読めないとき転記しない）。現行 `test/pipeline/input-snapshot.test.ts:155-171` は 1 つの stable JSONL 内の 1 行 invalid で全 input reject を固定するだけで、**全 file 読み取り不能を直接検査していない**。`failed:input-invalid-or-partial` / exit 1 を直接 assert する試験は無い |
| AC-42a | Slice 2 | 自動 | 544c59a | — | — | invalid diagnostic | **PASS** | reviewer end-to-end 確認済み |
| AC-43 | Slice 2 | 自動 | `npx vitest run test/pipeline/status.test.ts` | 310b5bd | 2026-08-10T21:07:06+09:00 | no-data counter | PASS | period別consecutive no-data streakとtransfer後のresetをassert |
| AC-44 | Slice 2 | 自動 | — | — | — | N=4 notification | PENDING | B（書けば測れる）。N=4 連続 no-data と N-1 で通知内容を区別する試験は見つからない。counter はあるが閾値通知表の全体は未検査 |
| AC-45 | Slice 2 | 自動 | `npx vitest run test/pipeline/input-snapshot.test.ts test/pipeline/pipeline.test.ts` | 310b5bd | 2026-08-10T21:07:06+09:00 | missing vs no-data | PASS | missing input、present-but-zero no-data、input failure時transferなしを別経路でassert |
| AC-46 | Slice 7 | 自動 | — | — | — | no-data observation exclusion | PENDING | C（**観測待ち**）。Slice 7 の連続 7 日観測ゲート。実運用 7 日の観測と、no-data 日を成功日に数えない材料が要る |
| AC-47 | Slice 2 | 自動 | `npx vitest run test/pipeline/status.test.ts` | 310b5bd | 2026-08-10T21:07:06+09:00 | status fields | PASS | v1 documentのperiod、terminal、counts/counters、health、atomic writeを構造でassert |
| AC-48 | Slice 4 / 6 | 自動 | `npx vitest run test/installation/doctor.test.ts` | 310b5bd, 200c8e8 | 2026-08-10T08:04:29+09:00 | doctor build identifier / done・実転記・異常の経過日数 | PENDING | build/execution factsとdone/transfer/経過日数はfixtureで検査するが、実転記と異常継続日数は未検査（Issue #192） |
| AC-49 | Slice 2 | 自動 | — | — | — | threshold notification distinction | PENDING | Slice 2 で判定 |
