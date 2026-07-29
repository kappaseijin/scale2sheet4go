---
type: Design
title: scale2sheet インストール設計
description: 単体バイナリの独立配置、launchd 登録、診断、アンインストール、パイプライン移行を定義する。
tags:
  - design
  - installer
  - launchd
  - scale2sheet
status: proposed
timestamp: "2026-07-29T10:43:00+09:00"
---

# scale2sheet インストール設計

## 適用状態

独立配置 A-2、既定アンインストールで設定と認証を残す方針、内蔵 pipeline を単体バイナリから直接起動する H-2 はユーザー決定済みである。

論点 B、C、D、F、G と `--purge` の削除方式は未決定である。
本書は `docs/decisions/2026-07-29T091044_インストーラとアンインストーラの設計方式.md` の推奨案を具体化した proposed 設計であり、実装開始を許可する文書ではない。

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
scale2sheet uninstall [--prefix <dir>] [--dry-run] [--purge] [--yes]
scale2sheet doctor
scale2sheet pipeline --period <morning|evening>
```

### オプション

| オプション | コマンド | 既定 | 説明 |
| --- | --- | --- | --- |
| `--prefix <dir>` | `install`, `uninstall` | `~/.local` | インストールルート。バイナリは `<dir>/bin/scale2sheet` に置く |
| `--launchd` | `install` | 無効 | 朝夕の二つの LaunchAgent を生成して登録する |
| `--dry-run` | `install`, `uninstall` | 無効 | 外部通信を含む副作用を起こさず、実行予定の操作を順序付きで表示する |
| `--force` | `install --launchd` | 無効 | F-d と F-e-2 を採用した場合、稼働中処理を停止して再登録する |
| `--purge` | `uninstall` | 無効 | 設定、認証情報、ログも削除対象にする |
| `--yes` | `uninstall --purge` | 無効 | 非対話実行で破壊確認を明示する |

`--force` は認証不足、実行不能な exporter、不正設定、launchctl の失敗を無視しない。
稼働中処理を停止する場合は、処理の中断と当日データ欠測の可能性を実行前に表示する。

`--yes` は GCP 側の鍵失効または Spreadsheet の共有解除への同意を意味しない。

## 配置

### 既定パス

```text
~/.local/bin/scale2sheet
~/.config/scale2sheet/settings.json
~/.config/scale2sheet/install-manifest.json
~/.config/scale2sheet/active-run.json
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
| `pipeline-status.json` | `0600` |
| `settings.json` | 既存 mode を保持。新規生成時は `0600` |
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
  | { readonly kind: "remove-tree"; readonly path: string };

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
6. `--launchd` 指定時は共通 run receipt、移行前プロセス、exporter、二つの launchd label の登録状態を検査する。
7. `InstallationOperation[]` を生成する。

`--dry-run` はこの時点で plan を表示して終了する。
設定ファイルが無い場合も生成しない。
認証ファイルは `stat` による存在確認だけを行い、内容を読まず、認証クライアントを生成しない。
Google 認証を含む外部 API 通信は行わない。
`launchctl print` は現在状態の読取に限って許可し、`bootstrap`、`bootout`、`enable`、`kickstart` は呼ばない。

### 適用

通常の `install` は次の順で plan を適用する。

1. config ディレクトリが無ければ作る。
2. `--launchd` 指定時は install 用 run receipt を取得し、稼働中の serve または pipeline があれば以後の副作用前に中断する。
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
install receipt は成功と失敗のどちらでも `finally` で解放し、owner token が一致する場合だけ削除する。

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
2. active run receipt が無いことを再確認する。
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
active pipeline receipt がある場合は `bootout` を実行せず、完走後の再実行を案内する。
推奨 F-e-2 を採用した場合、`--force` は走行中処理の停止と当日データ欠測の可能性を表示してから、その pipeline を停止して再登録する。

## 共通 run receipt

`serve`、`pipeline`、`install --launchd`、`uninstall` は `~/.config/scale2sheet/active-run.json` を atomic create する。
作成には `open(path, "wx")` を使い、既存 receipt を上書きしない。
receipt は owner token、`kind`、`period`、`origin`、任意の `launchd-label`、`pid`、`started-at`、任意の `stop-requested-at` を持つ。
`origin` は `launchd`、`manual`、`maintenance` のいずれかとする。
`launchd-label` は period に対応する morning または evening の allowlist と一致するときだけ停止対象へ使う。
owner は15秒間隔の独立 timer で mtime を更新する。
exporter の60秒待機中も heartbeat を止めない。
owner は heartbeat ごとに自分の token に対する停止要求も読む。
pipeline は転記開始前に停止要求を再検査し、serve は次の scheduler cycle へ入らず終了する。

生存判定の正本は mtime が現在時刻から60秒以内であることとする。
`kill(pid, 0)` は判定窓を縮める補助にだけ使い、PID の再利用があるため単独の根拠にしない。
60秒を超えた receipt は、install、uninstall、serve、pipeline の次の取得者が stale 名へ atomic rename して回収する。
取得者は新しい owner token で `open(path, "wx")` を再試行する。
旧 owner の heartbeat と解放処理は token の一致を確認し、所有権を失った receipt を更新または削除しない。
signal と正常終了時も、自分が所有する receipt だけを削除する。

`install --launchd` は receipt の mtime と owner token を読む。
active pipeline または active serve なら無変更で中断し、完走後の再実行を案内する。
推奨 F-e-2 を採用した場合、`--force` 指定時だけ停止と当日データ欠測の警告を表示する。
active pipeline には period に対応する launchd label を `bootout` し、PID へ直接 signal を送らない。
manual pipeline または active serve には、owner token が一致する receipt へ停止要求を atomic write し、owner 自身に終了させる。
停止確認は最大75秒とする。
これは heartbeat 間隔15秒と stale 閾値60秒を一度ずつ待てる上限である。
停止要求へ応答しない manual pipeline または serve がある場合は、別 PID を停止する危険を避けるため install を中断する。
停止後は receipt の解放または stale 回収を確認してから install receipt を取得する。
install receipt の保有中に新しい serve または pipeline が起動しても、exporter と転記を始める前に終了する。
uninstall receipt も同じ排他を提供し、`bootout` からバイナリ削除まで新しい serve または pipeline を開始させない。

旧版が receipt を持たない移行時だけ、プロセス一覧から `scale2sheet serve`、`node dist/index.js serve`、`scripts/run-pipeline.sh`、`dist/scale2sheet run` を補助検出する。

この receipt は現行 `serve` と pipeline に存在しない新しい競合防止機構である。
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
2. run receipt を取得し、15秒 heartbeat を開始する。
3. 開始時刻と period をログへ出し、`pipeline-status.json` を `running` にする。
4. 設定の既定 source を読む。
5. source が `scale-exporter` の場合だけ exporter を実行する。
6. exporter が失敗した場合は、初回を含め計3回、試行間を60秒空けて再試行する。
7. 各試行の失敗を、時刻と `attempt/3` を含めてログへ出す。
8. exporter が3回失敗した場合は macOS 通知を要求し、status を `failed:exporter` にして非ゼロ終了する。
9. `syncMeasurements` を指定 period と既定 source で実行する。
10. 転記が失敗した場合は macOS 通知を要求し、status を `failed:transfer` にして非ゼロ終了する。
11. 成功時は転記件数または no-data と完了時刻を status とログへ記録する。
12. `finally` で heartbeat を止め、owner token が一致する receipt を解放する。

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
- 記録済みバイナリの存在、実行権限、`--version`
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
- `BINARY_MISSING`：マニフェストまたは plist が指す実行体が無い
- `BINARY_NOT_EXECUTABLE`：実行体に実行権限が無い
- `LAST_RUN_FAILED`：直近の pipeline が失敗した

診断結果には最後に成功した対象日、直近開始時刻、直近完了時刻、outcome、転記件数、launchd stderr のパスを出す。
AC-36 はこの情報を報告するだけであり、期待時刻の超過を判定しない。
`BINARY_MISSING` と `BINARY_NOT_EXECUTABLE` では、再ビルドと `scripts/install.sh --launchd` による復旧手順を表示する。
ただし、欠落した実行体と `doctor` は同じバイナリである。
そのバイナリ自体が欠落した場合は `doctor` も起動できず、AC-33 と AC-36 は検出手段にならない。

`install` と `uninstall` は `doctor` を内部から呼ばない。
したがって、インストールの副産物として Google 認証または外部 API 通信が起きる経路を持たない。

## アンインストールフロー

### 既定

`uninstall` はマニフェストを読み、次の順で撤収する。
マニフェストの `prefix` と CLI の `--prefix` が異なる場合は、相違を警告し、記録済み配置先を正本として使う。

1. 共通 run receipt と移行前プロセスを検査し、稼働中の serve または pipeline があれば副作用前に中断する。
2. uninstall 用 run receipt を atomic create し、新しい serve または pipeline の開始を防ぐ。
3. マニフェストを `uninstalling` にして撤収計画を保存する。
4. 二つの launchd label を `bootout` する。
5. 二つの plist を削除する。
6. `--purge` の採用方式に従い、マニフェストと active run receipt 以外の追加ローカル対象を処理する。
7. `created-paths` に記録された空ディレクトリのうち、config 以外を削除する。
8. マニフェストを削除する。
9. 記録済みバイナリを最終操作として削除する。
10. `finally` で自分の receipt を削除し、config が空かつ `created-paths` に記録済みなら config も削除する。
11. 削除した対象と残した対象を表示する。

`settings.json`、認証情報、ログは残す。

未登録 label、存在しない plist、存在しないバイナリは `skipped` とする。
全対象が無い場合も「何もすることがない」と表示して正常終了する。
uninstall は実行中処理を停止する強制オプションを持たず、処理完了後の再実行を案内する。
uninstall receipt は成功と失敗のどちらでも `finally` で解放し、owner token が一致する場合だけ削除する。
バイナリ削除後の変更は、自分の一時 receipt と空になった作成済み config の後始末だけに限定する。

手順8以前に失敗した場合はバイナリと `uninstalling` マニフェストが残るため、同じコマンドを再実行できる。
手順8の後にバイナリ削除だけが失敗した場合は、実行中の `process.execPath` を残存対象として再実行できる。
マニフェスト削除済みの再実行では、prefix と `process.execPath` が一致する残存バイナリだけを撤収対象として扱う。
バイナリ削除に成功した後に、launchd、plist、設定、認証、ログ、マニフェストを変更する操作は置かない。
receipt の後始末に失敗しても60秒後に stale となり、次回 install が回収できる。

完了画面は、残した config とログの絶対パスを列挙する。
同時に、後からローカルデータだけを削除するための `rm -rf -- <config-dir> <log-dir>` を表示するが、実行はしない。
外部権限を失効する手順は、この手動コマンドと分けて表示する。

### purge

`--purge` の処理方式はユーザー未決定である。
本書は、削除対象を即時削除する P-1 を推奨案として具体化するが、決定前に実装しない。

| 案 | 挙動 | 帰結 |
| --- | --- | --- |
| P-1 即時削除（推奨） | 確認後に設定、認証情報、ログを削除する | `purge` の意味と一致するが不可逆 |
| P-2 退避 | timestamp 付きディレクトリへ移す | 復旧できるが、削除したつもりの秘密情報が残る |
| P-3 退避と wipe | 既定は退避し、追加フラグで削除する | 意図を表せるが、CLI と試験経路が増える |

P-1 の `uninstall --purge` は既定対象に config ディレクトリとログディレクトリを追加する。

削除前に次を表示する。

- 削除するローカルパス
- GCP 側の鍵は失効しないこと
- Spreadsheet の共有は解除されないこと
- 完全撤収には GCP Console での鍵失効と Spreadsheet の共有解除が必要なこと

対話端末では明示確認を求める。
非対話端末では `--yes` が無い場合に失敗する。

`--purge --yes` はローカル確認を省略するだけである。
外部権限の操作は行わない。

### dry-run

`uninstall --dry-run` はマニフェストと現物を読み、削除計画を表示する。
`--purge` と組み合わせた場合も削除しない。
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
- 認証ファイルの内容を doctor、manifest、操作結果へ含めない。
- doctor は読取 API だけを使い、write 系 API を依存として受け取らない。

## テスト設計

### ユニットテスト

| 対象 | 検証 |
| --- | --- |
| `paths.ts` | home と prefix の正規化、危険 prefix の拒否 |
| `manifest.ts` | schema、unknown version、atomic write、三つの state、`created-paths` |
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
| `run-lease.ts` | O_EXCL、15秒 heartbeat、60秒 stale、owner token、PID 再利用、協調停止、signal cleanup |

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
7. purge は確認無しで失敗し、`--yes` でローカル対象だけを削除する。
8. 未インストール uninstall が正常終了する。
9. チェックアウトをリネームした後も、インストール済みバイナリの `--version` と plist の ProgramArguments が有効である。
10. `install` は network adapter を呼ばず、明示的な `doctor` だけが Google Sheets の読取 API を呼ぶ。
11. doctor の fake API は認証、Spreadsheet 読取、当日行特定を順に返し、write API の呼出回数がゼロである。
12. active pipeline receipt がある間は `bootout` と置換を行わず、無変更で中断する。
13. `uninstalling` の各中断点とマニフェスト削除後のバイナリ削除失敗から同じ uninstall を再実行でき、バイナリ削除後は一時 receipt の後始末以外の変更操作が残らない。
14. exporter が3回失敗すると delay が2回とも60,000msで、転記を呼ばず、通知要求を1回記録する。
15. 転記失敗は別の通知要求を記録し、成功時は対象日、結果、件数を status へ保存する。
16. plist、README、installer の fixture に `scripts/run-pipeline.sh` 参照が無い。
17. `--force` 時だけ active pipeline の label を `bootout` し、処理停止と当日データ欠測の警告を記録する。manual pipeline と serve には owner token 付きの協調停止を要求する。
18. fake clock を61秒進めると stale receipt を回収でき、旧 owner は新 receipt を更新または削除できない。
19. exporter の60秒 delay 中にも heartbeat が少なくとも3回更新される。
20. active pipeline receipt がある間は uninstall が `bootout` と削除を行わず、receipt 解放後の再実行で撤収できる。

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
| AC-20、AC-21 | 自動 | process adapter、隔離 HOME、操作結果 |
| AC-22 | 自動 | README の正本経路と旧手順不在の静的検査 |
| AC-24 | 代理指標と手動 | 読取専用 fake API を自動検査し、実 Spreadsheet は手動確認 |
| AC-25 | 自動 | install から doctor と network adapter を呼ばない境界 |
| AC-26 | 自動 | process fake 3回、delay fake 60,000msを2回 |
| AC-27、AC-28 | 代理指標と手動 | RecordingNotifier で2段階の要求を自動検査し、実通知は手動確認。H-2 の実行体欠落は通知対象外 |
| AC-29、AC-30 | 自動 | clock fake、ログ、period validation、exporter 失敗後の転記非呼出 |
| AC-31 | 自動 | process、delay、clock、notifier、runLease の port を使うユニットテスト |
| AC-32 | 自動 | plist、README、installer から `scripts/run-pipeline.sh` 参照がゼロである静的検査 |
| AC-33 | 自動 | 起動できる doctor が manifest 上の実行体欠落と実行権限を報告する fixture。doctor 自体の欠落は適用範囲外 |
| AC-34 | 自動 | plist の StandardErrorPath を検査する。launchd が実行体を spawn できない場合は適用範囲外 |
| AC-35 | 自動と手動 | 登録直後の存在、実行権限、version 検査を自動化し、一時 label で手動確認 |
| AC-36 | 自動と手動 | status fixture の対象日、成功時刻、結果を自動検査し、実 scheduled run 後に手動確認。期待時刻超過は判定しない |
| AC-37、AC-38 | 代理指標と手動 | run receipt adapter で通常中断と force 停止警告を自動検査し、一時 label の実 job で手動確認 |

## 移行

採用後の実装は次の順で行う。

1. `APP_VERSION`、読取専用設定ローダ、`scale-exporter-command`、共通 run receipt を追加する。
2. pipeline、通知 port、status を TypeScript へ移し、H-a から H-f を fake で検証する。
3. planner、manifest、plist、executor、doctor を実装する。
4. CLI と極薄 `scripts/install.sh` を接続する。
5. 隔離統合テストと AC-32 の静的検査を追加する。
6. 現行 revision、plist、`run-pipeline.sh` を rollback ディレクトリへ保存する。
7. 新経路を一時 prefix と一時 label で受け入れた後、本番 label へ適用する。
8. README の旧手順を新 CLI へ置換するが、旧 script は観測期間中だけ repository に残す。
9. 朝と夜の両 period が連続7日成功し、通知、status、Spreadsheet に後退が無いことを確認する。
10. 観測期間を満たした後に静的 plist と `scripts/run-pipeline.sh` を削除する。

rollback 条件は、予定された実行の欠落、pipeline の失敗、通知要求の欠落、転記結果の後退のいずれかとする。
rollback 時は新 label を `bootout` し、保存済み script と legacy plist を戻して `bootstrap` する。
この緊急経路は一時的にチェックアウト依存へ戻るため、原因修正後は新 installer を再適用する。
rollback 後も status、ログ、設定、認証情報は削除しない。

## ユーザー決定ゲート

論点 B、C、D、F（F-e を含む）、G と `--purge` の方式が採用されるまで実装へ進まない。
H-2 と、実行体欠落を通知対象外とする境界はユーザー決定済みである。

採用後に本書の `status` を `accepted` へ変え、実装計画を別文書として作成する。
