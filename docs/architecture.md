# scale2sheet Architecture

## 目的

scale2sheet は、朝・夜の身体測定値を scale_exporter の出力 JSONL ファイル（推奨・デフォルト）、Google Fit REST API、または Apple Health XML エクスポートから取得し、Google Spreadsheet の既存当日行へ転記する TypeScript サービスである。Node.js 上で完結し、OS 固有 API、ネイティブバインディング、LLM、外部推論サービスは使わない。

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
- `sources/scale-exporter`（2026-07-02 追加・デフォルト）
  - scale_exporter が出力した当日分の JSONL ファイル群を読み、domain model へ変換する。
  - 詳細は「scale_exporter ファイル入力」を参照。
- `sources/google-fit`（非推奨: Google Fit API は 2026 年末で終了。scale_exporter/GOOGLE_FIT_MIGRATION.md 参照）
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
  - 期間内の体重を必須アンカーとし、朝は最も早い体重、夜は最も遅い体重を採用する。体重がない場合は Spreadsheet へ転記しない。
  - 体温、血圧上、血圧下、脈拍は、採用した体重の測定時刻に最も近い同種別レコードを採用する。Spreadsheet row の日時も採用体重の `measuredAt` を使う。
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

## scale_exporter ファイル入力（2026-07-02 追加）

Google Fit REST API の廃止（2026 年末）に伴い、API 直接取得に代えて scale_exporter の出力ファイルを入力とする。`--source scale-exporter` がデフォルト。

### 入力仕様

- 読み込み先: `SCALE_EXPORTER_OUTPUT_DIR`（デフォルト `~/Documents/scale_exporter`、`~` は展開する）
- 対象ファイル: `scale_exporter_{YYYY-MM-DD}_{apple-health|google-fit}_{seq}.jsonl`
  - 対象日は referenceTime を `TIME_ZONE` で解釈した日付
  - 両ソース・全連番（`_001` 以降すべて）を読む。1 ファイル最大 100 件で分割されている
- 行形式: `{"measuredAt": ISO8601, "kind", "value", "unit", "source"}`

### 変換規則

| exporter kind | domain kind | exporter source | domain source |
| --- | --- | --- | --- |
| `weight` | `weight` | `apple_health` | `apple_health_export` |
| `bodyTemperature` | `body_temperature` | `google_fit` | `google_fit` |
| `bloodPressureSystolic` | `blood_pressure_systolic` | | |
| `bloodPressureDiastolic` | `blood_pressure_diastolic` | | |
| `heartRate` | `pulse` | | |

単位（kg / celsius / mmHg / bpm）は同名のまま。

### 動作規則

- 連番ファイル境界の重複に備え、(measuredAt, kind, value, source) 完全一致で重複除去する
- ディレクトリ不存在・対象日のファイルなし → 空配列を返す（service 側が「体重なし」として転記しない）
- 不正な JSON 行・スキーマ違反 → ファイル名と行番号つきでエラーにする（黙って捨てない）
- 朝・夜の時間帯フィルタと体重アンカー選択は従来の service ロジックをそのまま使う

## 設定ファイル構造（2026-07-02 改定・scale_exporter 標準に統一）

設定は scale_exporter と同じ `~/.config/<アプリ名>/` 構造を標準とする。`.env` / 環境変数は上書き用として残る（優先順位: 環境変数 > settings.json > 既定値）。

### `~/.config/scale2sheet/settings.json`（非シークレット設定・初回実行時に自動生成）

```json
{
  "time-zone": "Asia/Tokyo",
  "source": "scale-exporter",
  "sheet-id": "<スプレッドシートID>",
  "sheet-name": "体温・血圧",
  "sheets-credentials": "~/.config/scale2sheet/google-sheets-service-account.json",
  "scale-exporter-output-dir": "~/Documents/scale_exporter",
  "morning-cron": "0 7 * * *",
  "evening-cron": "0 21 * * *"
}
```

- キーは scale_exporter の settings.json と同じ kebab-case
- `source` は CLI `--source` 省略時の既定値になる
- パス値の先頭 `~` は展開する

### 認証ファイル（シークレット・自動生成しない）

| ファイル | 内容 |
| --- | --- |
| `~/.config/scale2sheet/google-sheets-service-account.json` | Google Sheets 用サービスアカウント鍵（`sheets-credentials` で場所変更可） |
| `~/.config/scale2sheet/google-fit-credentials.json` | Google Fit OAuth クライアント（`client_id` / `client_secret` / 任意 `redirect_uri`。scale_exporter と同形式） |
| `~/.config/scale2sheet/google-fit-token.json` | Google Fit トークン（`GOOGLE_FIT_TOKEN_PATH` で変更可） |

### 優先順位と後方互換

1. 環境変数（`.env` 含む）が最優先 — 既存の運用はそのまま動く
2. settings.json
3. 組み込み既定値

`GOOGLE_FIT_CLIENT_ID` / `GOOGLE_FIT_CLIENT_SECRET` が環境変数に無い場合は `google-fit-credentials.json` から読む。

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

- effort 対応: 「ultra high」= xhigh。
- claude 側は settings.json の model/fallbackModel と effortLevel:low で自動フォールバック。codex 側は herdr 起動時の model/effort フラグで制御。
