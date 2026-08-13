---
type: Decision
title: macOS本番ビルドとLaunchAgent運用の採否についての検討書
description: scale2sheet の macOS 成果物アーキテクチャ、CGO/Go target、per-user LaunchAgent、診断・署名境界を確定する。
status: adopted
tags:
  - macos
  - release
  - launchd
  - installer
  - go
timestamp: "2026-08-13T15:13:18+09:00"
---

# macOS本番ビルドとLaunchAgent運用の採否についての検討書

## 背景とプロジェクト全体での妥当性

Issue #6 は、Go ポート後の scale2sheet を利用者の macOS 上で再現可能に build、配置、定期実行、診断、撤去できる状態へ固定する課題である。
Issue #5 の CI は開発時の品質ゲートであり、実際の配布物がどの CPU を対象にし、どの macOS 管理境界へ登録され、どのパスを診断するかまでは保証しない。
したがって、製品の本番境界を一つの運用契約として定義することはプロジェクト全体に妥当である。

## 調査結果

- [Go の compile/install tutorial](https://go.dev/doc/tutorial/compile-install) は `go build` が実行可能ファイルを生成し、`go run` は実行用の一時 build であることを定義する。利用者へ渡すものは `go build` で生成する。
- [Go の target environment](https://go.dev/doc/install/source) は `GOOS=darwin` と `GOARCH=arm64` / `amd64` を macOS の有効な組合せとして定義し、`CGO_ENABLED=0` は cgo を無効にする方法としている。
- [Apple Service Management](https://developer.apple.com/documentation/servicemanagement/smappservice) は macOS 13 以降の `SMAppService` を、アプリ bundle 内の helper executable と LaunchAgent/LaunchDaemon を登録する API として案内する。現行 scale2sheet は GUI app bundle ではなく、ユーザーが直接実行する Go CLI であるため、bundle 化と Swift/ServiceManagement 依存を導入せず、既存の per-user plist と `launchctl` を維持する。
- Apple の Service Management 資料は LaunchAgent をログインユーザーのプロセスとして扱い、LaunchDaemon は root/system context と区別する。scale2sheet はユーザーの Google 認証・HOME・LaunchAgents を使うため、LaunchDaemon ではなく `~/Library/LaunchAgents` を採用する。
- ローカルの `launchctl help` は `gui/<uid>` domain と `bootstrap` / `bootout` を提供している。現行実装の `launchctl bootout gui/<uid>/<label>` → plist write → `launchctl bootstrap gui/<uid> <plist>` はこの per-user domain と一致する。
- [Apple の distribution signing](https://developer.apple.com/documentation/xcode/creating-distribution-signed-code-for-the-mac/) と [notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution) は Developer ID、Hardened Runtime、Apple notary service の認証情報を必要とする。これらは個人のローカル pilot acceptance だけでは再現できないため、公開配布の署名・公証は独立した [Issue #10](https://github.com/kappaseijin/scale2sheet4go/issues/10) へ分離する。

## 採用する macOS 成果物

### Universal binary を正式な pilot 成果物にする

利用者 CPU を Apple Silicon に限定する決定は存在せず、Go は `darwin/arm64` と `darwin/amd64` の両方を標準 cross-build できる。
したがって、単一の配布物で Apple Silicon と Intel Mac の両方を受け入れる universal binary を採用する。

`scripts/build-macos-release.sh` は macOS 上で次を実行する。

```sh
GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 GOTOOLCHAIN=local go build -trimpath -o <tmp>/scale2sheet-arm64 ./cmd/scale2sheet
GOOS=darwin GOARCH=amd64 CGO_ENABLED=0 GOTOOLCHAIN=local go build -trimpath -o <tmp>/scale2sheet-amd64 ./cmd/scale2sheet
lipo -create <tmp>/scale2sheet-arm64 <tmp>/scale2sheet-amd64 -output dist/scale2sheet
```

出力後に `file` と `lipo -info` で `arm64` と `x86_64` の二つを確認する。
CGO は全 target で無効にし、Xcode SDK や C compiler による target 差異を製品 build の前提にしない。
`lipo` は macOS の Xcode Command Line Tools に含まれるため、release build は macOS 上で実行する。

### 署名境界

Go linker が生成する local artifact は ad hoc signature であり、個人の Mac への直接配置と隔離 acceptance には使える。
外部の Mac へ公開する成果物にそのまま使わない。
Developer ID 署名、Hardened Runtime、notarytool、stapler、Gatekeeper 検証は Issue #10 が完了するまで本 Issue の完了条件に含めない。

## 採用する配置・launchd 境界

- binary: 既定 `~/.local/bin/scale2sheet`、`--prefix <dir>` なら `<dir>/bin/scale2sheet`
- settings/auth/state: `~/.config/scale2sheet/`
- LaunchAgent plist: `~/Library/LaunchAgents/jp.seijin.kappa.scale-pipeline.{morning,evening}.plist`
- logs: `~/Library/Logs/scale-pipeline/`
- domain: `gui/<uid>`
- registration: `launchctl bootout`、plist atomic replace、`launchctl bootstrap`
- removal: manifest が所有する plist、binary、manifest、空の bin directory だけを削除し、settings、認証、状態、ログは残す

`install --launchd` は settings/source/auth と maintenance lease を変更前に検査し、失敗時は filesystem と launchctl を変更しない。
これは既存実装と隔離 acceptance で確認済みであり、本 Issue では universal binary を同じ installer acceptance へ通す。

`doctor` は `--prefix` を受け取り、custom prefix にインストールした binary/manifest も同じ prefix から診断する。
これにより install と doctor の配置正本が分岐しない。

## 却下した案

### arm64 だけを build する

現行開発機と CI は Apple Silicon だが、Intel Mac を非対応とするユーザー決定がない。
universal binary は Go の二回 build と `lipo` だけで実現でき、pilot の運用手順を複雑にしないため却下する。

### LaunchDaemon / root install にする

Google 認証、HOME、ユーザー LaunchAgent と衝突し、root 権限と `/Library/LaunchDaemons` を必要にする。
ユーザー単位の定期転記には過剰であり採用しない。

### `SMAppService` へ移行する

現行の成果物は app bundle ではなく CLI で、移行には bundle、署名、Service Management の登録 UI/許可状態が追加で必要になる。
Apple の API が適用される app-bundle 配布へ移行する場合は別 Issue で設計する。

### pkg/DMG を Issue #6 に追加する

配布形式の選択、署名、公証、更新チャネルは Developer ID と notary service の設計に結びつく。
本 Issue の per-user pilot install から分離し、署名・公証の [Issue #10](https://github.com/kappaseijin/scale2sheet4go/issues/10) で扱う。

## 結論

Issue #6 では、macOS の `darwin/arm64` + `darwin/amd64` を `CGO_ENABLED=0` で build して `lipo` でまとめた universal Go binary、per-user LaunchAgent、`launchctl` の `gui/<uid>` domain、custom prefix 対応 doctor を正式境界とする。
公開配布に必要な Developer ID 署名・公証は Issue #10 に分離し、pilot の隔離 acceptance は ad hoc universal artifact を対象にする。
