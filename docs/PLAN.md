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

最終更新: 2026-07-04（計画書・設計書の新設、検討書ワークフロー導入）

参考: [scale_exporter/PLAN.md](https://github.com/kappaseijin/scale_exporter/blob/main/PLAN.md)（本書は scale_exporter の構成を踏襲する）

---

## 担当エージェント

`~/.agents/skills/agmsg/teams/scale2sheet/config.json` に登録済みの3層体制。

| エージェント | タイプ | 役割 |
|------------|--------|------|
| `claude_product_manager` | claude-code | プロダクト管理・計画立案・検討書/計画書の作成・PRレビュー＆承認・相談窓口 |
| `codex_senior_architect` | codex | アーキテクチャ設計・外部設計・内部設計、programmerへの実装指示、PRマージ |
| `codex_senior_programmer` | codex | コーディング（`codex_senior_architect` の指示に従う） |

### ワークフロー

```
[ユーザー]
    │ 要件・承認
    ▼
[claude_product_manager]  ← 相談・質問・承認依頼を随時受け付ける
    │ 計画・指示
    ▼
[codex_senior_architect]  ← 設計全般を担当
    │  ┌─────────────────────────────────────────┐
    │  │ 構造・手法・判断で迷った場合は          │
    │  │ claude_product_manager へ相談してよい    │
    │  └─────────────────────────────────────────┘
    │ 実装指示
    ▼
[codex_senior_programmer] ← コーディング専任
```

エージェント間の連絡は agmsg、起動・監視は herdr CLI を使う。詳細は「開発体制」を参照。

---

## Git 管理ルール

| 作業 | 担当 |
| --- | --- |
| ブランチ作成（`git switch -c <branch-name>`） | 作業を開始するエージェント |
| 設計ドキュメントのコミット | `codex_senior_architect`（作成者がコミット） |
| 実装コードのコミット | `codex_senior_programmer`（作成者がコミット） |
| 計画書・検討書・プロジェクト管理ファイルのコミット | `claude_product_manager`（作成者がコミット） |

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
| Ph.11 | Bun CLI対応 | `bun build --compile`による単体実行バイナリ（`build:bun`）、`bun run`によるソース直接実行の補助サポート。Node.js経路（`npm run build` / `node dist/index.js`）は現状維持 | **計画中**（検討書: [decisions/2026-07-05T102021_Bun_CLI化についての検討書.md](./decisions/2026-07-05T102021_Bun_CLI化についての検討書.md)） |

---

## Bun CLI対応方針（Ph.11、2026-07-05 計画）

目的: Node.jsアプリであることを維持したまま、Bunでも動くCLIアプリとして配布できるようにする。詳細な選択肢の検討・却下理由は [decisions/2026-07-05T102021_Bun_CLI化についての検討書.md](./decisions/2026-07-05T102021_Bun_CLI化についての検討書.md) を参照。

### 変更しないもの

- `npm install && npm run build && node dist/index.js` による既存の実行方法
- `scripts/run-pipeline.sh` / `scripts/launchd/*.plist` によるlaunchd自動実行（引き続き`node`で実行）
- ソースコードはNode.js専用API（`Bun.file`等のBun固有API）に依存させない

### 追加するもの

- `package.json`に`build:bun`スクリプトを追加: `bun build ./src/index.ts --compile --outfile dist/scale2sheet-bun`（単体実行バイナリ）
- 補助的に`bun run src/index.ts`でのソース直接実行もサポート（ビルド不要な動作確認用）
- README/EXTERNAL_DESIGN.mdにBun版のインストール・実行手順を追記

### 実装フェーズで検証すること（受け入れ基準）

- 既存のvitestスイート（37テスト）が、Bunランタイム上での実行でも通過すること
- `bun build --compile`で生成した単体バイナリが、少なくとも`run --period morning --source scale-exporter`（stdout確認・実データ書き込みなし相当の検証）で正常に起動・終了すること
- 特に`googleapis`が`--compile`のバンドル過程で問題を起こさないこと（依存の中で最もリスクが高いため個別に確認する）

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

| 役割 | agmsg 名 / herdr 名 | 作業ディレクトリ | GitHub |
| --- | --- | --- | --- |
| PM・レビュー | claude_product_manager | 本リポジトリ（dev/scale2sheet） | kappaseijin4claude |
| 設計・マージ | codex_senior_architect / s2s_architect | codex_monitor_agents/scale2sheet-architect（専用クローン） | kappaseijin4codex |
| 実装・レビュー | codex_senior_programmer / s2s_programmer | codex_monitor_agents/scale2sheet-programmer（専用クローン） | kappaseijin4codex |

### 開発フロー

1. PR は作成した LLM と別の LLM がレビューし、GitHub の Approve 機能で承認（Claude 作成→codex 承認、codex 作成→Claude 承認）
2. PR 定型作業は `codex_monitor_agents/bin/pr-flow.sh`（作成/approve/merge/finish/status）
3. エージェント間連絡は agmsg（配送停滞は agmsg-watchdog が自動修復・通知）
4. エージェントの起動・監視は herdr CLI（`agent start/list/read/wait`。pane への `pane run` は bash 3.2 で文字化けするため使わない）

### 構築（再現手順の要点）

1. 専用クローン作成 → `delivery.sh set monitor codex <dir>` → agmsg `join.sh`（チーム=プロジェクト、1ディレクトリ1codex）
2. `herdr agent start <herdr名> --cwd <dir> --workspace <wID> -- ~/.agents/bin/codex "/agmsg actas <agmsg名>"`
3. git は各クローンの origin（SSH エイリアス github.com-kappaseijin4{claude,codex}）と user.name/email で分離。gh API は `GH_CONFIG_DIR=~/.config/gh-4{claude,codex}`

詳細・トラブルシューティングは codex_monitor_agents/README.md を参照。

## エージェント実行ポリシー（モデル・effort 階層、2026-07-04）

各エージェントは優先順で起動し、トークン制限時に次段へ自動遷移する。正本: `/Users/kappa/Dropbox/data/dev/fable5/README.md`。

| エージェント | 第1優先 | 制限時フォールバック |
| --- | --- | --- |
| claude_product_manager | Fable 5（claude-fable-5）＋ effort low | Opus 最高（claude-opus-4-8）＋ effort low |
| codex_senior_architect | Codex ＋ effort ultra high（xhigh） | Codex ＋ effort low |
| codex_senior_programmer | Codex ＋ effort low | Codex ＋ effort low |

- フォールバック後は約30分間隔で制限解除を確認し、解除されていればプライマリへ自動復帰する。
- 承認不要でフォールバック・復帰を自動実行してよい。

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
