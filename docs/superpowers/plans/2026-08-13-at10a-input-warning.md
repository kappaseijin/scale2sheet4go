---
type: Plan
title: AT-10a A-0入力異常通知実装計画
description: A-0の入力全体失敗と転記未実行をmacOS通知で明示する。
tags:
  - plan
  - go
  - notification
  - at-10a
  - issue-31
timestamp: "2026-08-13T19:12:04+09:00"
status: completed
issue: 31
---

# AT-10a A-0入力異常通知実装計画

> **For agentic workers:** この計画は本セッションでインライン実行する。別エージェントは起動しない。

**Goal:** AT-10a=A-0の入力異常時に、対象日の入力全体を信用せず転記していないことをmacOS通知で明示する。

**Architecture:** statusの通知attemptへoptionalな理由コード `input-invalid` を保存し、pipelineがその理由をNotifierへ渡す。MacOSNotifierは理由コードを利用者向け日本語文面へ変換する。既存の状態遷移による初回通知、復旧通知、通知best-effort性は維持する。

**Tech Stack:** Go、`osascript`、JSON status、Markdown。

**Spec:** `docs/decisions/2026-08-13T190240_Go版AT-10a入力異常ポリシーをA-0へ確定.md`

## Global Constraints

- 1 Issue 1目的、1 Issue 1 PRとする。
- A-0を維持し、不正入力時は `failed:input-invalid-or-partial`、exit 1、transfer未実行とする。
- A-1、partial transfer、除外file単位の処理は実装しない。
- 通知は状態遷移が発生したときだけ行う既存契約を維持する。
- 通知失敗はpipeline結果を変更しないbest-effort契約を維持する。
- `NotificationAttempt.reason` は後方互換のためoptionalとし、旧statusを読めるようにする。

---

### Task 1: A-0専用通知文の失敗テストを書く

**Files:**
- Modify: `internal/pipeline/notifier_test.go`

- [x] fake `osascript` executableを一時ディレクトリへ作成し、`-e`引数を記録する。
- [x] `input-invalid` reasonで `Notify` を呼び、出力に「入力全体を信用できないため、転記していません」が含まれることをassertする。

### Task 2: 通知理由のstatus伝播テストを書く

**Files:**
- Modify: `internal/pipeline/status_test.go`
- Modify: `internal/pipeline/pipeline_test.go`

- [x] A-0 terminal outcomeが初回alert通知へ `input-invalid` reasonを保存することをassertする。
- [x] pipelineがstatus writerから受け取ったreasonをNotifierへ渡すことをassertする。

### Task 3: REDを確認する

- [x] `go test ./internal/pipeline/...` を実行する。
- [x] 新テストが、未実装の通知理由引数またはreason伝播を原因として失敗することを確認する。

### Task 4: 最小実装を追加する

**Files:**
- Modify: `internal/pipeline/status.go`
- Modify: `internal/pipeline/pipeline.go`
- Modify: `internal/pipeline/notifier.go`
- Modify: `internal/pipeline/notifier_test.go`

- [x] `NotificationAttempt`へ `Reason string \`json:"reason,omitempty"\`` を追加する。
- [x] `RecordTerminal`で `failed:input-invalid-or-partial` の通知に `input-invalid` を設定する。
- [x] `Notifier.Notify`へreasonを渡す。
- [x] `MacOSNotifier`でA-0専用の日本語warning文面を生成する。
- [x] 旧statusのreason欠落時は既存の一般alert文面へフォールバックする。

### Task 5: GREENと回帰を確認する

- [x] `CGO_ENABLED=0 GOTOOLCHAIN=local go test ./internal/pipeline/...` を実行する。
- [x] `CGO_ENABLED=0 GOTOOLCHAIN=local go test ./...` を実行する。
- [x] `bash scripts/check-go-quality-gates.sh` を実行する。

### Task 6: READMEへ利用者向け契約を反映する

**Files:**
- Modify: `README.md`

- [x] A-0の入力異常時に転記せず、macOS通知で理由を警告することを「状態ファイルと終了コード」または常駐実行の利用者向け節へ追記する。
- [x] 通知を受け取れない場合でもstatusとexit codeが正本であることを明記する。

### Task 7: Issue #31のPRを作成する

- [x] `git diff --check`、`python3 scripts/check-doc-refs.py`、`node scripts/verify-readme-config-keys.mjs` を実行する。
- [x] `git show --check --oneline HEAD` でcommitを検証する。
- [x] Issue #31をcloseするPRを `kappaseijin4codex` で作成する（[#33](https://github.com/kappaseijin/scale2sheet4go/pull/33)）。

## 検証結果

- 最初のデフォルト `go test` はmacOS linkerの `missing LC_UUID load command` で失敗した。
- `CGO_ENABLED=0 GOTOOLCHAIN=local go test ./internal/pipeline/...`: PASS
- `CGO_ENABLED=0 GOTOOLCHAIN=local go test ./...`: PASS
- `bash scripts/check-go-quality-gates.sh`: PASS
- `bash scripts/run-go-acceptance-matrix.sh`: 8 scripts PASS
- `python3 scripts/check-doc-refs.py`: PASS
- `node scripts/verify-readme-config-keys.mjs`: PASS
