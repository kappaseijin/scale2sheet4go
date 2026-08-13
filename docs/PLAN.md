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

最終更新: 2026-08-13T17:28:29+09:00（Issue #14 の Go 入力異常ポリシー決定準備を反映）

参考: [scale_exporter/PLAN.md](https://github.com/kappaseijin/scale_exporter/blob/main/PLAN.md)（本書は scale_exporter の構成を踏襲する）

---

## 担当エージェント

### 現行パイロット運用（Issue #1）

通常の実装作業は一つの派生エージェントで進め、ユーザーとの対話を最小限にする。
複数の実装方法がある場合、または決断条件が不足する場合は、派生席が独断せずユーザーへ確認する。
課題はすべて GitHub Issue に起票し、1 Issue = 1 課題 = 1 PR とする。
Go 製品移植は [Issue #2](https://github.com/kappaseijin/scale2sheet4go/issues/2) の専用課題であり、本 Issue #1 の運用資料変更へ混ぜない。

現在の agmsg roster は `kappa (agmsg-app)` と `scale2sheet_owner_codex` であり、製品作業を担う派生席は後者の一席である。
主人格 `codex_product_owner` はチームへ直接登録せず、派生席へ継承する。

| 項目 | 内容 |
| --- | --- |
| 主人格 | `codex_product_owner`（`gpt-5.5-terra` / effort `max`） |
| 派生席 | `scale2sheet_owner_codex`（Issue 選択・資料・実装・計測・テスト・Go ポート） |
| 対向 LLM | 配置しない。派生席がテスト・静的検査・目的確認を実施する |
| 連絡 | agmsg。チーム外連絡が必要な場合は manager 同士のみ |

### GitHub 操作アカウント（Issue #20）

このパイロットで主人格または派生席が行う GitHub 操作は、ユーザー指定の
`kappaseijin4codex` アカウントへ統一する。

| 対象 | GitHub アカウント | 実行条件 |
| --- | --- | --- |
| 主人格 `codex_product_owner` | `kappaseijin4codex` | `GH_CONFIG_DIR="$HOME/.config/gh-4codex"` を付けて `gh` を実行する |
| 派生席 `scale2sheet_owner_codex` | `kappaseijin4codex` | 同上。Issue、PR、push、merge をこの経路で行う |

- `gh auth status` は `GH_CONFIG_DIR="$HOME/.config/gh-4codex"` で確認し、既定の `kappaseijin` 設定へフォールバックしない。
- Git の `origin` は `git@github.com-kappaseijin4codex:kappaseijin/scale2sheet4go.git` を使用する。
- 対向 LLM エージェントは配置しないため、レビュー席の追加や別アカウントへの経路変更はこの方針の対象外であり、必要になった場合は別 Issue とする。

詳細な定義と実施証跡は [Issue #1 計画](./superpowers/plans/2026-08-13-pilot-operation-policy.md) と `docs/NOTES.md` を参照する。

### 過去の複数席構成（履歴）

`team.sh scale2sheet` で 2026-08-10 に実測したエージェント登録は、pm 1 席と architect / programmer / reviewer / worker の 4 席を合わせた **5 席**である。
同じ出力に含まれる `kappa (agmsg-app)` は配送アプリであり、担当席の数に含めない。

命名規約は `<プロジェクト名>_<役割>_<ベンダー>`（`~/.agents/rules/agent-team.rule.md`）。
主人格（`claude_product_manager` / `codex_senior_architect` 等）は**派生元の定義であって、チームへ直接登録する識別子ではない**。
各エージェントは **scale2sheet チームのみ**に所属し、他プロジェクトを跨がない。
役割名は **pm** を正式名とする（`manager` は pm のエイリアス。グローバルの `agent-role.rule.md` は manager 表記だが同一の役割を指す）。

| エージェント | タイプ | モデル / effort | 常駐 | 役割 |
|------------|--------|------|------|------|
| `scale2sheet_pm_claude` | claude-code | `claude-opus-5` / low | 常駐 | ユーザー窓口・他プロジェクトの pm との窓口・提示と承認の中継・PLAN/NOTES 記録 |
| `scale2sheet_architect_codex` | codex | `gpt-5.6-sol` / xhigh | 短命 | 調査・検討書/設計書の起草（アーキテクチャ・外部・内部・テスト設計） |
| `scale2sheet_programmer_codex` | codex | `gpt-5.6-terra` / medium | 常駐 | 実装・計測・スクリプト化（TypeScript / vitest） |
| `scale2sheet_reviewer_claude` | claude-code | `claude-opus-5` / xhigh | 常駐 | 敵対的検証（定量主張の独立再集計・決定前レビュー・PR レビュー）。**作成者のベンダーを問わず本席が担当する** |
| `scale2sheet_worker_codex` | codex | `gpt-5.6-luna` / low | 短命 | 設計判断を伴わない定型作業 |

innovator は役割として定義されているが、実測時点では agmsg に登録されていない。
必要時に短命席として別途登録し、上表には登録後に加える。

人格差分は `codex_monitor_agents/<派生名>/AGENT.md`、プロジェクト固有の差分と kaizen は同 `projects/scale2sheet/` に置く。

### ワークフロー

```text
ユーザー → pm → innovator → architect & programmer → reviewer
             ↑（提示・承認の中継のみ）        └──────────┘（直接往復・pm を経由しない）
```

- **決定権はユーザー**。pm は決定者ではなく提示者であり、**決定しない・起草しない・検証しない・案を出さない**
- innovator → architect → programmer → reviewer の実務往復は当事者間で直接行い、pm を経由しない
- 起草者は自分の起草物を検証しない。**生産者と検証者は必ず別ロール**とする
- **reviewer は `scale2sheet_reviewer_claude` の 1 席が既定**。作成者のベンダーを問わず本席が検証する
- `scale2sheet_reviewer_codex` は**フォールバック専用**。Claude がトークン上限・利用上限・障害で利用不能な場合に限り、pm が代替不能を記録したうえで起動する。前提が解けたら閉じる。常設席ではない（2026-08-03 ユーザー決定）
- 短命セッション（innovator / architect / worker）は案件ごとに起動し、成果物の受け渡しでタブを閉じる

エージェント間の連絡は agmsg、起動・監視は herdr CLI を使う。詳細は「開発体制」を参照。

### 現行 Go ポート（Issue #2）

Issue #2 は既存 scale2sheet の外部契約を Go へ移植する一つの課題であり、一つの PR で完了させる。実装対象は `cmd/scale2sheet` と `internal/` の Go パッケージ、Go unit/integration test、Go バイナリを実行する acceptance harness、利用者向け README である。

```mermaid
flowchart LR
  A["Go source"] --> B["CGO_ENABLED=0 go build"]
  B --> C["single binary"]
  C --> D["unit / vet / acceptance"]
  D --> E["README + design docs"]
  E --> F["Issue #2 single PR"]
```

現時点の既定検証は `CGO_ENABLED=0 go test ./...`、`go vet ./...`、`scripts/run-*-acceptance.sh` である。対向 LLM reviewer は配置せず、`scale2sheet_owner_codex` が目的妥当性、差分、テスト、静的検査、負のコントロールを自己確認する。macOS の cgo linker による `dyld: missing LC_UUID` が確認されたため、Go 検証は cgo 無効で再現可能にする。

### 現行 Go 正本ツールチェーン（Issue #4）

Issue #4 で `go.mod` / `go.sum` と Go CLI（`gofmt`、`go build`、`go test`、`go vet`）を正本にする。README と現行 acceptance は npm、Bun、Node の実行を要求しない。旧 TypeScript 資産に関する過去の記述は履歴として保持し、現行の利用者経路とは区別する。

### 現行 Go 開発品質ゲート（Issue #5）

Issue #5 では `scripts/check-go-quality-gates.sh` をローカルと GitHub Actions の共通入口にする。
`gofmt`、`go mod verify`、`go test -count=1 ./...`、`go vet ./...`、`go build`、Go toolchain 契約の順に実行し、全 Go コマンドは `GOTOOLCHAIN=local`、test/build/vet は `CGO_ENABLED=0` を使う。
CI は Darwin 固有 lease を検査できる `macos-14` runner と `actions/setup-go` の `go-version-file: go.mod` を使う。
Staticcheck、race detector、coverage は今回の必須ゲートへ追加せず、必要性が生じた場合は別 Issue で判断する。

### 現行 Go macOS 本番運用（Issue #6）

Issue #6 では macOS 13+ の app-bundle 前提の `SMAppService` へ移行せず、現行の GUI を持たない Go CLI に適合する per-user LaunchAgent (`~/Library/LaunchAgents`、`gui/<uid>` domain) を維持する。製品 artifact は `scripts/build-macos-release.sh` で `darwin/arm64` と `darwin/amd64` を `CGO_ENABLED=0`、`GOTOOLCHAIN=local`、`-trimpath` 付きで build し、`lipo` で universal 化する。

`doctor --prefix <dir>` は install と同じ prefix を解決し、manifest の prefix と binary path の整合性を検査する。README は build、dry-run、install、`launchctl print`、`launchctl kickstart -k`、`plutil -lint`、uninstall、残置ファイルまでを自己完結で説明する。pilot acceptance は ad hoc/local artifact を対象とし、Developer ID / Hardened Runtime / notarytool / stapler は [Issue #10](https://github.com/kappaseijin/scale2sheet4go/issues/10) へ分割した。

### 現行 Go macOS 公開配布（Issue #10）

Issue #10 は Issue #6 の unsigned universal Go binary を、Developer ID Application と Hardened Runtime で署名し、UDZO DMG の公証・staple・Gatekeeper 検査まで一つの公開配布経路へ固定する課題である。CLI の install/LaunchAgent 契約は変更せず、DMG 内の binary と README を既定の `~/.local/bin` へ配置してから既存の install 手順を使用する。

実装計画は [Developer ID署名とnotarytool公証の採否についての検討書](./decisions/2026-08-13T154408_Developer%20ID署名とnotarytool公証の採否についての検討書.md) と [macOS公開配布署名と公証の実装計画](./superpowers/plans/2026-08-13-macos-distribution-signing.md) に保存した。ローカルの契約 acceptance と通常 CI は secrets 無しで実行し、公開配布 workflow だけが `macos-release` environment の一時 keychain/API key を利用する。

現環境には Developer ID Application identity と GitHub secrets が無いため、Apple notary service の正常系 submit/staple/Gatekeeper 実機検査は未実施である。credentials が投入されるまで Issue #10 は open のままとし、Apple Development/ad hoc での代用成功は認めない。

### 現行 Go 受入マトリクス（Issue #13）

Issue #13 では、旧 AT-01〜AT-18 の記録を現行 Go の証跡へ対応付け、`scripts/run-go-acceptance-matrix.sh` を自動試験の正本入口として追加する。現行の分類は `AUTO_PASS`、実 Google Sheets / Google Fit / 実時刻観測が必要な `BLOCKED_EXTERNAL`、契約未決定の `BLOCKED_DECISION` に分ける。隔離 fake、blackhole、偽 credential は実サービス成功の証拠にしない。

対応表と設計判断は [Go版受入マトリクス現行化設計](./superpowers/specs/2026-08-13-go-acceptance-matrix.md)、実測結果は [ACCEPTANCE_TEST_REPORT.md](./ACCEPTANCE_TEST_REPORT.md) を参照する。AT-10a は [Issue #14](https://github.com/kappaseijin/scale2sheet4go/issues/14) でA-0へ確定し、[Go版入力異常ポリシー決定資料](./superpowers/specs/2026-08-13-go-input-policy-decision-brief.md)へ反映する。

### 現行 Go 外部受入境界（Issue #18）

AT-01〜AT-06 の実 Google Sheets／Google Fit／実時刻 `serve` は、隔離 fake の成功を根拠に `AUTO_PASS` へ昇格させない。専用 Google 検証環境を明示的に指定した場合だけ、`scripts/run-google-external-acceptance.sh` で Go binary の外部受入を再実行する。

runner は opt-in、current HOME と異なる marker 付き owner-only HOME、fixture でない Spreadsheet ID、current HOME 外の owner-only service-account JSON、専用入力、実行可能な Go binary を検査する。不足時は child binary を起動せず fail-closed する。設計は [専用検証環境向け Google 外部受入 runner 設計](./superpowers/specs/2026-08-13-google-external-acceptance.md)、計画は [Issue #18 計画](./superpowers/plans/2026-08-13-google-external-acceptance.md) に保存する。

契約テスト `bash scripts/test-google-external-acceptance.sh` は、実 Google API を呼ばずに境界と引数を検査する。実 Spreadsheet のセル、Google Fit の実データ、cron callback は手動観測が必要であり、外部環境が未提供の間は `BLOCKED_EXTERNAL` のままとする。

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

現行パイロットでは対向 LLM エージェントを配置しない。PR の目的・差分・テスト・静的検査は派生席が確認し、仕様上の決断条件が不足する場合だけユーザーへ確認する。

検査を追加または変更する PR では、`~/.agents/rules/development.rule.md` の「検査の負のコントロール」節を必須のレビュー観点として適用する。
具体的な手順と三値判定は同節を正本とし、本書へ複製しない。

---

## 概要

朝・夜の身体測定値（体重・体温・血圧上/下・脈拍）を [scale_exporter](https://github.com/kappaseijin/scale_exporter) の出力 JSONL（デフォルト・推奨）、Google Fit REST API、または Apple Health XML エクスポートから取得し、Google Spreadsheet の当日行へ転記する Go サービス。

```text
[scale_exporter] --JSONL出力--> <入力フォルダ> --読込--> [scale2sheet] --> Google スプレッドシート
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
| Ph.14 | エージェント体制の派生命名への移行 | 7役割（pm/innovator/architect/programmer/reviewer×2/worker）を `<プロジェクト名>_<役割>_<ベンダー>` で登録、専用クローンと人格差分 AGENT.md を整備、兼任・プロジェクト跨ぎを解消。reviewer をベンダー別2名に分割しレビュー経路を閉じた（reviewer は 2026-08-03 の決定により 1 席へ統合） | **完了**（2026-07-28） |
| Ph.15 | インストーラ／アンインストーラの整備 | インストール後の実行体をソースチェックアウトから独立させる（Ph.12 の未完了分の回収）。導入・撤収・診断の手段を提供し、launchd plist と run-pipeline.sh の絶対パス依存を解消する。あわせて `build` → `build:node` へ改名 | **Slice 1 完了（2026-08-02）・Slice 2 着地（PR #73）・Slice 3 着地（PR #139）・Slice 4 着地（PR #193 / #200 / #202、2026-08-10）**。Slice 1 実装根拠: src/version.ts、src/scheduler/run-lease.ts、src/installation/settings-read.ts、test/scheduler/run-lease.test.ts、test/cli/serve-lease.test.ts、scripts/run-runtime-safety-acceptance.sh。Slice 2 根拠: PR #73（input snapshot / pipeline CLI）。Slice 3 根拠: PR #139（install / 既定 uninstall / Task 1-8 実装、AC 骨格）。[目標定義](./decisions/2026-07-29T084808_インストーラとアンインストーラの目標定義.md)、[INSTALLATION_DESIGN.md](./INSTALLATION_DESIGN.md)、[実装分割](./decisions/2026-07-29T173454_インストーラ実装分割と受け入れ確認の検討書.md) |
| Ph.16 | Go ポート（Issue #2） | 既存の scale2sheet 契約を `cmd/scale2sheet` と `internal/` へ移植し、Go 単一バイナリ・unit test・vet・acceptance harness・README を正式経路にする | **完了（2026-08-13、PR #7）**。`CGO_ENABLED=0 go test ./...`、`go vet ./...`、初期 6 本の Go binary acceptance、README/文書/AC 台帳検査が PASS。現行 8 本の一括証跡は Issue #13 で固定し、旧 TypeScript 資産は比較履歴として保持する |
| Ph.17 | Go 正本ツールチェーン整理（Issue #4） | `go.mod` / `go.sum` と Go CLI を唯一の build/test/依存管理経路にし、package.json/package-lock と現行 Node fallback を除去する | **完了（2026-08-13、PR #8）**。旧 TypeScript 資産の削除、Go toolchain version policy、CI、本番 macOS 配布は別 Issue |
| Ph.18 | Go 開発品質ゲートと CI（Issue #5） | ローカルと macOS GitHub Actions が同じ標準 Go 品質ゲートを実行する | **完了（2026-08-13、PR #9）**。Staticcheck、race、coverage の必須化は別 Issue |
| Ph.19 | macOS 本番 artifact と LaunchAgent 運用（Issue #6） | universal Go binary、custom prefix doctor、per-user LaunchAgent、plist lint、状態確認、uninstall、README runbook | **完了（PR #11、2026-08-13）**。macOS CI の Go quality gates と universal artifact 検査が PASS。公開配布の署名・公証は Issue #10 |
| Ph.20 | macOS 公開配布署名と公証（Issue #10） | Developer ID Application、Hardened Runtime、署名済み UDZO DMG、notarytool submit/wait/log、staple、Gatekeeper 検査、CI secret 境界、README runbook | **実装中（credentials 未投入のため正常系は未実施）** |
| Ph.21 | 実 Google 外部受入境界（Issue #18） | 専用 HOME／credentials／Spreadsheet を fail-closed で検査し、AT-01〜AT-06 の Go binary 実行と手動観測導線を固定 | **実装中（専用外部環境未提供）** |

---

### Ph.15 の実装分割（2026-07-30 ユーザー決定・PR #27 で確定）

正本は [実装分割と受け入れ確認の検討書](./decisions/2026-07-29T173454_インストーラ実装分割と受け入れ確認の検討書.md)（status: accepted、main = 24ef0b8）。

- **U-1 = 依存順の capability slice（7本）**。案 I（単一 PR）・案 II（コマンド別 PR）は却下
- **U-2 = 直列 PR**。並行させない
- **U-3 = 連続7日観測後に legacy cleanup を別 PR**。内蔵 pipeline を先に入れ、朝夕の自動実行が7日連続で正常に回るのを確認してから `run-pipeline.sh` を削除する

| Slice | 内容 | 状態 |
| --- | --- | --- |
| 0 | 着手条件の確認（PR を作らない） | 完了（2026-08-02 全項目 PASS） |
| 1 | runtime safety foundation（APP_VERSION / read-only settings / run lease / `O_EXLOCK_DARWIN` / 最小 acceptance harness / AC 骨格） | **完了**（2026-08-02、根拠: `6bf2511 feat: add runtime safety foundation`） |
| 2 | 内蔵 pipeline の shadow path | **着地（PR #73）**（根拠: `d214648 Merge pull request #73 from kappaseijin/feat/pipeline-shadow-path`） |
| 3 | install と既定 uninstall | **着地（PR #139）**（根拠: `d1f98bc Slice 3: install / 既定 uninstall (Task 1-8) (#139)`） |
| 4 | doctor | **着地（PR #193 / #200 / #202）**（根拠: `310b5bd feat: add read-only doctor diagnostics (#193)`、`200c8e8 test: complete Slice 4 doctor acceptance evidence (#200)`、`4001974 test: verify doctor recovery command exists (#202)`）。**AC-48（異常が継続している日数）は未実装**。status に health 開始時刻が無く連続回数と実日数を区別できないため Issue #192 へ繰延 |
| 5 | purge と wipe | 未着手 |
| 6 | distribution と切替準備 | 未着手 |
| 7 | 観測後 cleanup | 未着手 |

検証方針は検討書の「Slice ごとの完了ゲート」表が正本。Issue #2 の共通ゲートは `CGO_ENABLED=0 go test ./...` / `go vet ./...` / Go binary acceptance である。旧 TypeScript/Vitest/Bun の試験記述は過去の実装を記録する履歴であり、現行製品の既定経路ではない。

### scale_exporter との責任境界（2026-08-02 合意）

| | 責任範囲 |
| --- | --- |
| scale_exporter | 測定データ取得、JSONL 出力、**自身の**設定・認証・バイナリの install / uninstall、自身の LaunchAgent（`jp.seijin.kappa.scale-exporter`、既定 07:00/21:00） |
| scale2sheet | pipeline 実行、launchd（**自身の** pipeline / Sheets 用 LaunchAgent のみ）、朝夕スケジュール、Sheets 転記 |

- 連携は**公開 CLI と出力契約だけ**に限定する。相手側の設定・認証・導入を所有しない
- scale2sheet の installer が scale_exporter を install しないことは当初からの非目標。維持する
- 相手の LaunchAgent を重複管理しない
- **決定済み（2026-08-03）**: 二重取得の論点は**当方案A で確定**した。
  それぞれが自分のスケジュールで取得し、次工程の入力フォルダへ出力する。
  Apple Health は iPhone のショートカットが、Google Fit は `scale_exporter` が出力する。
  **当方 pipeline は exporter を同期起動せず、出力済みファイルを読んで転記する。**
  呼び出し契約が「実行」から「出力の消費」へ変わった（先方ユーザー決定）。
  これにより当方案B（pipeline が公開 CLI を同期起動する）と当方案C（`invoke` と `consume` を切り替える）は**不採用**
- **決定済み（2026-08-03）**: 先方は自身の Issue #9 で**先方案B（暫定）を採り、先方案C（恒久）は採らない**。
  先方案は当方の案A / 案B / 案C とは**別系列**であり、記号が重なるだけで内容は無関係。
  先方案B は「iPhone ショートカット側の `source` を `apple_health` へ直す」、
  先方案C は「raw staging から検証・正規化して原子的に公開する」を指す。
  したがって先方の公開契約は当面変わらず、**排他なし・JSONL の公開は atomic でない・一括 atomicity なし**が残る。
  当方ユーザーは**当方の consumer 側防御方針（案Z）**、すなわち
  「受け入れたうえで、atomic 公開・完了判定を将来の公開契約として残す」を選択した。
  当方は読み取り側に最小限の防御を入れる。防御は完全にはならない（#49）
- **決定済み（2026-08-03）**: 欠測検知は**当方で完結**させる。
  対象日の入力ファイルが存在しなければその日は失敗として扱い、転記しない。
  「先方が失敗したのか、本当に測定が無かったのか」を当方が区別する必要はない。
  先方に通知の責任を負わせる契約は求めない（当方ユーザー決定）
- 上記の設計反映は PR #50（merge commit `52f472d`）で 6 正本へ着地済み

---

## 旧 Bun 単一バイナリ化方針（Ph.11〜Ph.13、2026-07-05の履歴）

これは 2026-07-05 時点の TypeScript/Bun 実装方針を保存した履歴であり、Issue #2 の Go ポートで置き換えられた。現在の製品の正式経路は Go 単一バイナリである。詳細な旧方針は [decisions/2026-07-05T102021_Bun_CLI化についての検討書.md](./decisions/2026-07-05T102021_Bun_CLI化についての検討書.md) と [decisions/2026-07-05T105321_単一バイナリ化_bun_buildを正式な配布形態にする検討書.md](./decisions/2026-07-05T105321_単一バイナリ化_bun_buildを正式な配布形態にする検討書.md) を参照。

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

## 2026-08-11 の設計着地と、待っているもの

**設計が 4 本 main に入った。実装は #184 のみ着地し、残り 3 本は未着手である。**

| Issue | 設計書（main） | 状態 |
| --- | --- | --- |
| #184 | `docs/superpowers/specs/2026-08-11-install-launchd-readiness-design.md`（`6277435`） | **実装着地**（PR #254 / `a586a5c`、2026-08-11T03:23:44+09:00）。変異 P1〜P7 と M1 / M2 が KILLED。**Issue は close 済み** |
| #243 | `docs/superpowers/specs/2026-08-11-requested-cell-count-and-partial-transfer-design.md`（`7effe19` + `c692ae8`） | **ユーザー判断待ち** |
| #246 / #182 | `docs/superpowers/specs/2026-08-11-file-level-input-skip-design.md`（`ed31239`） | **ユーザー判断待ち** |
| #242 | `docs/superpowers/specs/2026-08-11-notification-result-completion-design.md`（`d77797f`） | 実装待ち。**判断は 2026-08-04 に済んでいる** |

### #243 と #246 は独立ではない

**どちらも `definitionsVersion` を上げる。上げると `rebaselineForDefinitions` が両 period の履歴を消す。**

```
両方を採ると版が 2 回上がり、**履歴が 2 回消える**
```

**1 回にまとめる条件**（設計書より）: 両方のユーザー決定が確定し、同じ aggregate head / binary /
label / README / mutation gate に入り、**片方だけの中間 binary を一度も active writer にしない**こと。
**片方を一度でも新 definition として書いた後は統合できない。**

**したがって manager は 2 つを 1 つの設問として提示する。**

### #46 の原因が判明した（2026-08-11）

```
(a) status が本番で書かれていない                    **#114**
(b) 通知が 1 回きりで、失敗しても記録されない        **#242**
(c) 起動したが結果行を出さない run が 43%（34/79）
(d) (c) の原因 = **exporter の google-fit token refresh 失敗（HTTP 400）**で
    結果行に到達する前に抜けた。**err.log には記録されていた**
```

**人へ届く経路は 3 本あり、3 本とも切れている。**

| | 経路 | Issue |
| --- | --- | --- |
| 1 | pipeline -> status -> doctor | **#114** |
| 2 | pipeline -> 通知 -> 人 | **#242** |
| 3 | shell/exporter -> err.log -> ? | **#251**（本文を読む側が無い） |

**3 は「壊れている」のではなく「最初から繋がっていない」。**

### cutover の観測

**08-11 と 08-12 が数える日。08-12 の夜に G-2 を判定する。**

**G-2 と AC-46 は別のゲートである。**

```
G-2    exporter 自身のスケジュールだけで morning と evening 両方へ**公開**（連続 2 日）
AC-46  pipeline が 7 日連続で**成功**
```

**G-2 は「公開」なので no-op の影響を受けない。**
**AC-46 は「成功」の定義（実行か転記か）が未決である**（#38）。

## 2026-08-11 のユーザー決定（4 件）

**manager 経由で受領。manager の証言であり、reviewer の検証範囲外である。**

| 論点 | 決定 |
| --- | --- |
| **G-2 の解釈** | **exporter が動いていれば可**。launchctl の `runs` / `last exit code` で判定する |
| **morning の時刻** | **時刻をずらす + 設定可能にする**（#259 / #179） |
| **#243 + #246** | **両方採る。1 回の版上げにまとめる** |
| **AC-46 の成功** | **転記した日だけを成功とする** |

### G-2 は満たされている

```
判定に使うもの  **launchctl print gui/502/jp.seijin.kappa.scale-exporter の runs / last exit code**
**公開の有無は判定条件にしない**
```

**08-10 も 08-11 も「実行され exit 0」を満たす。**
**公開が無い日は、cutover 後 pipeline が `failed:input-missing` または `completed:no-data` として処理する。**

### morning の時刻をずらしても、入力不在は大きく減らない

```
**43 日中 28 日は 11:30 までに独立した morning 公開を確認できない**
-> **schedule delay では直らない**
```

**設計書は「本書は `70%` から `65%` への差を、alert 頻度そのものではなく morning 終了時点の入力不在 proxy の差として扱う」と明記している**
（`docs/superpowers/specs/2026-08-11-launchd-schedule-design.md:157`）。

**「入力が無い morning を failed とするか no-data とするか」は未決である。**

### #243 + #246 は 1 本の release train

```
条件  同じ aggregate head / binary / label / README / mutation gate に入る
      **片方だけの中間 binary を一度も active writer にしない**
      片方を一度でも新 definition として書いた後は統合できない
```

**#182（partialInput の三値化）も #246 に含まれる。履歴の消去は 1 回。**

### AC-46 は cutover 後にしか数えられない

```
判定に使う値  **uniqueMeasurementCount**（`docs/decisions/2026-08-04T151338_pipeline入力段階の失敗と部分成功の目標定義.md:694`）
**この値は `pipeline` 経路でしか作られない**（production の status は #114 で 08-06 に凍結）
-> **cutover 前の 7 日は数えられない**
-> **Slice 7 の完了は cutover から最短 7 日後**
```

**cutover 前の実績（07-28 〜 08-10 の 14 日連続転記）は、見込みの根拠にはなるが成立日には数えない。**

## 2026-08-11 に landing した設計（6 本）

| Issue | 設計書 | 実装 |
| --- | --- | --- |
| #184 | `2026-08-11-install-launchd-readiness-design.md` | **landed**（`a586a5c`） |
| #243 | `2026-08-11-requested-cell-count-and-partial-transfer-design.md` | release train |
| #246 / #182 | `2026-08-11-file-level-input-skip-design.md` | release train |
| #242 | `2026-08-11-notification-result-completion-design.md` | 待ち |
| #251 | `2026-08-11-launchd-stderr-diagnostic-design.md` | 待ち |
| #259 / #179 | `2026-08-11-launchd-schedule-design.md` | 待ち |

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
| AT-09 | `scale2sheet run --period morning` | 入力フォルダにディレクトリ・当日ファイルなし | 空配列扱い、正常終了（**`run` の挙動。`pipeline` は #49 の決定により `failed:input-missing` / 終了コード 1 で扱う。Slice 2 で実装**） |
| AT-10 | scale_exporter出力に不正JSON行・スキーマ違反あり | 該当ファイル読込 | ファイル名・行番号つきエラーで失敗（黙って捨てない） |
| AT-10a | scale_exporter出力に不正JSON行・スキーマ違反あり | 対象日のfile群を読込 | 1ファイルの1行でも不正なら対象日全体を疑わしいものとして `failed:input-invalid-or-partial`、exit 1、転記なし。通知でその旨を警告する |
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

## 開発体制：過去の複数席構成（履歴、herdr + agmsg、2026-07-03 確立）

> 本節は過去の複数席構成を保存する履歴である。現在のプロジェクトでは、上の「現行パイロット運用」に従い、`scale2sheet_owner_codex` 一席だけを製品作業へ使用し、対向 LLM エージェントを配置しない。

運用の正本は `/Users/kappa/Dropbox/data/dev/codex_monitor_agents/README.md`。本プロジェクト固有の構成は以下。

### 構成

- **agmsg チーム**: `scale2sheet`（チーム = プロジェクト。他プロジェクトへはアクセスしない）
- **herdr**: default セッション（ghostty）内の workspace `scale2sheet`

| 登録済みの役割 | agmsg 名（= herdr タブラベル） | 作業ディレクトリ | GitHub |
| --- | --- | --- | --- |
| pm | scale2sheet_pm_claude | 本リポジトリ（dev/scale2sheet） | kappaseijin4claude |
| architect | scale2sheet_architect_codex | codex_monitor_agents/scale2sheet-architect | kappaseijin4codex |
| programmer | scale2sheet_programmer_codex | codex_monitor_agents/scale2sheet-programmer | kappaseijin4codex |
| reviewer（作成者のベンダーを問わず） | scale2sheet_reviewer_claude | codex_monitor_agents/scale2sheet-reviewer-claude | kappaseijin4claude |
| worker | scale2sheet_worker_codex | codex_monitor_agents/scale2sheet-worker | kappaseijin4codex |

この表も `team.sh scale2sheet` の 2026-08-10 の実測に合わせ、未登録の役割を含めない。

### herdr 配置（2026-08-02 改訂・1エージェント = 1専用タブ ＋ PMタブ監視pane）

旧 3-pane 分割レイアウトの検討経緯: [decisions/2026-07-05T224500_herdr_pane配置についての検討書.md](./decisions/2026-07-05T224500_herdr_pane配置についての検討書.md)（体制改編前の記録）

default セッション内の workspace `scale2sheet`（ラベルで識別。workspace ID / pane ID は再作成で変わるため `herdr agent list` で都度取得する）。
**1 エージェント = 1専用タブ**とし、タブラベルは派生名をそのまま使う。
エージェントの pane は他エージェントのタブへ置かない。ただしPMタブだけは、PM本人のpaneに加えて監視用paneを2枚置く。

```text
PMタブ                                各エージェント専用タブ
┌───────────┬──────────────────────┐  ┌──────────────┐
│           │ watch:agmsg           │  │ programmer   │
│  pm       │  ← 新着が下端に出る  │  └──────────────┘
│  (全高)   ├──────────────────────┤  ┌──────────────┐
│           │ watch:agents          │  │ reviewer     │
└───────────┴──────────────────────┘  └──────────────┘
```

- PMタブ右上 = `~/.agents/bin/agmsg-watch-stream.sh scale2sheet 10`（agmsg の往復を新着だけ 1 行ずつ追記）
- PMタブ右下 = `~/.agents/bin/herdr-watch-agents.sh <wID> 5`（全席の稼働状況。`blocked` を赤で警告）
- **上下を逆にしない**。メッセージ流は新着が pane 下端から上がるため、一覧を*下*に置くと
  最新メッセージと一覧が隣接し目線の移動が最小になる
- PMタブの構築は `pane split <pm pane> --direction right --ratio 0.45` → `pane split <上pane> --direction down --ratio 0.76`

```sh
$H pane split <pm pane> --direction right --ratio 0.45 --no-focus
$H pane split <上pane>  --direction down  --ratio 0.76 --no-focus
$H pane rename <上pane> watch:agmsg;  $H pane rename <下pane> watch:agents
$H pane run <上pane> '~/.agents/bin/agmsg-watch-stream.sh scale2sheet 10'
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

- 常駐は **pm / programmer / reviewer_claude** のみ。登録済みの短命席である architect / worker は案件ごとに起動し、受け渡し後にタブを閉じる
- タブの最後の pane を閉じるとタブごと消えるため、再起動は `tab create` からやり直す
- 前提: 各エージェントディレクトリの agmsg delivery mode が `monitor` であること（`delivery.sh status <type> <dir>` で確認。off のまま起動するとブリッジ無しになる）
- codex 側は `delivery.sh set monitor codex <dir>` 実行後に hooks の trust プロンプトが出るため、起動中のセッションは一度落として再 actas する

### 開発フロー

1. PR は**作成者と別ロール**がレビューし、GitHub の Approve 機能で承認する。**GitHub アカウントは検証者と分離する**。担当は以下で固定する

   | PR の作成者（成果物の起草者） | レビュー・approve 担当 | PR 作成に使う GitHub アカウント |
   | --- | --- | --- |
   | `scale2sheet_architect_codex`（設計書・検討書） | `scale2sheet_reviewer_claude` | kappaseijin4codex |
   | `scale2sheet_programmer_codex`（実装） | `scale2sheet_reviewer_claude` | kappaseijin4codex |
   | `scale2sheet_worker_codex`（定型作業） | `scale2sheet_reviewer_claude` | kappaseijin4codex |
   | `scale2sheet_pm_claude`（PLAN / NOTES） | `scale2sheet_reviewer_claude` | kappaseijin4codex |
   | `scale2sheet_innovator_claude`（目標定義） | `scale2sheet_reviewer_claude` | kappaseijin4codex |

   **レビューは常に reviewer が担う**（`~/.agents/rules/agent-role.rule.md`）。architect / programmer は
   検証者を兼務しない。reviewer は `scale2sheet_reviewer_claude` の 1 席で、作成者のベンダーを問わず本席が検証する
   （2026-08-03 ユーザー決定。それ以前はベンダー別 2 席だった）

   **PR の作成アカウントは、検証者と別のアカウントにする。** GitHub はセッションやロールではなく
   **アカウント単位**で自己 approve を拒否する（`Review Can not approve your own pull request`）。
   コミットの author を分けるだけでは足りない。reviewer が `kappaseijin4claude` 1 席に統合された以上、
   **全成果物の PR 作成を `GH_CONFIG_DIR=~/.config/gh-4codex` へ寄せる**。
   pm が代理作成する場合も同じで、基準は「成果物の作成者側のアカウント」ではなく
   **「検証者と別のアカウント」**である
   （2026-07-29、pm が 4claude で codex 成果物の PR を作り reviewer_claude が判定を出せなくなった事故に基づく。
   2026-08-03、reviewer 1 席化にともない基準を作成者基準から検証者基準へ変更）
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
- `scale2sheet_reviewer_codex` は正本（`model-orchestration.rule.md`）の役割表に列挙されていない。2026-08-03 のユーザー決定により、常設席ではなくフォールバック専用と確定した。起動する場合のモデルは `gpt-5.6-terra` / medium とする
- 2026-08-03 の決定（reviewer は Claude 1 席・ベンダー跨ぎは必須条件としない・PR 作成アカウントは検証者と別）は、
  **正本側にも同時に反映済み**（`agent-role.rule.md` の検証者条項と PR 作成アカウント条項、
  `model-orchestration.rule.md` の役割別モデル配置）。本書は正本を参照するだけで、独自に緩めてはいない
- 制限解除の確認と復帰は承認不要で自動実行してよい

---

## 完了報告の規約（2026-08-05 導入・恒久ルール。Issue #97）

**完了報告は「何をしたか」ではなく「成果物のどこに何が残ったか」で行う。**

報告する側は、主張ごとに次の確認を実行し、**その出力を報告へ添える。**
受け取る側は、添えられていない主張を**未確認として扱ってよい**。

| 主張 | 見るもの |
| --- | --- |
| push した | `git ls-remote origin refs/heads/<branch>` / `gh pr view --json headRefOid` |
| ファイルを書いた | `ls -l <path>` |
| ブランチが動いた | `git rev-parse <branch>`（`git log` ではない。detached HEAD を拾えない） |
| どこで何が実行されたか | `git reflog`（cwd や意図からの推論ではない） |
| マージで何が変わるか | `git diff origin/main...HEAD`（three-dot） |
| 競合を解決した | `grep -c '^<<<<<<<' <file>` が 0 |
| 試験を足した | **その試験が落ちる変異を実際に当てた結果**（追加した事実ではない） |
| 決定に従った | 決定の**原文への参照**（要約ではない） |

### 「受領しました」は着手の証拠にならない

受領の返信と、ブランチ・commit・PR の実在は別の事実である。
依頼側は一定時間後に `git ls-remote` か `gh pr list` で実在を確かめる。

### 起草物を要約して配らない

**pm・manager は、他者の起草物を要約して依頼文へ貼らない。参照だけを渡す。**
要約は転記の過程で変質する。実例:

- 2026-08-05、pm が目標定義の推奨を決定表へ転記した際、**論点2 と論点3 を取り違えた**（PR #107 で訂正）。
  要旨の並びが論点番号順ではなく検討順序だったことを、参照先を開かずに位置で対応させた
- 2026-08-05、pm が Issue #62 の決定を外部チームへ「既存値があるとき上書きしない」と伝えた。
  実際の決定は「同一対象日・同一 period の再実行で、既に値がある kind に異なる値を書くとき」に限定されており、
  **決定より広い主張を外部チームの行動の根拠にしていた**

貼る必要があるときは、**「実物を見ろ」と添え、参照先の path と行番号を書く。**

### 観測と結論が食い違ったら、結論ではなく観測を残す

**観測を物語で埋めない。**「一致しないが、○○という理由で一致していると読める」と書いたときは、
ほぼ確実に一致していない。実例:

- 2026-08-05、検証者が対応表の検証で「§4.4 が E-3、§5.4 が F-2」と**不一致を観測しながら**、
  「論点名で対応させているため一致する」と結論を倒した。実際は取り違えだった
- 2026-08-05、起草者が**自分のセッションが書いた差分**を「外から現れた」と報告した。
  着手前後の `git status` を取っていれば出所は自分で分かった

対応表・マッピングを含む差分は、**記号の集合が一致するかではなく、記号と対応先を 1 対 1 で突き合わせる。**
集合の照合では「4 つの記号はすべて正しく、対応先だけが誤っている」形が通る。

### この規約が生まれた経緯

2026-08-04〜05 に、同じ構造の誤りが別々の席で 10 回起きた。
起票時の 5 件は Issue #97 の本文の表に、2026-08-05 の 5 件は同 Issue のコメントに一覧がある。
いずれも**その場所に残る証拠を見れば即座に分かるもの**だった。
個別の誤りは 1 回で終わるが、**誤った手順は毎回再生産される。**

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
