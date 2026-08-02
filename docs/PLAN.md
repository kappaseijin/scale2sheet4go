---
type: Plan
title: scale2sheet — 計画書
description: scale2sheet の担当エージェント・Git運用・フェーズ計画・受け入れテスト・検討書ワークフローをまとめた計画書。
tags:
  - plan
  - scale2sheet
timestamp: "2026-07-04T18:00:00+09:00"
---

# scale2sheet 計画書

最終更新: 2026-08-02（Ph.15 の実装分割確定と Slice 1 着手、scale_exporter との責任境界を追加）

参考: [scale_exporter/PLAN.md](https://github.com/kappaseijin/scale_exporter/blob/main/PLAN.md)（本書は scale_exporter の構成を踏襲する）

---

## 担当エージェント

`~/.agents/skills/agmsg/teams/scale2sheet/config.json` に登録済みの7役割体制（2026-07-28、派生命名へ移行）。

命名規約は `<プロジェクト名>_<役割>_<ベンダー>`（`~/.agents/rules/agent-team.rule.md`）。
主人格（`claude_product_manager` / `codex_senior_architect` 等）は**派生元の定義であって、チームへ直接登録する識別子ではない**。
各エージェントは **scale2sheet チームのみ**に所属し、他プロジェクトを跨がない。
役割名は **pm** を正式名とする（`manager` は pm のエイリアス。グローバルの `agent-role.rule.md` は manager 表記だが同一の役割を指す）。

| エージェント | タイプ | モデル / effort | 常駐 | 役割 |
|------------|--------|------|------|------|
| `scale2sheet_pm_claude` | claude-code | `claude-opus-5` / low | 常駐 | ユーザー窓口・他プロジェクトの pm との窓口・提示と承認の中継・PLAN/NOTES 記録 |
| `scale2sheet_innovator_claude` | claude-code | `claude-opus-5` / xhigh | 短命 | 目標の明確化（サクセスストーリー・合格条件・選択肢の追加） |
| `scale2sheet_architect_codex` | codex | `gpt-5.6-sol` / xhigh | 短命 | 調査・検討書/設計書の起草（アーキテクチャ・外部・内部・テスト設計） |
| `scale2sheet_programmer_codex` | codex | `gpt-5.6-terra` / medium | 常駐 | 実装・計測・スクリプト化（TypeScript / vitest） |
| `scale2sheet_reviewer_claude` | claude-code | `claude-opus-5` / xhigh | 常駐 | **codex 系が作成した成果物**の敵対的検証（定量主張の独立再集計・決定前レビュー・PR レビュー） |
| `scale2sheet_reviewer_codex` | codex | `gpt-5.6-terra` / medium（暫定） | 短命 | **Claude 系が作成した成果物**の敵対的検証・PR レビュー |
| `scale2sheet_worker_codex` | codex | `gpt-5.6-luna` / low | 短命 | 設計判断を伴わない定型作業 |

人格差分は `codex_monitor_agents/<派生名>/AGENT.md`、プロジェクト固有の差分と kaizen は同 `projects/scale2sheet/` に置く。

### ワークフロー

```text
ユーザー → pm → innovator → architect & programmer → reviewer
             ↑（提示・承認の中継のみ）        └──────────┘（直接往復・pm を経由しない）
```

- **決定権はユーザー**。pm は決定者ではなく提示者であり、**決定しない・起草しない・検証しない・案を出さない**
- innovator → architect → programmer → reviewer の実務往復は当事者間で直接行い、pm を経由しない
- 起草者は自分の起草物を検証しない。**生産者と検証者は必ず別ロールかつ別ベンダー**。検証者はベンダーを跨いで決まる（codex 作成物 → `reviewer_claude`、Claude 作成物 → `reviewer_codex`）
- 短命セッション（innovator / architect / reviewer_codex / worker）は案件ごとに起動し、成果物の受け渡しでタブを閉じる

エージェント間の連絡は agmsg、起動・監視は herdr CLI を使う。詳細は「開発体制」を参照。

---

## Git 管理ルール

| 作業 | 担当 |
| --- | --- |
| ブランチ作成（`git switch -c <branch-name>`） | 作業を開始するエージェント |
| 設計書・検討書の起草とコミット | `scale2sheet_architect_codex`（作成者がコミット） |
| 実装コードのコミット | `scale2sheet_programmer_codex`（作成者がコミット） |
| `PLAN.md` / `NOTES.md` の記録とコミット | `scale2sheet_pm_claude`（作成者がコミット） |

pm は**検討書・設計書を起草しない**（`~/.agents/rules/agent-role.rule.md`）。pm が書くのは
決定・合意の結果を反映する `PLAN.md` の記録と `NOTES.md` の作業ログに限る。
検討書（`docs/decisions/`）と設計書は architect が起草してコミットする。

PRレビュー・approveの運用（作成者と別LLM・別GitHubアカウントによるレビュー、GitHub Approve機能の使用）は [feedback_pr_review_workflow メモリ](#) の通り。

---

## 概要

朝・夜の身体測定値（体重・体温・血圧上/下・脈拍）を [scale_exporter](https://github.com/kappaseijin/scale_exporter) の出力 JSONL（デフォルト・推奨）、Google Fit REST API、または Apple Health XML エクスポートから取得し、Google Spreadsheet の当日行へ転記する TypeScript / Node.js サービス。

```text
[scale_exporter] --JSONL出力--> ~/Documents/scale_exporter/ --読込--> [scale2sheet] --> Google スプレッドシート
```

Google Fit REST API は 2026 年末で終了するため非推奨。`scale-exporter` ソースを標準とする。

---

## 設定ファイル

設定・認証ファイルの構造は scale_exporter と同じ `~/.config/scale2sheet/` 構成を標準とする（xdg互換、PR #2 で統一済み）。詳細は [EXTERNAL_DESIGN.md](./EXTERNAL_DESIGN.md#設定ファイル) を参照。

---

## フェーズ計画

| フェーズ | 内容 | 成果物 | 状態 |
|---------|------|--------|------|
| Ph.1 | 初期実装 | domain/service/sheets/apple-health/google-fit の基盤、行更新モードのSheetsアダプタ | **完了** |
| Ph.2 | 測定値選択ロジック | 朝・夜の時間帯フィルタ、体重アンカーによる同期時刻選択 | **完了** |
| Ph.3 | scale_exporter ファイル入力対応（PR #1） | `sources/scale-exporter`、`--source scale-exporter` を既定に | **完了**（2026-07-02） |
| Ph.4 | launchd 日次自動化 | 朝夜の本実行＋拾い直し | **完了** |
| Ph.5 | 設定ファイル構造統一（PR #2） | `~/.config/scale2sheet/settings.json`、scale_exporter標準への統一 | **完了**（2026-07-02） |
| Ph.6 | パイプラインリトライ強化（PR #3） | exporterステップの一時的API障害時のリトライ（最大3回、60秒間隔） | **完了** |
| Ph.7 | OS-native scheduling（PR #4） | launchd catch-up runs、失敗通知 | **完了** |
| Ph.8 | エージェント運用体制確立 | herdr + agmsg 3層体制、モデル/effortフォールバック方針 | **完了**（2026-07-04） |
| Ph.9 | 計画書・設計書の新設、検討書ワークフロー導入 | 本書 / ARCHITECTURE_DESIGN.md / EXTERNAL_DESIGN.md / INTERNAL_DESIGN.md / decisions/ | **完了**（2026-07-04） |
| Ph.10 | テスト設計書群の追加 | EXTERNAL_TEST_DESIGN.md / INTERNAL_TEST_DESIGN.md / ACCEPTANCE_TEST_REPORT.md | **完了**（2026-07-04） |
| Ph.11 | Bun CLI対応（第一段階、Ph.12により方針拡張） | `bun build --compile`による単体実行バイナリ（`build:bun`）、`bun run`によるソース直接実行の補助サポート | **計画をPh.12へ拡張**（検討書: [decisions/2026-07-05T102021_Bun_CLI化についての検討書.md](./decisions/2026-07-05T102021_Bun_CLI化についての検討書.md)） |
| Ph.12 | 単一バイナリ化（bun buildを正式配布形態にする） | launchd運用・エンドユーザー向け配布をBunコンパイル済み単体バイナリへ切り替え。開発・型検査・テストはNode.jsツールチェイン継続 | **実装中**（PR #11, #12 完了。検討書: [decisions/2026-07-05T105321_単一バイナリ化_bun_buildを正式な配布形態にする検討書.md](./decisions/2026-07-05T105321_単一バイナリ化_bun_buildを正式な配布形態にする検討書.md)） |
| Ph.13 | Bunを優先実行環境にする・バイナリ名変更 | バイナリ名を`scale2sheet-bun`→`scale2sheet`へ変更、README/設計書をBun優先の書き方へ更新 | **計画中**（検討書: [decisions/2026-07-05T152943_Bunを優先実行環境にしバイナリ名をscale2sheetにする検討書.md](./decisions/2026-07-05T152943_Bunを優先実行環境にしバイナリ名をscale2sheetにする検討書.md)） |
| Ph.14 | エージェント体制の派生命名への移行 | 7役割（pm/innovator/architect/programmer/reviewer×2/worker）を `<プロジェクト名>_<役割>_<ベンダー>` で登録、専用クローンと人格差分 AGENT.md を整備、兼任・プロジェクト跨ぎを解消。reviewer をベンダー別2名に分割しレビュー経路を閉じた | **完了**（2026-07-28） |
| Ph.15 | インストーラ／アンインストーラの整備 | インストール後の実行体をソースチェックアウトから独立させる（Ph.12 の未完了分の回収）。導入・撤収・診断の手段を提供し、launchd plist と run-pipeline.sh の絶対パス依存を解消する。あわせて `build` → `build:node` へ改名 | **実装中・Slice 1**（2026-08-02 着手。目標定義: [decisions/2026-07-29T084808_インストーラとアンインストーラの目標定義.md](./decisions/2026-07-29T084808_インストーラとアンインストーラの目標定義.md)、設計書: [INSTALLATION_DESIGN.md](./INSTALLATION_DESIGN.md)、実装分割: [decisions/2026-07-29T173454_インストーラ実装分割と受け入れ確認の検討書.md](./decisions/2026-07-29T173454_インストーラ実装分割と受け入れ確認の検討書.md)） |

---

### Ph.15 の実装分割（2026-07-30 ユーザー決定・PR #27 で確定）

正本は [実装分割と受け入れ確認の検討書](./decisions/2026-07-29T173454_インストーラ実装分割と受け入れ確認の検討書.md)（status: accepted、main = 24ef0b8）。

- **U-1 = 依存順の capability slice（7本）**。案 I（単一 PR）・案 II（コマンド別 PR）は却下
- **U-2 = 直列 PR**。並行させない
- **U-3 = 連続7日観測後に legacy cleanup を別 PR**。内蔵 pipeline を先に入れ、朝夕の自動実行が7日連続で正常に回るのを確認してから `run-pipeline.sh` を削除する

| Slice | 内容 | 状態 |
| --- | --- | --- |
| 0 | 着手条件の確認（PR を作らない） | 完了（2026-08-02 全項目 PASS） |
| 1 | runtime safety foundation（APP_VERSION / read-only settings / run lease / `O_EXLOCK_DARWIN` / 最小 acceptance harness / AC 骨格） | **実装中** |
| 2 | 内蔵 pipeline の shadow path | 未着手（責任境界の監査待ち） |
| 3 | install と既定 uninstall | 未着手 |
| 4 | doctor | 未着手 |
| 5 | purge と wipe | 未着手 |
| 6 | distribution と切替準備 | 未着手 |
| 7 | 観測後 cleanup | 未着手 |

検証方針は検討書の「Slice ごとの完了ゲート」表が正本。共通ゲートは `npm run typecheck` / `npm test` / `npm run build:bun`。
**通常 Vitest（Node）と隔離 Bun acceptance は一方が他方を代用しない**。とくに `O_EXLOCK` と atomic 置換は
Bun compiled binary の2 process 試験でしか実証できない（AC-15、AC-17〜20、AC-23〜25 は個別ゲート表を優先）。

### scale_exporter との責任境界（2026-08-02 合意）

| | 責任範囲 |
| --- | --- |
| scale_exporter | 測定データ取得、JSONL 出力、**自身の**設定・認証・バイナリの install / uninstall、自身の LaunchAgent（`jp.seijin.kappa.scale-exporter`、既定 07:00/21:00） |
| scale2sheet | pipeline 実行、launchd（**自身の** pipeline / Sheets 用 LaunchAgent のみ）、朝夕スケジュール、Sheets 転記 |

- 連携は**公開 CLI と出力契約だけ**に限定する。相手側の設定・認証・導入を所有しない
- scale2sheet の installer が scale_exporter を install しないことは当初からの非目標。維持する
- 相手の LaunchAgent を重複管理しない
- **未解決**: exporter が自身のスケジュールで動くと、当方 pipeline からの呼び出しと二重取得になる。
  案A（pipeline は取得を呼ばず出力済み JSONL を消費）／案B（従来どおり pipeline が呼ぶ）のどちらを前提にするかを
  先方へ照会中。Slice 2 の前提がこれに依存する

---

## Bun単一バイナリ化方針（Ph.11〜Ph.13、2026-07-05更新）

目的: ソースコードはNode.js API互換のTypeScriptを維持しつつ、**このプロジェクトが配布・運用するアプリの正式な形態を`bun build --compile`による単体実行バイナリとする**（2026-07-05、ユーザー指示によりPh.11の「追加オプション」方針から拡張）。詳細な選択肢の検討・却下理由は [decisions/2026-07-05T102021_Bun_CLI化についての検討書.md](./decisions/2026-07-05T102021_Bun_CLI化についての検討書.md) と [decisions/2026-07-05T105321_単一バイナリ化_bun_buildを正式な配布形態にする検討書.md](./decisions/2026-07-05T105321_単一バイナリ化_bun_buildを正式な配布形態にする検討書.md) を参照。

### 維持するもの

- ソースコードはNode.js API互換のTypeScript（Bun固有API不使用）
- 開発・型検査・ユニットテスト（`npm run typecheck` / `npm test`）はNode.jsツールチェインのまま
- `npm run build:node && node dist/index.js`は開発・デバッグ用の経路として残す（運用上の正式手順ではなくなる）

### 正式化するもの

- `bun build --compile`による単体実行バイナリ（`build:bun`スクリプト、出力名`scale2sheet`。Ph.13で`scale2sheet-bun`から改名）を正式な配布成果物とする
- `scripts/run-pipeline.sh`のlaunchd実行対象を、Node実行からコンパイル済み単体バイナリへ切り替える（完了、PR #12）
- READMEの「インストール」手順の主経路をBunバイナリのビルド・配置に更新する（Node実行手順は開発者向け代替として残す。Ph.13で正式に「Bunが優先」と明記する）

### 実装優先順位・進捗

1. ~~ブロッカー確認: コンパイル済みバイナリでzodスキーマ検証（`config/settings.ts`, `config/env.ts`, `sources/scale-exporter/reader.ts`）が正しく動くか切り分け~~ → **解消済み**。`bunx --bun vitest run --run`実行時のみ`z.object`が`undefined`になる問題（下記）を確認したが、`bun build --compile`で生成した実バイナリでは再現しない（PR #11レビュー時点で確認）。バイナリ側の対応は不要と判断
2. `build:bun`パイプラインの整備、隔離環境でのsmoke test → **完了**（PR #11）
3. `scripts/run-pipeline.sh` / launchd plistをコンパイル済みバイナリ呼び出しへ切り替え → **完了**（PR #12。plistは`run-pipeline.sh`経由のため変更不要と確認）
4. README/EXTERNAL_DESIGN.mdの更新、バイナリ名変更（Ph.13） → **進行中**
5. 受け入れテスト（AT-01〜AT-18相当）をコンパイル済みバイナリ経路で再確認、ACCEPTANCE_TEST_REPORT.md更新 → 未着手

### 実装フェーズで検証すること（受け入れ基準）

- 既存のvitestスイート（37テスト）が、Bunランタイム上での実行でも通過すること。確認コマンドは `bunx --bun vitest run --run` を使う（`--bun`を付けない`bunx vitest run --run`はshebang経由でNode側にフォールバックする場合があり、Bunランタイムでの実行を保証しない）
- **既知の残存事象（バイナリの対応は不要と判断済み）**: `bunx --bun vitest run --run`実行時に`z.object`が`undefined`になり4スイートがFAILする（zodとBunの`vitest`実行経路上の相互運用性に起因、PR #9レビューで確認）。ただし`bun build --compile`で生成した実バイナリでは同事象は再現せず（PR #11レビューで確認）、コンパイル済みバイナリ側での修正は不要。開発時のNode.jsツールチェイン（`npm test`）は影響を受けないため、この事象を理由に開発フローを変更する必要はない
- `bun build --compile`で生成した単体バイナリが、隔離環境で正常に起動・終了すること（**確認済み**、`scripts/run-bun-binary-smoke.sh`、PR #11）。具体的には次の条件で実データ・実Spreadsheetへの書き込みが発生しないことを確認する:
  - `HOME`を空の一時ディレクトリに差し替える（`~/.config/scale2sheet/`の実設定・認証情報を読ませない）
  - `SCALE_EXPORTER_OUTPUT_DIR`を空の一時ディレクトリに向ける（scale_exporterの実出力を読ませない）
  - 例: `HOME=<一時dir> SCALE_EXPORTER_OUTPUT_DIR=<空の一時dir> <compiled-binary> run --period morning --source scale-exporter` を実行し、"No spreadsheet row updated." 相当の出力で正常終了することを確認する
- 特に`googleapis`が`--compile`のバンドル過程で問題を起こさないこと → **確認済み**（`scripts/run-bun-binary-smoke.sh`のSheets認証欠如ケースが期待通り失敗することで、`googleapis`のロードとエラーパスがバイナリ内で機能していることを確認）

---

## Bunを優先実行環境にする方針（Ph.13、2026-07-05計画）

目的・詳細な選択肢の検討は [decisions/2026-07-05T152943_Bunを優先実行環境にしバイナリ名をscale2sheetにする検討書.md](./decisions/2026-07-05T152943_Bunを優先実行環境にしバイナリ名をscale2sheetにする検討書.md) を参照。要点:

- バイナリ名を`scale2sheet-bun`から`scale2sheet`へ変更する（`build:bun`スクリプトの`--outfile`、`scripts/run-pipeline.sh`の参照先を追従）
- READMEの実行手順は、Bun手順（`bun build --compile` → `./dist/scale2sheet`）を主経路として先頭に、Node.js手順（`npm run build:node && node dist/index.js`）を開発・デバッグ用の代替として後段に配置する
- EXTERNAL_DESIGN.md/ARCHITECTURE_DESIGN.mdにも、配布・実行環境としてBunを優先する旨を明記する
- 開発・型検査・テストのツールチェイン（`npm test` / `npm run typecheck`、vitest）は変更しない（理由は検討書参照）

---

## 受け入れテスト

CLI（`scale2sheet run --period <morning\|evening> [--source <source>] [--date <YYYY-MM-DD>]` / `scale2sheet serve` / `scale2sheet auth`）に対応したテストケース。実装済みテストは `test/` 配下（`cli`, `config`, `domain`, `scale-exporter`, `service`, `sheets`, `apple-health`）を参照。

各ケースの詳細な実行手順・検証方法は [EXTERNAL_TEST_DESIGN.md](./EXTERNAL_TEST_DESIGN.md)、ユニットテストとの対応は [INTERNAL_TEST_DESIGN.md](./INTERNAL_TEST_DESIGN.md)、実施結果は [ACCEPTANCE_TEST_REPORT.md](./ACCEPTANCE_TEST_REPORT.md) を参照。

### 正常系

| ID | 操作 | 前提条件 | 期待結果 |
|----|------|---------|---------|
| AT-01 | `scale2sheet run --period morning` | 当日 05:00–12:00 に scale_exporter 出力あり | 体重を含む最新値がSpreadsheet当日行の朝列へ書き込まれる |
| AT-02 | `scale2sheet run --period evening` | 当日 20:00–23:30 に scale_exporter 出力あり | 同上（夜列） |
| AT-03 | `scale2sheet run --period morning --date 2026-06-27` | 指定日のファイルあり | 指定日を対象に転記される |
| AT-04 | `scale2sheet run --period morning --source google-fit` | Google Fit OAuth 認証済み | Google Fit から直接取得して転記される |
| AT-05 | `scale2sheet serve` | `morning-cron` / `evening-cron` 設定済み | 指定時刻に自動実行される |
| AT-06 | `scale2sheet auth` | Google Fit クレデンシャル未取得 | installed app OAuth フローが起動し、トークンが保存される |

### 異常系・境界値

| ID | 操作 | 前提条件 | 期待結果 |
|----|------|---------|---------|
| AT-07 | `scale2sheet run --period morning` | 対象時間帯に体重測定値なし | Spreadsheet は更新せず正常終了（exit code 0） |
| AT-08 | `scale2sheet run --period evening` | 対象時間帯に体重以外（体温等）はあるが体重なし | 転記しない（体重必須アンカーのため） |
| AT-09 | `scale2sheet run --period morning` | `~/Documents/scale_exporter` にディレクトリ・当日ファイルなし | 空配列扱い、正常終了 |
| AT-10 | scale_exporter出力に不正JSON行・スキーマ違反あり | 該当ファイル読込 | ファイル名・行番号つきエラーで失敗（黙って捨てない） |
| AT-11 | 連番ファイル境界で同一測定値が重複 | `_001.jsonl` / `_002.jsonl` にまたがる重複あり | `(measuredAt, kind, value, source)` 完全一致で重複除去される |
| AT-12 | `scale2sheet run --period invalid` | - | 引数エラー、exit code 非ゼロ |
| AT-13 | Sheets の対象日行が見つからない | `月日` 列に当日行なし | エラーログ出力、書き込みなし、`false` を返す |

### 設定ファイル

| ID | 操作 | 前提条件 | 期待結果 |
|----|------|---------|---------|
| AT-14 | `scale2sheet run --period morning`（引数なし） | `~/.config/scale2sheet/settings.json` 未存在 | 既定値で自動生成され、その値で実行される |
| AT-15 | 同上 | `settings.json` に `source: "google-fit"` 設定済み | `--source` 省略時は settings.json の値が既定になる |
| AT-16 | 環境変数 `GOOGLE_SHEET_ID` を設定 | `settings.json` にも `sheet-id` 設定済み | 環境変数が優先される |

### 出力（Spreadsheet 書き込み）

| ID | 検証内容 | 期待結果 |
|----|---------|---------|
| AT-17 | 複数ソースが混在した場合の内部モデル | `LatestMeasurementSet.source` が `mixed` になる（Spreadsheetへは列として書き込まれない） |
| AT-18 | 列名に半角/全角括弧付き血圧表記 | `血圧(上)` / `血圧(下)` 形式のヘッダも認識される |

---

## 参考リンク

- [scale_exporter リポジトリ](https://github.com/kappaseijin/scale_exporter)
- [scale_exporter/PLAN.md](https://github.com/kappaseijin/scale_exporter/blob/main/PLAN.md)
- [scale_exporter/GOOGLE_FIT_MIGRATION.md](https://github.com/kappaseijin/scale_exporter/blob/main/GOOGLE_FIT_MIGRATION.md)

---

## 開発体制：エージェント構成（herdr + agmsg、2026-07-03 確立）

運用の正本は `/Users/kappa/Dropbox/data/dev/codex_monitor_agents/README.md`。本プロジェクト固有の構成は以下。

### 構成

- **agmsg チーム**: `scale2sheet`（チーム = プロジェクト。他プロジェクトへはアクセスしない）
- **herdr**: default セッション（ghostty）内の workspace `scale2sheet`

| 役割 | agmsg 名（= herdr タブラベル） | 作業ディレクトリ | GitHub |
| --- | --- | --- | --- |
| pm | scale2sheet_pm_claude | 本リポジトリ（dev/scale2sheet） | kappaseijin4claude |
| innovator | scale2sheet_innovator_claude | codex_monitor_agents/scale2sheet-innovator-claude | kappaseijin4claude |
| architect | scale2sheet_architect_codex | codex_monitor_agents/scale2sheet-architect | kappaseijin4codex |
| programmer | scale2sheet_programmer_codex | codex_monitor_agents/scale2sheet-programmer | kappaseijin4codex |
| reviewer（codex 作成物の検証） | scale2sheet_reviewer_claude | codex_monitor_agents/scale2sheet-reviewer-claude | kappaseijin4claude |
| reviewer（Claude 作成物の検証） | scale2sheet_reviewer_codex | codex_monitor_agents/scale2sheet-reviewer-codex | kappaseijin4codex |
| worker | scale2sheet_worker_codex | codex_monitor_agents/scale2sheet-worker | kappaseijin4codex |

### herdr 配置（2026-08-02 改訂・1エージェント = 1専用タブ）

旧 3-pane 分割レイアウトの検討経緯: [decisions/2026-07-05T224500_herdr_pane配置についての検討書.md](./decisions/2026-07-05T224500_herdr_pane配置についての検討書.md)（体制改編前の記録）

default セッション内の workspace `scale2sheet`（ラベルで識別。workspace ID / pane ID は再作成で変わるため `herdr agent list` で都度取得する）。
**1 エージェント = 1専用タブ**とし、タブラベルは派生名をそのまま使う。
エージェントの pane を他エージェントのタブへ置かない。監視用 pane はエージェント専用タブに混在させず、専用の `scale2sheet_monitor` タブへ置く。

```text
各エージェント専用タブ                 監視タブ
┌──────────────┐                      ┌──────────────────────┐
│ pm           │                      │ watch:agmsg           │
└──────────────┘                      ├──────────────────────┤
┌──────────────┐                      │ watch:agents          │
│ programmer   │                      └──────────────────────┘
└──────────────┘
```

- `scale2sheet_monitor` の上 pane = `~/.agents/bin/agmsg-watch-stream.sh scale2sheet 10`（agmsg の往復を新着だけ 1 行ずつ追記）
- `scale2sheet_monitor` の下 pane = `~/.agents/bin/herdr-watch-agents.sh <wID> 5`（全席の稼働状況。`blocked` を赤で警告）
- **上下を逆にしない**。メッセージ流は新着が pane 下端から上がるため、一覧を*下*に置くと
  最新メッセージと一覧が隣接し目線の移動が最小になる
- 監視タブの構築は `pane split <monitor pane> --direction down --ratio 0.76` とする

```sh
$H pane split <monitor pane> --direction down --ratio 0.76 --no-focus
$H pane rename <monitor pane> watch:agmsg;  $H pane rename <下pane> watch:agents
$H pane run <monitor pane> '~/.agents/bin/agmsg-watch-stream.sh scale2sheet 10'
$H pane run <下pane> '~/.agents/bin/herdr-watch-agents.sh <wID> 5'
```

```sh
H=~/.local/bin/herdr
AG=/Users/kappa/Dropbox/data/dev/codex_monitor_agents

# workspace（無ければ作成。あれば再利用）
$H workspace list
$H workspace create --cwd ~/Dropbox/data/dev/scale2sheet --label scale2sheet --no-focus

# 各エージェント: tab create → agent start --tab → 空の root pane を close
$H tab create --workspace <wID> --label scale2sheet_pm_claude
$H agent start scale2sheet_pm_claude --cwd ~/Dropbox/data/dev/scale2sheet \
  --tab <tabID> --no-focus \
  -- ~/.local/bin/claude "/agmsg actas scale2sheet_pm_claude"
$H pane close <root pane_id>

# codex 側の例（architect）。エージェントごとに tab create からやり直す
$H tab create --workspace <wID> --label scale2sheet_architect_codex
$H agent start scale2sheet_architect_codex --cwd $AG/scale2sheet-architect \
  --tab <architect の tabID> --no-focus \
  -- ~/.agents/bin/codex -p architect "/agmsg actas scale2sheet_architect_codex"
$H pane close <architect タブの root pane_id>
```

- 常駐は **pm / programmer / reviewer_claude** のみ。innovator / architect / reviewer_codex / worker は案件ごとに起動し、受け渡し後にタブを閉じる
- タブの最後の pane を閉じるとタブごと消えるため、再起動は `tab create` からやり直す
- 前提: 各エージェントディレクトリの agmsg delivery mode が `monitor` であること（`delivery.sh status <type> <dir>` で確認。off のまま起動するとブリッジ無しになる）
- codex 側は `delivery.sh set monitor codex <dir>` 実行後に hooks の trust プロンプトが出るため、起動中のセッションは一度落として再 actas する

### 開発フロー

1. PR は**作成者と別ロールかつ別ベンダー**がレビューし、GitHub の Approve 機能で承認する。GitHub アカウントも分離する（4claude / 4codex）。7役割内の担当は以下で固定する

   | PR の作成者 | レビュー・approve 担当 | GitHub アカウント |
   | --- | --- | --- |
   | `scale2sheet_architect_codex`（設計書・検討書） | `scale2sheet_reviewer_claude` | kappaseijin4claude |
   | `scale2sheet_programmer_codex`（実装） | `scale2sheet_reviewer_claude` | kappaseijin4claude |
   | `scale2sheet_worker_codex`（定型作業） | `scale2sheet_reviewer_claude` | kappaseijin4claude |
   | `scale2sheet_pm_claude`（PLAN / NOTES） | `scale2sheet_reviewer_codex` | kappaseijin4codex |
   | `scale2sheet_innovator_claude`（目標定義） | `scale2sheet_reviewer_codex` | kappaseijin4codex |

   **レビューは常に reviewer が担う**（`~/.agents/rules/agent-role.rule.md`）。reviewer をベンダー別に
   2名（claude / codex）置くことで、「PR レビュー = reviewer」「生産者と検証者は別ロールかつ別ベンダー」
   「approve は別 GitHub アカウント」の3条件を同時に満たす。architect / programmer は検証者を兼務しない
   （2026-07-28、ユーザー決定により reviewer を分割）

   **PR の作成者アカウントも分離する**。GitHub は自分が作成した PR への approve / request changes を
   拒否するため、コミットの author を分けるだけでは足りない。codex 成果物の PR は
   `GH_CONFIG_DIR=~/.config/gh-4codex` で、Claude 成果物の PR は `~/.config/gh-4claude` で作成する。
   pm が代理作成する場合も、**成果物の作成者側のアカウントを使う**
   （2026-07-29、pm が 4claude で codex 成果物の PR を作り reviewer_claude が判定を出せなくなった事故に基づく）
2. PR 定型作業は `codex_monitor_agents/bin/pr-flow.sh`（作成/approve/merge/finish/status）
3. エージェント間連絡は agmsg（配送停滞は agmsg-watchdog が自動修復・通知）
4. エージェントの起動・監視は herdr CLI（`agent start/list/read/wait`）。
   `pane run` は**日本語を含むコマンドでは文字化けする**ため、エージェントへの指示送信には使わず
   `agent send` を使う。ASCII のみの監視スクリプト起動（上記 watch 系）には `pane run` を使ってよい
5. 席の移動は `pane move <pane> --new-tab --workspace <wID> --label <役割>`（元タブが空になれば自動で閉じる）。
   `pane read` は画面クリアするスクリプトでは空に見えるため `--format ansi` で確認する
6. `AGMSG_SPAWN_WORKSPACE` は**ラベルではなく workspace ID**（`w29` 等）を渡す。ラベルだと `workspace_not_found` になる。
   `spawn.sh` は `--project` 既定値が `$PWD` のため、**必ず対象クローンを `--project` で明示する**
   （省略すると pane の cwd が本リポジトリになり、agmsg 登録にも重複エントリが増える）

### 構築（再現手順の要点）

1. 専用クローン作成（1 役割 = 1 ディレクトリ）。git は origin の SSH エイリアス github.com-kappaseijin4{claude,codex} と `user.name` / `user.email` で分離。gh API は `GH_CONFIG_DIR=~/.config/gh-4{claude,codex}`
2. agmsg 登録: `AGMSG_RESOLVE_PROJECT=0 join.sh scale2sheet <派生名> <claude-code|codex> <dir>`（**`AGMSG_RESOLVE_PROJECT=0` は必須**。付けないと渡したパスが既存登録へ吸われる）
3. `delivery.sh set monitor <type> <dir>` を全ディレクトリで実行する。`<type>` は claude 系なら `claude-code`、codex 系なら `codex`
4. herdr 配置は上記「herdr 配置」節のとおり `tab create --label <派生名>` → `agent start --tab <tabID>`（`--workspace` 指定の旧手順は使わない）

詳細・トラブルシューティングは codex_monitor_agents/README.md を参照。

## エージェント実行ポリシー（モデル・effort）

**正本は `~/.agents/rules/model-orchestration.rule.md`**。本書はモデル配置を再定義せず、正本を参照する
（上の「担当エージェント」表に載せた model / effort は、正本の値を読みやすさのために転記したもの。
食い違った場合は正本が優先する）。

- トークン制限に達した場合のフォールバック先は本書では定義しない。制限時の切替は**正本および各エージェントの人格設定（`AGENT.md` / `~/.codex/<role>.config.toml`）に従い、承認不要で実行する**。正本に定義が不足している場合は、正本側の更新をユーザー決定として起票する（本書で暫定値を定義しない）
- reviewer のモデルは正本上「`claude-opus-5`、対抗案 `claude-sonnet-5` を A/B で確定」の段階にある。確定するまで対抗案を既定として扱わない
- `scale2sheet_reviewer_codex` は正本に codex 側 reviewer の定義が無いため `gpt-5.6-terra` / medium を**暫定**とする。正本（`model-orchestration.rule.md`）への追記はユーザー決定事項として起票済み
- 制限解除の確認と復帰は承認不要で自動実行してよい

---

## 検討書ワークフロー（2026-07-04 導入・恒久ルール）

**計画書（本書のような `PLAN.md` 等）を新規作成・大幅改訂する際は、必ず以下の手順を踏む。**

1. **検討書を先に作成する**
   - 場所: `./decisions/`
   - ファイル名: `yyyy-mm-ddThhMMSS_{何についての検討書か}.md`（例: `2026-07-04T180000_計画書構成についての検討書.md`）
   - 内容: 採用した案／却下した案／却下した理由 を明記する（フォーマットは `decisions/README.md` 参照）
2. **検討書の作成が完了したら、計画書を更新する**
   - 検討書で採用した案の内容を計画書へ反映する
3. **その後、次の作業へ進む**

**Why:** 計画上の判断がその場限りで消えず、後から「なぜその構成にしたか」「他にどんな案を検討し、なぜ却下したか」を追跡できるようにするため。
**How to apply:** 今後 `PLAN.md` 系のドキュメントを新規作成・構成変更する作業が発生したら、着手前に `decisions/` へ検討書を1つ作成してから計画書を更新する。軽微な誤字修正や日付更新など、判断を伴わない編集は対象外。
