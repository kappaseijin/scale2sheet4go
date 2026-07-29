---
type: Design
title: scale2sheet インストール設計
description: 単体バイナリの独立配置、launchd 登録、診断、アンインストール、パイプライン移行を定義する。
tags:
  - design
  - installer
  - launchd
  - scale2sheet
status: accepted
timestamp: "2026-07-29T13:23:53+09:00"
---

# scale2sheet インストール設計

## 適用状態

ユーザーは A-2、B-3、C-4、D-4 と極薄 D-1、F 全項目、F-e-2、G-1、H-2、P-3 を採用した。
既定アンインストールは設定、認証情報、ログを残し、`--purge` はローカル対象を退避し、`--wipe` 併用時だけ退避せずに削除する。
全決定の決定者はユーザー、決定日は2026-07-29である。

## 目的

インストール済み `scale2sheet` をソースチェックアウトから独立させる。

インストール、更新、撤収を同じ CLI で再現できるようにする。

launchd の日次処理は、インストール済み単体バイナリだけを起動する。

再実行時は、実行中プロセスと既存設定を壊さない。

## 非目標

- scale_exporter のインストール
- Homebrew、MacPorts、npm package などの配布基盤
- GCP プロジェクト、サービスアカウント、OAuth client の作成
- GCP 側の鍵失効
- Spreadsheet の共有解除
- macOS 以外の常駐化
- 自動更新

## 外部インターフェース

### 初回ブートストラップ

```sh
./scripts/install.sh [scale2sheet install のオプション]
```

`scripts/install.sh` は `npm ci`、`npm run build:bun`、`dist/scale2sheet install "$@"` の順で実行する。
初回配置後の更新は、同じスクリプトを再実行する。

### CLI

```text
scale2sheet install [--prefix <dir>] [--launchd] [--dry-run] [--force]
scale2sheet uninstall [--prefix <dir>] [--dry-run] [--purge] [--wipe] [--archive <dir>] [--yes]
scale2sheet doctor
scale2sheet pipeline --period <morning|evening>
```

### オプション

| オプション | コマンド | 既定 | 説明 |
| --- | --- | --- | --- |
| `--prefix <dir>` | `install`, `uninstall` | `~/.local` | インストールルート。バイナリは `<dir>/bin/scale2sheet` に置く |
| `--launchd` | `install` | 無効 | 朝夕の二つの LaunchAgent を生成して登録する |
| `--dry-run` | `install`, `uninstall` | 無効 | 外部通信を含む副作用を起こさず、実行予定の操作を順序付きで表示する |
| `--force` | `install --launchd` | 無効 | 稼働中処理の停止と欠測リスクを明示して再登録する |
| `--purge` | `uninstall` | 無効 | 設定、認証情報、ログを timestamp 付きディレクトリへ退避する |
| `--wipe` | `uninstall --purge` | 無効 | 退避を作らず、ローカル purge 対象を削除する |
| `--archive <dir>` | `uninstall --purge --wipe` | 無効 | 以前作成した一つの退避先を真削除の対象にする |
| `--yes` | `uninstall --purge` | 無効 | 非対話実行で確認を明示する |

`--force` は認証不足、実行不能な exporter、不正設定、launchctl の失敗を無視しない。
稼働中処理を停止する場合は、処理の中断と当日データ欠測の可能性を実行前に表示する。

`--wipe` を `--purge` 無しで指定した場合は、引数エラーとして終了コード2を返す。
`--archive` を `--purge --wipe` 無しで指定した場合も、引数エラーとして終了コード2を返す。
`--yes` は GCP 側の鍵失効または Spreadsheet の共有解除への同意を意味しない。

## 配置

### 既定パス

```text
~/.local/bin/scale2sheet
~/.config/scale2sheet/settings.json
~/.config/scale2sheet/install-manifest.json
~/.config/scale2sheet/active-run.json
~/.config/scale2sheet.removed-<timestamp>/
/tmp/scale2sheet-<uid>-<namespace>/active-run.lock
/tmp/scale2sheet-<uid>-<namespace>/run-<owner-token>.sock
~/Library/LaunchAgents/jp.seijin.kappa.scale-pipeline.morning.plist
~/Library/LaunchAgents/jp.seijin.kappa.scale-pipeline.evening.plist
~/Library/Logs/scale-pipeline/morning.log
~/Library/Logs/scale-pipeline/morning.err.log
~/Library/Logs/scale-pipeline/evening.log
~/Library/Logs/scale-pipeline/evening.err.log
~/.config/scale2sheet/pipeline-status.json
```

バイナリ以外のパスは `--prefix` で変更しない。
設定、LaunchAgent、ログは macOS のユーザー領域に置く。

### 権限

| 対象 | mode |
| --- | --- |
| prefix の `bin` ディレクトリ | `0755` |
| `scale2sheet` バイナリ | `0755` |
| `~/.config/scale2sheet` | `0700` |
| `install-manifest.json` | `0600` |
| `active-run.json` | `0600` |
| `active-run.stop.<owner-token>.json` | `0600` |
| `/tmp/scale2sheet-<uid>-<namespace>` | `0700`。owner が実行 uid と一致すること |
| `active-run.lock` | `0600`。作成後は unlink、truncate、置換しない |
| `run-<owner-token>.sock` | `0600` |
| `pipeline-status.json` | `0600` |
| `settings.json` | 既存 mode を保持。新規生成時は `0600` |
| `scale2sheet.removed-<timestamp>` | `0700` |
| 退避ファイルと `archive-manifest.json` | `0600` |
| ログディレクトリ | `0700` |
| plist | `0644` |

既存 `settings.json` の mode はインストーラが変更しない。

## マニフェスト

`install-manifest.json` は、インストール先を推測せずに更新と撤収を行うための正本である。

```json
{
  "schema-version": 1,
  "state": "installed",
  "version": "0.1.0",
  "prefix": "/Users/example/.local",
  "binary-path": "/Users/example/.local/bin/scale2sheet",
  "config-dir": "/Users/example/.config/scale2sheet",
  "log-dir": "/Users/example/Library/Logs/scale-pipeline",
  "launchd": {
    "enabled": true,
    "domain": "gui/501",
    "labels": [
      "jp.seijin.kappa.scale-pipeline.morning",
      "jp.seijin.kappa.scale-pipeline.evening"
    ],
    "plist-paths": [
      "/Users/example/Library/LaunchAgents/jp.seijin.kappa.scale-pipeline.morning.plist",
      "/Users/example/Library/LaunchAgents/jp.seijin.kappa.scale-pipeline.evening.plist"
    ]
  },
  "applied-steps": [
    "ensure-settings",
    "ensure-bin-directory",
    "ensure-log-directory",
    "replace-binary",
    "write-plists",
    "register-launchd"
  ],
  "created-paths": [
    "/Users/example/.config/scale2sheet",
    "/Users/example/.local/bin",
    "/Users/example/Library/Logs/scale-pipeline"
  ],
  "updated-at": "2026-07-29T09:10:44+09:00"
}
```

`state` は `installing`、`installed`、`uninstalling` のいずれかとする。

インストーラは config 作成と一時 maintenance receipt の取得後、永続的な製品変更を始める前に `installing` を atomic write する。
各手順が完了するたびに `applied-steps` を atomic write し、全手順の完了後に `installed` へ変える。
インストーラが新しく作成したディレクトリだけを `created-paths` へ記録する。
既存ディレクトリは記録せず、アンインストール時にも削除しない。

途中失敗後もマニフェストを残す。
再インストールとアンインストールは `installing` または `uninstalling` を読み、完了済み手順を修復または撤収できる。

秘密情報、Spreadsheet ID、OAuth token はマニフェストへ書かない。
`version` は `src/version.ts` の `APP_VERSION` を使い、Commander の `--version` と同じ値にする。

## モジュール境界

```text
src/
  version.ts                    # CLI と manifest で共有する APP_VERSION
  cli/
    index.ts                    # サブコマンド登録
    installation.ts             # install/uninstall/doctor の Commander 接続
    pipeline.ts                 # pipeline の Commander 接続
  installation/
    model.ts                    # manifest、operation、result の型
    paths.ts                    # home、prefix、plist、log の解決
    manifest.ts                 # schema 検証と atomic read/write
    archive.ts                  # purge 退避、hash 検証、archive manifest
    plist.ts                    # LaunchAgent XML の生成
    planner.ts                  # 副作用の無い install/uninstall plan
    executor.ts                 # plan の逐次実行と結果記録
    doctor.ts                   # ローカル状態と Google API の読取診断
    sheets-read.ts              # doctor 専用の Google Sheets 読取 port
    settings-read.ts            # ファイルを生成しない設定ローダ
    process.ts                  # launchctl、移行時 ps、子プロセスの adapter
  scheduler/
    run-lease.ts                # serve、pipeline、install、uninstall 共通の稼働 receipt
  pipeline/
    pipeline.ts                 # exporter リトライ、同期、通知
    notifier.ts                 # macOS notifier port と osascript adapter
    status.ts                   # pipeline-status.json の atomic 更新
scripts/
  install.sh                    # npm ci、build:bun、install 呼び出しだけ
test/
  installation/
  pipeline/
```

`planner.ts` は OS を変更しない。
入力として現在状態とオプションを受け、実行順序を `InstallationOperation[]` で返す。

`executor.ts` は plan の一操作だけを順に実行する。
各操作の完了後にマニフェストと出力を更新する。

`doctor.ts` は `planner.ts` と同じ path resolver と process adapter を使うが、write 系の依存を持たない。
Google Sheets には、認証、Spreadsheet 読取、当日行特定だけを公開する `SheetsReadPort` を介して接続する。
この port はセル更新、行追加、sheet 作成のメソッドを持たない。

`settings-read.ts` は既存ファイルの読取と schema 検証だけを行う。
ファイルが無い場合に生成する既存 `loadOrCreateSettings` は、通常 install の適用段階だけで呼ぶ。

`pipeline/pipeline.ts` は既存 `service.syncMeasurements` を直接呼ぶ。
インストール済みバイナリを子プロセスとして再起動しない。

## 主要な型

```ts
export type InstallationOperation =
  | { readonly kind: "ensure-directory"; readonly path: string; readonly mode: number }
  | { readonly kind: "ensure-settings"; readonly path: string }
  | { readonly kind: "replace-binary"; readonly source: string; readonly target: string }
  | { readonly kind: "write-plist"; readonly label: string; readonly path: string; readonly xml: string }
  | { readonly kind: "acquire-maintenance-lease"; readonly path: string }
  | { readonly kind: "bootout"; readonly domain: string; readonly label: string }
  | { readonly kind: "bootstrap"; readonly domain: string; readonly plistPath: string }
  | { readonly kind: "remove-file"; readonly path: string }
  | { readonly kind: "remove-tree"; readonly path: string }
  | { readonly kind: "archive-paths"; readonly target: string; readonly paths: readonly string[] };

export interface OperationResult {
  readonly operation: InstallationOperation;
  readonly status: "planned" | "done" | "skipped" | "failed";
  readonly message: string;
}

export interface InstallOptions {
  readonly prefix: string;
  readonly launchd: boolean;
  readonly dryRun: boolean;
  readonly force: boolean;
}

export interface UninstallOptions {
  readonly prefix?: string;
  readonly dryRun: boolean;
  readonly purge: boolean;
  readonly wipe: boolean;
  readonly archive?: string;
  readonly yes: boolean;
}
```

実装時の型名はこの設計に合わせる。
同じ概念を別名で重複定義しない。

## インストールフロー

### 計画

`install` は次の順で現在状態を読む。

1. 実行中バイナリが Bun のコンパイル済み実行体であることを確認する。
2. home、prefix、config、log、plist の絶対パスを解決する。
3. 既存マニフェストを読み、schema を検証する。
4. `settings-read.ts` で `settings.json` を読取検証し、無ければ生成予定として扱う。
5. 設定から必要な認証ファイルと exporter command を解決する。
6. `--launchd` 指定時は共通 run lease、移行前プロセス、exporter、二つの launchd label の登録状態を検査する。
7. `InstallationOperation[]` を生成する。

`--dry-run` はこの時点で plan を表示して終了する。
設定ファイルが無い場合も生成しない。
認証ファイルは `stat` による存在確認だけを行い、内容を読まず、認証クライアントを生成しない。
Google 認証を含む外部 API 通信は行わない。
`launchctl print` は現在状態の読取に限って許可し、`bootstrap`、`bootout`、`enable`、`kickstart` は呼ばない。

### 適用

通常の `install` は次の順で plan を適用する。

1. config ディレクトリが無ければ作る。
2. `--launchd` 指定時は install 用 run lease を取得し、稼働中の serve または pipeline があれば以後の副作用前に中断する。
3. `installing` マニフェストを作り、config を新規作成した場合は `created-paths` へ記録する。
4. `settings.json` が無い場合だけ既存の設定生成関数を呼ぶ。
5. 認証ファイルを再検査する。
6. prefix の `bin` とログディレクトリを作り、新規作成分を `created-paths` へ記録する。
7. バイナリを atomic replacement する。
8. `--launchd` 指定時だけ plist を生成し、二つの label を再登録する。
9. 登録直後に実行体の存在、実行権限、`--version` を確認する。
10. マニフェストを `installed` にする。
11. 削除したもの、作成したもの、残る手作業を表示する。

認証不足はバイナリと launchd を変更する前に失敗させる。
失敗表示には不足ファイル名、期待する絶対パス、README の取得手順を含める。
生成済み `settings.json` は残し、利用者が編集と鍵配置を続けられるようにする。
`install` は `doctor` を呼ばず、Google API への疎通試験を副産物として実行しない。
install lease は成功と失敗のどちらでも `finally` で解放し、receipt と固有 socket は owner token が一致する場合だけ削除する。
安定 lock file は削除せず、file descriptor を最後に close する。

### バイナリの atomic replacement

対象と同じディレクトリに `.scale2sheet.tmp-<pid>` を作る。

次の順で置き換える。

1. `process.execPath` の内容を一時ファイルへコピーする。
2. mode を `0755` にする。
3. ファイルを同期する。
4. 一時ファイルを `<prefix>/bin/scale2sheet` へ `rename` する。
5. 失敗時は一時ファイルだけを削除する。

同じファイルシステム内の `rename` を使うため、実行中プロセスは旧 inode を保持して完走できる。
新しいプロセスは置換後の inode を開く。

`cp` による対象ファイルへの直接上書きは使わない。

## launchd フロー

### plist の ProgramArguments

朝の plist は次の引数を持つ。

```text
<prefix>/bin/scale2sheet
pipeline
--period
morning
```

夜は `evening` とする。

`/bin/bash`、チェックアウト、`scripts/run-pipeline.sh`、`dist/` は plist に含めない。

### 実行時刻

| label | StartCalendarInterval |
| --- | --- |
| morning | 07:00、11:30 |
| evening | 21:00、23:30 |

現行挙動を維持するため、`settings.json` の cron 値から plist を生成しない。
cron 値は `serve` 専用のままとする。
install 完了表示と doctor は launchd の四つの実時刻を列挙し、`morning-cron` と `evening-cron` が `serve` 専用であることを表示する。

### EnvironmentVariables

plist は `HOME`、`PATH`、`SCALE2SHEET_LAUNCHD_LABEL` を明示する。
`SCALE2SHEET_LAUNCHD_LABEL` は、その plist 自身の固定 label とし、run receipt の起動元識別だけに使う。

`PATH` は次を重複除去して連結する。

1. `<prefix>/bin`
2. インストール時に解決できた exporter の親ディレクトリ
3. `/opt/homebrew/bin`
4. `/usr/local/bin`
5. `/usr/bin`
6. `/bin`
7. `/usr/sbin`
8. `/sbin`

対話 shell の `PATH` 全体はコピーしない。
一時的な開発ディレクトリを launchd の恒久設定へ混入させないためである。

### 標準出力と標準エラー

plist の `StandardOutPath` と `StandardErrorPath` は period 別のログファイルを指す。
`StandardErrorPath` が保証するのは起動後の job が出した stderr である。
launchd が実行体を spawn できなかった場合のエラーが、このファイルへ残る保証はない。

### 再登録

label ごとに次を行う。

1. `launchctl print gui/<uid>/<label>` の終了コードだけで登録有無を読む。
2. install process が共通 run lease の owner であることを再確認する。
3. 登録済み label を `bootout` する。
4. plist を一時ファイルから `rename` して置き換える。
5. `launchctl bootstrap gui/<uid> <plist-path>` を実行する。
6. `launchctl print` の終了コードで登録結果を確認する。
7. plist が指す実行体の存在、実行権限、`--version` を確認する。

未登録は正常な `skipped` とする。
権限エラーや不正 plist は無視しない。
`launchctl print` の出力形式と `state` は API ではないためパースしない。
登録判定の契約は終了コードが0か非0かだけとする。
doctor が raw output を補助表示する場合も best-effort の WARN 情報に限定する。
active pipeline lease がある場合は `bootout` を実行せず、完走後の再実行を案内する。
F-e-2 の `--force` は走行中処理の停止と当日データ欠測の可能性を表示してから、その pipeline を停止して再登録する。

## 共通 run lease

`serve`、`pipeline`、`install --launchd`、`uninstall` は、安定 lock file、メタデータ receipt、owner 固有 Unix domain socket を一組で使う。
排他所有権の正本は `/tmp/scale2sheet-<uid>-<namespace>/active-run.lock` に対する Darwin の `O_EXLOCK` とする。
owner は `O_CREAT | O_RDWR | O_EXLOCK_DARWIN | O_NONBLOCK | O_NOFOLLOW` で開いた file descriptor を処理の全期間保持し、子プロセスへ継承させない。
Node.js と Bun の `node:fs.constants` は `O_EXLOCK` を公開しないため、`fs.constants.O_EXLOCK` は使わない。
`run-lease.ts` は Darwin SDK の `sys/fcntl.h` に定義された `O_EXLOCK_DARWIN = 0x0020` を macOS 限定定数として持ち、由来をコードコメントに残す。
open 前に合成済み flags へ `O_EXLOCK_DARWIN` bit が含まれることを assertion し、bit が欠けていれば排他不能として中断する。
この assertion は引数構築だけを保証し、kernel の排他動作は Bun 単体バイナリの2 process 受け入れ試験で保証する。
`process.platform !== "darwin"` ではこの経路を実行せず、未対応 platform として失敗する。
lock file は一度作成した後に unlink、truncate、置換しない。
process の正常終了、signal 終了、SIGKILL では kernel が lock を解放する。
Mac の sleep、event loop stall、高負荷では file descriptor と lock が保持される。
PID、receipt の mtime、壁時計は所有権または生存判定へ使わない。

`~/.config/scale2sheet/active-run.json` は owner token、owner 固有 `socket-path`、`kind`、`period`、`origin`、任意の `launchd-label`、`pid`、`started-at` を持つ。
owner token は128 bit 以上の暗号学的乱数とする。
`origin` は `launchd`、`manual`、`maintenance` のいずれかとする。
`launchd-label` は period に対応する morning または evening の allowlist と一致するときだけ停止対象へ使う。
協調停止要求は `~/.config/scale2sheet/active-run.stop.<owner-token>.json` へ atomic write し、別 owner の receipt を上書きしない。

owner 固有 socket は `/tmp/scale2sheet-<uid>-<namespace>/run-<owner-token>.sock` とする。
listener は接続時に owner token を返し、観測者は receipt の token と一致した場合だけ active と判定する。
macOS の `sockaddr_un.sun_path` は104バイトなので、終端 NUL を除く socket path を UTF-8 で103バイト以下に制限する。
`namespace` は設定ディレクトリの物理 real path を SHA-256 に通した先頭16桁の hex とする。
設定ディレクトリが未作成なら最深の既存祖先を `realpath` し、未作成 suffix を字句正規化して連結する。
作成後に全体を再度 `realpath` し、導出済み namespace と一致しなければ状態不明として中断する。
HOME の symlink alias を字句上の別名のまま hash しない。
同じ設定領域を使う process は同じ lock を共有し、隔離 HOME は本番と異なる短い namespace を得る。
runtime directory は長い `HOME` と `TMPDIR` の影響を受けない `/tmp/scale2sheet-<uid>-<namespace>` に固定し、環境変数または CLI で上書きできない。
stable lock と owner 固有 socket は同じ runtime directory に置く。
`/tmp` の real path に対する `statfs` 結果は Darwin のローカル filesystem allowlist に含まれなければならない。
初期 allowlist は APFS の type `0x1a` だけとし、NFS、SMB、FUSE、未知 type では advisory lock の排他を保証できないため副作用前に中断する。
allowlist を増やす場合は、対象 filesystem 上の Bun 単体バイナリ2 process 受け入れ試験を先に追加する。
runtime directory は絶対パス、mode `0700`、実行 uid 所有、symlink ではないことを検証する。
未存在時は mode `0700` で作成し、同時作成で `EEXIST` になった場合も現物を同じ規則で再検証する。
filesystem、既存 directory、lock file のいずれかが検証に失敗した場合は、削除や作り直しをせずに中断し、owner、mode、filesystem の修復を案内する。
AC-20 の隔離テストは一時 HOME から本番と異なる namespace を導出し、同じ固定 `/tmp` 配下で検証する。

lease の獲得は次の状態機械に従う。

1. runtime directory と安定 lock file を検証する。
2. `O_EXLOCK_DARWIN | O_NONBLOCK` で lock を取得し、取得後の `fstat` で regular file、実行 uid 所有、mode `0600` を確認できた場合だけ、新しい owner になる。
3. lock 取得後に128 bit 以上の owner token を生成し、その token 固有の socket listener を bind する。
4. listener の listen 完了後に receipt を atomic write し、初期化完了とする。
5. lock が `EAGAIN` または `EWOULDBLOCK` なら別 owner の初期化中または稼働中である。
6. receipt を読み、owner 固有 socket から返る token と一致するまで bounded retry する。
7. receipt 不在、schema 不正、token 不一致、接続不能が retry 上限まで続いた場合、または lock がそれ以外の errno を返した場合は状態不明として中断し、`bootout`、置換、削除を行わない。

bind から receipt write までの窓でも lock は既に保持されているため、第二 owner は成立しない。
socket path は owner token ごとに異なるため、古い観測結果を使った unlink または rename が新 owner の listener を隠すこともない。
lock file を共有 socket のように回収しないため、dead path の unlink と bind の間に生じる TOCTOU は存在しない。
lock 取得後の `fstat`、socket bind、listen、receipt write のいずれかに失敗した場合は、作成済み receipt と token 固有 socket だけを検証して除去し、listener と lock file descriptor をすべて close して失敗する。
安定 lock file 自体は、この失敗経路でも削除または変更しない。

owner は15秒間隔の timer で、自分の token に対応する停止要求だけを読む。
exporter の60秒待機中も停止要求の確認を止めない。
pipeline は転記開始前に停止要求を再検査し、serve は次の scheduler cycle へ入らず終了する。

正常終了時は lock を保持したまま receipt の token と path が自分の値に一致することを確認し、自分の token 固有 listener を close して固有 socket file を削除した後、owner token が一致する receipt と停止要求を削除する。
安定 lock file は削除せず、file descriptor を最後に close する。
SIGKILL などで後始末できなかった場合も kernel lock は解放される。
次の取得者だけが lock 取得後に receipt の token と固有 socket path が同じ token を表し、path が検証済み runtime directory 直下にあることを確認してから、その dead owner に属する残骸を回収する。

`install --launchd` は lock の競合と receipt、owner 固有 socket を検査し、active pipeline または active serve なら無変更で中断して完走後の再実行を案内する。
`--force` 指定時だけ停止と当日データ欠測の警告を表示する。
active pipeline には period に対応する launchd label を `bootout` し、PID へ直接 signal を送らない。
manual pipeline または active serve には、owner token 固有の停止要求を atomic write し、owner 自身に終了させる。
停止確認は最大75秒とし、期限内に安定 lock を取得できなければ install を中断する。
期限切れを dead の根拠として処理を続けない。
停止後は lock を取得した owner だけが dead owner の receipt と固有 socket file を回収し、install receipt を作成する。
install receipt の保有中に新しい serve または pipeline が起動しても、exporter と転記を始める前に終了する。
uninstall receipt も同じ排他を提供し、`bootout` からバイナリ削除まで新しい serve または pipeline を開始させない。

`--dry-run` は lock を取得せず、receipt の owner 固有 socket へ接続して snapshot の生存状態を読む。
receipt 不在、schema 不正、token 不一致、接続エラーは bounded retry 後に unknown として表示し、active または inactive と断定しない。
listener の作成、残骸の回収、receipt の変更は行わない。
unknown は実適用を許可する判定へ使わず、dry-run 自体は「適用時に lease 再検査が必要」と計画へ記録して副作用なしで完了する。
この接続は自プロセスと同じ Mac 内の読み取り専用 IPC であり、AC-19 が禁止する外部通信または状態変更には当たらない。

旧版が receipt を持たない移行時だけ、プロセス一覧から `scale2sheet serve`、`node dist/index.js serve`、`scripts/run-pipeline.sh`、`dist/scale2sheet run` を補助検出する。
この補助検出は移行手順10の観測期間と rollback 経路の終了後に削除し、恒久機能にしない。

この lease は現行 `serve` と pipeline に存在しない新しい競合防止機構である。
実装範囲には `src/cli/index.ts` の `serve` 起動と `src/scheduler/scheduler.ts` の終了処理を含める。

## パイプライン

### 入力

```ts
export interface RunPipelineOptions {
  readonly period: "morning" | "evening";
  readonly config: AppConfig;
  readonly processRunner: ProcessRunner;
  readonly delay: (milliseconds: number) => Promise<void>;
  readonly notifier: Notifier;
  readonly clock: Clock;
  readonly statusWriter: PipelineStatusWriter;
  readonly runLease: RunLease;
}
```

`processRunner`、`delay`、`notifier`、`clock`、`statusWriter`、`runLease` はテスト時に差し替える。

### 処理

1. CLI 境界で period を検証し、`morning` と `evening` 以外を副作用前に終了コード2で拒否する。
2. run lease と owner 固有 socket listener を取得し、15秒間隔の停止要求 polling を開始する。
3. 開始時刻と period をログへ出し、`pipeline-status.json` を `running` にする。
4. 設定の既定 source を読む。
5. source が `scale-exporter` の場合だけ exporter を実行する。
6. exporter が失敗した場合は、初回を含め計3回、試行間を60秒空けて再試行する。
7. 各試行の失敗を、時刻と `attempt/3` を含めてログへ出す。
8. exporter が3回失敗した場合は macOS 通知を要求し、status を `failed:exporter` にして非ゼロ終了する。
9. `syncMeasurements` を指定 period と既定 source で実行する。
10. 転記が失敗した場合は macOS 通知を要求し、status を `failed:transfer` にして非ゼロ終了する。
11. 成功時は転記件数または no-data と完了時刻を status とログへ記録する。
12. `finally` で polling と listener を止め、owner token が一致する receipt、固有 socket file、lock file descriptor を順に解放する。

`google-fit` と `apple-health` を既定 source にした場合は exporter を起動しない。
停止要求を受けた pipeline は以後の exporter または転記を開始せず、停止理由を status とログへ記録して終了する。
exporter が失敗した場合は `syncMeasurements` を呼ばない。

`pipeline-status.json` は mode `0600` で atomic replacement する。
period ごとに `last-started-at`、`last-completed-at`、`target-date`、`outcome`、`transferred-count`、`version` を保持する。
認証情報、Spreadsheet ID、測定値は書かない。

`MacOsNotifier` は `/usr/bin/osascript` を shell 非経由で呼び、title を `scale-pipeline`、sound を `Basso` とする。
テストでは `RecordingNotifier` に差し替え、OS 通知を実発火せず要求回数、失敗段階、文面を検証する。

H-2 では launchd がバイナリを直接起動するため、バイナリ自体が欠落または実行不能な場合は通知処理も起動できない。
この場合は通知対象外とする。
登録時点の取り違えは実行体検査で防ぐが、登録完了後の欠落を自動検出する仕組みは置かない。
欠落後の唯一の検出手段は、Spreadsheet の行が増えていないことに利用者が気づくことである。
体重計に乗らなかった日の no-op と、pipeline が起動しなかった未実行は Spreadsheet 上で同じ見た目になる。
この沈黙期間は、単体バイナリ直接起動を優先したユーザーが受容した既知のリスクである。
例外は実行体が起動できない場合だけであり、exporter 失敗と転記失敗は通知する。

### scale_exporter command

`settings.json` に次を追加する。

```json
{
  "scale-exporter-command": "scale_exporter"
}
```

環境変数 `SCALE_EXPORTER_COMMAND` は設定値を上書きする。

値に `/` が含まれる場合はパスとして扱い、存在と実行権限を検査する。
それ以外は command 名として扱い、`PATH` で解決する。

子プロセスは shell を介さず、引数配列 `["--source", "google-fit"]` で起動する。
設定値を shell command として評価しない。
exporter の source は現行 `run-pipeline.sh` と同じ `google-fit` に固定する。
`scale-exporter-command` は実行体の配置差を吸収する設定であり、取得元を選ぶ設定ではない。

exporter が未解決の場合、`pipeline` は候補 command、現在の `PATH`、設定キーを表示して失敗する。
この失敗は exporter 段階の通知対象とする。

## doctor

### 診断契約

`doctor` は利用者が明示的に起動した場合だけ、次を読み取りだけで検査する。

- マニフェストの schema と `state`
- 実行中バイナリ、マニフェスト、plist の配置先整合性、実行権限、`--version`
- `settings.json` の JSON と schema
- Google Sheets 鍵ファイルの存在と読取可否
- source に必要な追加認証ファイル
- scale_exporter command の解決
- scale_exporter 出力ディレクトリ
- 二つの plist の構文と固定チェックアウトパスの不在
- 二つの launchd label の登録状態
- launchd label の登録有無と、best-effort の raw 診断出力、stderr ログの存在
- run receipt による `serve` の稼働状態
- `pipeline-status.json` の直近開始、完了、結果
- Google Sheets 認証
- 対象 Spreadsheet と対象 sheet の読取
- 日付列と当日行の特定

診断結果は `PASS`、`WARN`、`FAIL` で出す。
一つでも `FAIL` があれば非ゼロ終了する。

インストールしていない状態は `WARN` とし、設定だけを診断できるようにする。

診断は Spreadsheet のセル更新、行追加、sheet 作成を行わない。
ローカル設定、マニフェスト、launchd の状態も変更しない。
Google Fit OAuth の再認証も開始しない。

失敗は次の段階を区別して報告する。

- `KEY_MISSING`：必要な鍵が存在しない
- `AUTH_FAILED`：Google 認証に失敗した
- `SHEET_NOT_SHARED`：Spreadsheet を読めない
- `TODAY_ROW_MISSING`：当日行を特定できない
- `INSTALL_PATH_MISMATCH`：実行中バイナリ、マニフェスト、plist の配置先が一致しない
- `BINARY_NOT_EXECUTABLE`：存在する実行体に実行権限が無い
- `BINARY_VERSION_MISMATCH`：実行中バイナリとマニフェストの version が一致しない
- `LAST_RUN_FAILED`：直近の pipeline が失敗した

診断結果には最後に成功した対象日、直近開始時刻、直近完了時刻、outcome、転記件数、launchd stderr のパスを出す。
AC-36 は直近の成功履歴を表示するだけであり、期待どおりか、期待時刻を超過しているかを判定しない。
その判断は表示を見た利用者が行う。
配置先、実行権限、version の不整合では、再ビルドと `scripts/install.sh --launchd` による復旧手順を表示する。
ただし、欠落した実行体と `doctor` は同じバイナリである。
そのバイナリ自体が欠落した場合は `doctor` も起動できず、AC-33 と AC-36 は検出手段にならない。

`install` と `uninstall` は `doctor` を内部から呼ばない。
したがって、インストールの副産物として Google 認証または外部 API 通信が起きる経路を持たない。

## アンインストールフロー

### 既定

`uninstall` はマニフェストを読み、次の順で撤収する。
マニフェストの `prefix` と CLI の `--prefix` が異なる場合は、相違を警告し、記録済み配置先を正本として使う。

1. 共通 run lease と移行前プロセスを検査し、稼働中の serve または pipeline があれば副作用前に中断する。
2. uninstall 用 run lease と owner 固有 socket listener を取得し、新しい serve または pipeline の開始を防ぐ。
3. マニフェストを `uninstalling` にして撤収計画を保存する。
4. 二つの launchd label を `bootout` する。
5. 二つの plist を削除する。
6. `--purge` ではマニフェスト、active run receipt、停止要求以外の追加ローカル対象を退避し、`--wipe` 併用時だけ削除する。
7. `created-paths` に記録された空ディレクトリのうち、config 以外を削除する。
8. マニフェストを削除する。
9. 記録済みバイナリを最終操作として削除する。
10. `finally` で自分の receipt を削除し、config が空かつ `created-paths` に記録済みなら config も削除する。
11. 削除した対象と残した対象を表示する。

`settings.json`、認証情報、ログは残す。

未登録 label、存在しない plist、存在しないバイナリは `skipped` とする。
全対象が無い場合も「何もすることがない」と表示して正常終了する。
uninstall は実行中処理を停止する強制オプションを持たず、処理完了後の再実行を案内する。
uninstall lease は成功と失敗のどちらでも `finally` で解放し、receipt、停止要求、固有 socket は owner token が一致する場合だけ削除する。
安定 lock file は削除せず、file descriptor を最後に close する。
バイナリ削除後の変更は、自分の一時 receipt と空になった作成済み config の後始末だけに限定する。

手順8以前に失敗した場合はバイナリと `uninstalling` マニフェストが残るため、同じコマンドを再実行できる。
手順8の後にバイナリ削除だけが失敗した場合は、実行中の `process.execPath` を残存対象として再実行できる。
マニフェスト削除済みの再実行では、prefix と `process.execPath` が一致する残存バイナリだけを撤収対象として扱う。
バイナリ削除に成功した後に、launchd、plist、設定、認証、ログ、マニフェストを変更する操作は置かない。
receipt の後始末に失敗しても kernel lock は解放されるため、次回 install が lock 取得後に残存 receipt と owner 固有 socket file を回収できる。

完了画面は、残した config とログの絶対パスを列挙する。
空の安定 lock file と runtime directory は競合回避のため unlink せず、秘密情報を含まない一時 runtime artifact として macOS の `/tmp` cleanup に委ねることも表示する。
同時に、後からローカルデータを退避するコマンドを表示するが、実行はしない。
既定アンインストール後はインストール済み実行体が消えているため、再取得した単体バイナリを使うか、checkout で次のように再ビルドして実行する必要があることも表示する。

```text
npm run build:bun && ./dist/scale2sheet uninstall --purge
```

外部権限を失効する手順は、この手動コマンドと分けて表示する。
既定 uninstall 後にマニフェストが無い場合でも、`--purge` が明示され、既知 config またはログが存在するときは data-only purge を計画できる。
data-only purge はバイナリ、plist、launchd label を推測して削除しない。

### purge

ユーザーは P-3 を採用した。
`uninstall --purge` は設定、認証情報、pipeline status、ログを退避し、`--wipe` 併用時だけ退避を作らずに削除する。

| 案 | 挙動 | 帰結 |
| --- | --- | --- |
| P-1 即時削除 | 確認後に設定、認証情報、ログを削除する | `purge` の意味と一致するが不可逆 |
| P-2 退避 | timestamp 付きディレクトリへ移す | 復旧できるが、削除したつもりの秘密情報が残る |
| P-3 退避と wipe（採用） | 既定は退避し、`--wipe` 追加時だけ削除する | 誤操作から復旧でき、セキュリティ目的の削除も明示できる |

退避先は `~/.config/scale2sheet.removed-<timestamp>/` とし、mode を `0700` にする。
退避先のファイルと `archive-manifest.json` は mode `0600` にする。
`archive-manifest.json` は元の絶対パス、退避先の相対パス、元の mode、SHA-256 を記録し、認証情報の内容を持たない。
退避対象は既知の config file、設定から解決した認証 file、ログディレクトリに限定し、symlink と glob を使わない。

退避は次の順で行う。

1. 同じ親ディレクトリに一時退避先を mode `0700` で作る。
2. 各対象を連番の `items/<id>` へコピーし、mode を `0600` 以下に制限して同期する。
3. 元のパス、退避先、mode、SHA-256 を持つ `archive-manifest.json` を atomic write する。
4. 全コピーの SHA-256 を検証してから、一時退避先を最終退避先へ `rename` する。
5. 最終退避先の manifest と hash を再検査した対象だけ、元の場所から削除する。

最終退避先を確定する前に失敗した場合は、元の対象を削除しない。
最終退避先の確定後に元の削除で失敗した場合は、次の再実行で archive manifest と hash を照合してから残存元を削除する。
config の `install-manifest.json`、active run receipt、停止要求は退避対象から除外し、uninstall の最終段階まで残す。
退避後に config が空で `created-paths` に記録されている場合だけ、その config ディレクトリを削除する。

`--purge --wipe` は退避を作らず、同じ対象を論理削除する。
`--archive <dir>` を指定した場合は、そのディレクトリの所有者、mode `0700`、archive manifest、全項目の相対パスを検証し、その退避先だけを削除する。
`--wipe` は APFS または SSD 上の物理的な安全消去を保証せず、ファイルシステム上から参照できない状態にする操作を意味する。

確認前に次を表示する。

- 退避または削除するローカルパス
- `--purge` では退避先の絶対パス
- 退避は削除ではなく、サービスアカウント鍵と OAuth token が平文のままディスクに残ること
- セキュリティ目的のローカル削除には `--purge --wipe` が必要なこと
- `--wipe` も APFS または SSD 上の物理的な安全消去を保証しないこと
- GCP 側の鍵は失効しないこと
- Spreadsheet の共有は解除されないこと
- 完全撤収には GCP Console での鍵失効と Spreadsheet の共有解除が必要なこと

対話端末の `--purge` は、退避先と秘密情報が残ることを表示して確認を求める。
対話端末の `--purge --wipe` は、復旧不能なローカル削除であることを表示して別の破壊確認を求める。
非対話端末では、どちらも `--yes` が無い場合に失敗する。

`--purge --yes` はローカル確認を省略するだけである。
外部権限の操作は行わない。
`--purge` 完了時は、退避先の絶対パス、退避が削除ではないこと、元のパスを持つ archive manifest、後から削除する次のコマンドを表示する。

```text
npm run build:bun && ./dist/scale2sheet uninstall --purge --wipe --archive <archive-dir>
```

このコマンドは checkout から再ビルドする場合の表示例である。
再取得した単体バイナリがある場合は、その絶対パスへ置き換える。

### dry-run

`uninstall --dry-run` はマニフェストと現物を読み、削除対象と残置対象を表示する。
`--purge` と組み合わせた場合は退避対象、退避先、元の削除予定を表示する。
`--purge --wipe` と組み合わせた場合は退避を作らずに削除する対象を表示する。
どの場合もファイルを作成、変更、削除しない。
確認入力も求めない。

## エラーと部分適用

各操作は次の書式で一行出力する。

```text
[done] replace-binary /Users/example/.local/bin/scale2sheet
[skipped] bootout jp.seijin.kappa.scale-pipeline.morning: not loaded
[failed] bootstrap jp.seijin.kappa.scale-pipeline.evening: <launchctl message>
```

失敗時は次を続けて表示する。

```text
Completed:
  settings
  binary
Failed:
  launchd-evening
Pending:
  manifest-finalize
Retry:
  scale2sheet install --launchd
```

ログやエラーに認証 JSON の内容を出さない。
パスは出力してよい。

失敗後の自動 rollback は行わない。
各操作を冪等にし、同じコマンドの再実行で修復する。

## セキュリティ

- shell を介して exporter command または path を実行しない。
- plist XML の値は XML escape する。
- マニフェストは zod schema で検証し、未知 schema version を削除処理へ使わない。
- `--prefix` は絶対パスへ正規化し、`/`、home、config、ログ、LaunchAgents を prefix として拒否する。
- 削除対象はマニフェストまたは明示 `--prefix` から解決した完全パスに限定する。
- symlink を辿って config またはログの外側を再帰削除しない。
- `--purge` の対象を glob で解決しない。
- 退避先、archive manifest、退避ファイルをそれぞれ mode `0700`、`0600`、`0600` で作る。
- 退避は削除ではなく、認証情報が平文でディスクに残ることを完了表示から省かない。
- `--archive` は current uid 所有、mode `0700`、symlink ではないディレクトリだけを受け付ける。
- `--wipe` は物理的な安全消去を保証しない。
- runtime directory と安定 lock file は `statfs`、`O_NOFOLLOW`、`fstat` で検証し、非ローカル filesystem、不正な owner、mode、file type を自動修復しない。
- stable lock path は検証済みローカル `/tmp` 配下の決定的 namespace に固定し、任意パス上書きを許可しない。
- 安定 lock file を cleanup または uninstall で unlink、truncate、置換しない。
- 認証ファイルの内容を doctor、manifest、操作結果へ含めない。
- doctor は読取 API だけを使い、write 系 API を依存として受け取らない。

## テスト設計

### ユニットテスト

| 対象 | 検証 |
| --- | --- |
| `paths.ts` | home と prefix の正規化、危険 prefix の拒否 |
| `manifest.ts` | schema、unknown version、atomic write、三つの state、`created-paths` |
| `archive.ts` | staging、SHA-256、archive manifest、mode、再実行、symlink 拒否、wipe |
| `plist.ts` | XML escape、ProgramArguments、時刻、PATH、固定チェックアウトパス不在 |
| `settings-read.ts` | 未存在時にもファイルを生成しない読取と schema 検証 |
| `planner.ts` | 初回、再実行、部分適用、dry-run、purge、active run 中断の操作順 |
| `executor.ts` | done、skipped、failed の記録と中断位置 |
| `process.ts` | launchctl print の終了コードによる登録有無、変更系呼出、移行時プロセス検出、待機上限の分類 |
| `doctor.ts` | PASS、WARN、FAIL、失敗段階、直近成功報告、読取 API だけの呼び出し、install からの非呼出 |
| `sheets-read.ts` | 認証、Spreadsheet 読取、当日行特定、write メソッドの不在 |
| `pipeline.ts` | 初回を含む3回、60秒を2回、失敗後の転記抑止、period 拒否、時刻ログ |
| `notifier.ts` | exporter と転記の通知要求、title、sound、実通知を使わない fake |
| `status.ts` | period ごとの atomic write、対象日、成功時刻、結果、件数 |
| `run-lease.ts` | raw `O_EXLOCK_DARWIN = 0x0020` と flag assertion、単一 owner、kernel 解放、real path 由来 namespace、ローカル filesystem allowlist、owner 固有 socket、token handshake、初期化窓の unknown、103バイト制限、runtime directory 検証、協調停止 |

### 隔離統合テスト

`HOME`、`TMPDIR`、prefix を一時ディレクトリへ差し替える。

launchctl、osascript、scale_exporter は実行ファイル stub または process adapter の fake を使う。
実ユーザーの LaunchAgents、設定、ログ、Spreadsheet へ触れない。

次を自動化する。

1. 初回 install 後にバイナリ、設定、マニフェストが存在する。
2. 連続 2 回 install して設定内容が一致する。
3. 実行中バイナリを模した open file があっても置換後の新規実行が成功する。
4. install と uninstall の `--dry-run` 前後でファイル tree が一致し、launchctl の変更系呼出と network adapter 呼出がゼロで、ネットワーク遮断環境でも成功する。
5. `serve` 生存時の `--launchd` が失敗する。
6. 既定 uninstall 後に設定、認証、ログが残る。
7. purge は確認無しで失敗し、`--yes` で mode `0700` の退避先と archive manifest を作る。`--wipe --yes` だけが退避を作らずにローカル対象を削除する。
8. 未インストール uninstall が正常終了する。
9. チェックアウトをリネームした後も、インストール済みバイナリの `--version` と plist の ProgramArguments が有効である。
10. `install` は network adapter を呼ばず、明示的な `doctor` だけが Google Sheets の読取 API を呼ぶ。
11. doctor の fake API は認証、Spreadsheet 読取、当日行特定を順に返し、write API の呼出回数がゼロである。
12. active pipeline lease がある間は `bootout` と置換を行わず、無変更で中断する。
13. `uninstalling` の各中断点とマニフェスト削除後のバイナリ削除失敗から同じ uninstall を再実行でき、バイナリ削除後は一時 receipt の後始末以外の変更操作が残らない。
14. exporter が3回失敗すると delay が2回とも60,000msで、転記を呼ばず、通知要求を1回記録する。
15. 転記失敗は別の通知要求を記録し、成功時は対象日、結果、件数を status へ保存する。
16. plist、README、installer の fixture に `scripts/run-pipeline.sh` 参照が無い。
17. `--force` 時だけ active pipeline の label を `bootout` し、処理停止と当日データ欠測の警告を記録する。manual pipeline と serve には owner token 付きの協調停止を要求する。
18. Node 実行と Bun 単体バイナリのそれぞれで、別 process が同時に lease を取得しても `O_EXLOCK` の owner は一つだけであり、owner の sleep 中は競合側が `EAGAIN` または `EWOULDBLOCK`、SIGKILL 後は次の取得者が成功する。少なくとも Bun 単体バイナリの2 process 競合と SIGKILL 解放を受け入れ試験で実行し、単一 process の取得成功だけで代替しない。
19. lock 保持から receipt 確定までの窓では競合側が bounded retry 後に unknown で中断し、receipt token と owner 固有 socket の応答が一致した場合だけ active と判定する。
20. active pipeline lease がある間は uninstall が `bootout` と削除を行わず、lease 解放後の再実行で撤収できる。
21. `--purge --dry-run` は退避先と対象を表示して変更せず、`--purge --wipe --dry-run` は削除対象を表示して変更しない。
22. 退避確定前の失敗では元ファイルが残り、確定後の中断からは hash 一致を確認して再実行できる。
23. 長い隔離 `HOME` と `TMPDIR` でも設定ディレクトリの real path から短い固有 namespace を導出して成功する。異なる実体の HOME は別 lock を使い、同じ実体を指す symlink alias は同じ lock を使う。UTF-8 で103バイトを超える固有 socket path は副作用前に拒否する。
24. `statfs` が APFS 以外を返す場合、または runtime directory の owner、mode、symlink 検証に失敗した場合は作り直さずに中断する。任意の lock path 上書きで回避できないことも検証する。
25. stale receipt を読んだ競合側が新 owner の token 固有 socket を unlink または rename せず、旧 owner の cleanup も新 owner の socket に触れない。

### macOS 手動受け入れ

実 launchd を使う検証は、一時 label と一時 prefix で実行する。
既存の本番 label を自動テストで操作しない。

確認項目は次のとおりである。

- `launchctl bootstrap` と `print`
- 再インストール時の `bootout` と `bootstrap`
- 朝夕 plist の ProgramArguments
- ログファイルの作成
- OS 通知
- 実行中旧バイナリの完走
- doctor による Google 認証、Spreadsheet 読取、当日行特定
- doctor 前後で対象 Spreadsheet とローカル状態が不変であること
- pipeline の直近成功後に doctor が対象日、成功時刻、結果を報告すること

## AC 対応

ACCEPTANCE_TEST_REPORT には各条件を「自動」「代理指標」「手動」のいずれで確認したかを記録する。

| AC | 検証方式 | 設計箇所と判定材料 |
| --- | --- | --- |
| AC-01、AC-02 | 自動 | 初回ブートストラップ、`<prefix>/bin/scale2sheet --version` |
| AC-03 | 代理指標と手動 | plist と manifest の固定パス不在を自動検査し、チェックアウト移動後の実 launchd は手動実行 |
| AC-04、AC-05 | 自動 | 認証不足と `--launchd` 無指定の隔離統合テスト |
| AC-06 | 代理指標と手動 | 一時 label または launchctl adapter の引数を自動検査し、本番 label は手動確認 |
| AC-07 | 自動 | plist の ProgramArguments、PATH、固定文字列検査 |
| AC-08、AC-09、AC-10、AC-11、AC-12、AC-13、AC-14 | 自動 | `uninstalling`、purge、manifest、未導入の隔離統合テスト |
| AC-15、AC-16、AC-17、AC-18 | 自動 | 再実行、run receipt、atomic replacement、serve 競合 |
| AC-19、AC-23 | 自動 | dry-run の変更系 launchctl、filesystem、network 呼出ゼロ |
| AC-20 | 自動 | AC-01 から AC-38 のうち副作用を伴うものを、本番と異なる短い namespace を導出する隔離 HOME と process、filesystem、network adapter で実行する。表に明記した代理指標と手動試験だけを例外とする |
| AC-21 | 自動 | 各中断点の操作結果、完了済み操作、未実行操作、再実行方法 |
| AC-22 | 自動 | README の正本経路と旧手順不在の静的検査 |
| AC-24 | 代理指標と手動 | 読取専用 fake API を自動検査し、実 Spreadsheet は手動確認 |
| AC-25 | 自動 | install から doctor と network adapter を呼ばない境界 |
| AC-26 | 自動 | process fake 3回、delay fake 60,000msを2回 |
| AC-27、AC-28 | 代理指標と手動 | RecordingNotifier で2段階の要求を自動検査し、実通知は手動確認。H-2 の実行体欠落は通知対象外 |
| AC-29、AC-30 | 自動 | clock fake、ログ、period validation、exporter 失敗後の転記非呼出 |
| AC-31 | 自動 | process、delay、clock、notifier、runLease の port を使うユニットテスト |
| AC-32 | 自動 | plist、README、installer から `scripts/run-pipeline.sh` 参照がゼロである静的検査 |
| AC-33 | 自動 | 実行体が存在する隔離環境で、設定破損、認証切れ、権限不足、配置先不整合を doctor が報告する。実行体欠落は適用範囲外 |
| AC-34 | 自動 | plist の StandardErrorPath を検査する。launchd が実行体を spawn できない場合は適用範囲外 |
| AC-35 | 自動と手動 | 登録直後の存在、実行権限、version 検査を自動化し、一時 label で手動確認 |
| AC-36 | 自動と手動 | status fixture の対象日、成功時刻、結果の表示を自動検査し、実 run 後に表示を手動確認する。期待どおりか、期待時刻を超過したかは利用者が判断し、doctor は判定しない |
| AC-37、AC-38 | 代理指標と手動 | run lease adapter で通常中断と force 停止警告を自動検査し、一時 label の実 job で手動確認 |

## 移行

実装は次の順で行う。

1. `APP_VERSION`、読取専用設定ローダ、`scale-exporter-command`、共通 run lease を追加する。
2. pipeline、通知 port、status を TypeScript へ移し、H-a、H-b、H-d、H-e、H-f と H-c の2段階通知を fake で検証する。
3. planner、manifest、plist、executor、doctor を実装する。
4. CLI と極薄 `scripts/install.sh` を接続する。
5. 隔離統合テストと AC-32 の静的検査を追加する。
6. 現行 revision、plist、`run-pipeline.sh` を rollback ディレクトリへ保存する。
7. 新経路を一時 prefix と一時 label で受け入れた後、本番 label へ適用する。
8. README の旧手順を新 CLI へ置換するが、旧 script は観測期間中だけ repository に残す。
9. 朝と夜の両 period について、実行証跡がある run の status と Spreadsheet に後退がなく、失敗を注入した受け入れ試験では2段階の通知要求が維持される状態を連続7日確認する。
10. 各 period で少なくとも一度は launchd 起動の成功証跡があり、観測期間を満たした後に静的 plist と `scripts/run-pipeline.sh` を削除する。
11. rollback 経路を終了した同じ移行完了変更で、旧 process 一覧の補助検出を削除する。

rollback 条件は、実行体が起動した後の pipeline failure、受け入れ試験での通知要求 failure、実行証跡がある転記結果の後退のいずれかとする。
実行証跡が無いことを自動的な欠落判定または rollback 条件にはしない。
実行体欠落後は Spreadsheet の行が増えないことへの利用者の気づきしかなく、no-op と未実行を区別できない。
rollback 時は新 label を `bootout` し、保存済み script と legacy plist を戻して `bootstrap` する。
この緊急経路は一時的にチェックアウト依存へ戻るため、原因修正後は新 installer を再適用する。
rollback 後も status、ログ、設定、認証情報は削除しない。

## 決定状態

論点 A から H と P-3 はユーザー決定済みであり、本書の status は `accepted` である。
実行体欠落を通知対象外とし、自動検出手段を置かない境界も決定済みである。
レビュー完了後に実装計画を別文書として作成し、programmer へ引き渡す。
