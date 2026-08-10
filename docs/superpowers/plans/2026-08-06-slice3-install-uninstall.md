---
type: ImplementationPlan
title: Ph.15 Slice 3（install と既定 uninstall）実装計画
description: accepted な実装分割と INSTALLATION_DESIGN が要求する install / 既定 uninstall の lifecycle を、実装順・PR 粒度・AC 対応・負のコントロールへ落とす。
tags:
  - plan
  - scale2sheet
  - installer
  - slice-3
timestamp: "2026-08-06T23:11:19+09:00"
updated: "2026-08-09T15:30:00+09:00"
status: implemented
implemented_by: d1f98bc
implemented_pr: 139
---

# Ph.15 Slice 3（install と既定 uninstall）実装計画

> # ⚠ 本書は実装後にマージされた記録である。実行しないこと
>
> **Slice 3 は実装・マージ済みである**（`d1f98bc` / PR #139、2026-08-08）。
> **以下の Task 1〜9 は履歴であって、実行すべき指示ではない。**
>
> **未チェックのチェックボックス 42 個は「残作業 42 件」を意味しない。**
> 起草時のまま残してあるだけである。**進捗の記録として読まないこと。**
>
> 実装済みであることの実測（2026-08-09、main `1ca0c8b`）:
>
> ```
> src/installation/  model.ts / paths.ts / manifest.ts / planner.ts / executor.ts
>                    binary-copy-source.ts / plist.ts        すべて存在
> src/cli/installation.ts:365  .command("install")
> src/cli/installation.ts:376  .command("uninstall")
> scripts/run-installer-acceptance.sh                        存在
> test/installation/  8 ファイル
> ```
>
> **本書を残す理由は、実装から読み取れないものが書かれているからである**——
> PR の粒度をなぜそう切ったか、AC をどう対応づけたか、どの負のコントロールを置いたか。
> **コードとテストは「何をしたか」を残すが、「なぜその分割か」を残さない。**
>
> **初版にあった「REQUIRED SUB-SKILL: … implement this plan task-by-task」の指示は削除した。**
> 実装済みの計画に実行指示が残っていると、**将来のエージェントが再実行する。**

起草: `scale2sheet_architect_claude`（2026-08-06 JST）

検証: 未実施（検証席は codex。Issue #133 により 2026-08-08 まで停止）

| 項目 | 値 |
| --- | --- |
| 基準 main | `4a33602` |
| 実測日時 | 2026-08-06T23:00:00+09:00 前後 |
| 正本 | [インストーラ実装分割と受け入れ確認の検討書](../../decisions/2026-07-29T173454_インストーラ実装分割と受け入れ確認の検討書.md)（`accepted`） |
| 設計 | [INSTALLATION_DESIGN.md](../../INSTALLATION_DESIGN.md)（`accepted`） |
| 目標定義 | [インストーラとアンインストーラの目標定義](../../decisions/2026-07-29T084808_インストーラとアンインストーラの目標定義.md) |
| 本書の効力 | 実装順と粒度を提示する。設計を変更しない。**§8 の4件は 2026-08-06 に決定済み** |

**Goal:** `install` と既定 `uninstall` を、manifest の状態機械・副作用の無い planner・逐次 executor・atomic binary replacement からなる一つの lifecycle として実装する。

**Architecture:** `src/installation/` に `model.ts` / `paths.ts` / `manifest.ts` / `planner.ts` / `executor.ts` / `process.ts` を足し、`src/cli/installation.ts` から Commander へ接続する。`planner.ts` は OS を変更せず `InstallationOperation[]` を返し、`executor.ts` だけが副作用を持つ。既存の `plist.ts`、`settings-read.ts`、`run-lease.ts`、`version.ts` を再利用する。

**Tech Stack:** TypeScript、Node.js `fs/promises`、Vitest、Bun compiled acceptance harness。

## 0. 本書の位置づけ

**差分の読み方**: 本書は新規文書である。既存文書の変更は含まない。
競合面は `docs/superpowers/plans/2026-08-06-slice3-install-uninstall.md` の 1 ファイルだけで、PR #132（`docs/PLAN.md`）とも重ならない。

**設計はやり直さない。** `INSTALLATION_DESIGN.md` は `accepted` であり、本書はその実装順序だけを決める。
設計と実装が食い違う箇所を見つけた場合は §6 に記録し、設計側を正とする。

## 1. 実測した現況

pm の依頼文は前提を4件挙げ、「鵜呑みにせず自分で当たってください」と付記した。
以下はすべて起草者が `4a33602` で取り直した結果である。

| # | pm の把握 | 実測 | 判定 |
| --- | --- | --- | --- |
| 1 | `src/installation/` は `plist.ts` と `settings-read.ts` の2本のみ。`index.ts` なし。CLI に install / uninstall 無し | そのとおり。CLI が登録する command は `auth` / `pipeline` / `run` / `serve` の4つ | **一致** |
| 2 | Slice 3 で判定の PENDING AC は **6 件**（AC-01 / 02 / 09 / 11 / 14 / 15） | **14 件**である。§1.1 を参照 | **不一致。訂正する** |
| 3 | Slice 1 の成果物はすべて実在 | そのとおり。§1.2 を参照 | **一致** |
| 4 | PLAN.md Ph.15 の「実装中・Slice 1」は古い記述。PR #132 で更新中 | そのとおり。PR #132 は `docs/PLAN.md` のみを変更する OPEN な PR | **一致** |

### 1.1 Slice 3 が owner の AC は 14 件である

`docs/ACCEPTANCE_TEST_REPORT.md` の Installer AC 表で、owner Slice が `Slice 3` の行を数えた。

```text
grep -cE '^\| AC-[0-9]+ \| Slice 3 \|' docs/ACCEPTANCE_TEST_REPORT.md
14
```

内訳は次のとおりで、**14 件すべてが `PENDING` である。**

```text
AC-01 AC-02 AC-04 AC-05 AC-08 AC-09 AC-10 AC-11 AC-14 AC-15 AC-16 AC-17 AC-18 AC-19
```

pm の 6 件（AC-01 / 02 / 09 / 11 / 14 / 15）に対し、**次の 8 件が欠けている。**

```text
AC-04 AC-05 AC-08 AC-10 AC-16 AC-17 AC-18 AC-19
```

同じ 14 件は、実装分割の §AC-01〜AC-38 の割当表でも Slice 3 が最終 owner になっている。
2つの資料は一致しており、**台帳側の記載漏れではなく、依頼文の列挙が短い。**

欠けていた 8 件は、いずれも作業量の大きい側である。

| AC | 内容 | 実装への影響 |
| --- | --- | --- |
| AC-04 | 認証不足時に不足ファイル名と入手方法を表示して非0終了する | 失敗経路と表示文面。**バイナリと launchd を変更する前**に失敗させる順序制約を伴う |
| AC-05 | `--launchd` 無しで plist と launchctl mutation がゼロ | opt-in の分岐 |
| AC-08 | uninstall 後に両 label が登録解除され plist が消える | fake launchctl adapter |
| AC-10 | manifest の記録済み prefix を正本として削除する | manifest が無いと成立しない |
| AC-16 | 編集済み settings の再 install 前後 hash が一致する | 「無い場合だけ生成する」分岐 |
| AC-17 | atomic replacement。実行中 process が旧 inode で完走する | **隔離 Bun acceptance が必須**（個別表） |
| AC-18 | active serve 中の install が mutation 前に中断する | run lease の検査順序 |
| AC-19 | dry-run が副作用ゼロ。network 遮断環境でも成功する | planner と executor の分離そのもの |

**AC-17 と AC-18 は Vitest だけで閉じない。** 実装分割の個別表が隔離 Bun acceptance を必須にしている。

### 1.2 Slice 1 の成果物

実装分割 §Slice 1 が挙げる成果物を1つずつ探した。

| 成果物 | 実測 |
| --- | --- |
| `src/version.ts` の `APP_VERSION` | 実在（`"0.1.0"`） |
| ファイルを生成しない `src/installation/settings-read.ts` | 実在（`readSettings(settingsPath)` を export） |
| `src/scheduler/run-lease.ts` | 実在 |
| Darwin raw `O_EXLOCK_DARWIN = 0x0020` | 実在（`buildLockFlags()` が flag の生存を assert する） |
| APFS allowlist、real path namespace、owner 固有 socket | 実在（`acquireRunLease` 内） |
| 最小 acceptance harness | 実在（`scripts/run-runtime-safety-acceptance.sh`、`npm run acceptance:runtime-safety`） |
| Installer AC 節の骨格 | 実在（AC-01〜AC-38 の行が owner Slice と `PENDING` 付きで存在） |

**pm の把握どおりである。**

### 1.3 参考: cutover 計画（PR #129）の前提が1件変わった

本作業の範囲外だが、`4a33602`（PR #131）で **step 4（V-3 と定義版3）が着地した。**
PR #129 §1.4 B は基準 main `e5cb5e6` の時点で「step 4 未実装」と記録している。
同 PR の作業順 W-5 は完了済みとして読み替える必要がある。
§8 の決定4 を参照。

## 2. PR 粒度の判断

pm は「1 PR に収めるか分割するか」を委ねた。

### 2.1 結論: 1 PR にする

**分割しない。** 理由は3つある。

1. **accepted な実装分割が Slice = PR を粒度としている。**
   決定 U-1 は「依存順 capability slice」を採り、§Slice 3 は「この PR は、manifest、planner、executor を**一つの lifecycle として**実装する」と書いている。
   Slice 3 を割ると、accepted な粒度から外れる。
2. **決定 U-2 が stacked PR を明示的に落としている。**
   「base 更新によってレビュー対象 head が変わり、承認済み内容と結合後内容を再照合する追加工程を生む」が理由である。
   したがって分割するなら直列 PR しか選べない。
3. **直列 PR は現在の freeze で止まる。**
   Issue #133 により 2026-08-08 まで PR はマージされない。
   直列 PR は前の PR が main へ入るまで次を開始できないため、**分割した瞬間に Slice 3 全体が 2 日間停止する。**
   1 PR なら branch へ積み続けられる。

**分割は今日の制約下で最も損をする選択である。**

### 2.2 レビュー負荷はコミット順で下げる

1 PR は差分が大きい。
**レビュー枠が細いので、読む順序を PR 側で固定する。**

コミットは §3 の Task 順に 1 Task = 1 コミット以上で積み、各コミットのメッセージに Task 番号を書く。
PR 本文の冒頭に、次の「読む順序」を置く。

```text
1  model.ts / paths.ts        型と path 解決。ここだけで OS を触らない契約が決まる
2  manifest.ts                状態機械。中断時に何が残るかはここで決まる
3  planner.ts                 副作用ゼロ。dry-run の正体
4  executor.ts + process.ts   唯一の副作用境界
5  binary replacement         atomic の実体
6  CLI 接続                   ここまでの合成
7  隔離 acceptance             Vitest で代用できない範囲
```

**Task 1 から 4 までを読めば、AC-19（dry-run 副作用ゼロ）と中断時の残置は判定できる。**
Task 5 以降は個別の機構である。

### 2.3 分割が必要になった場合の境界

レビュー枠の回復後に「1 PR では大きすぎる」と判断された場合に備え、直列 PR の境界だけ決めておく。

**分割は採らない**（2026-08-06 決定。§8 の決定1）。
以下は、後で分割が必要になった場合にどこで切るかの記録であり、本計画の作業計画ではない。
**分割へ切り替えるには、accepted な実装分割の粒度から外れるためユーザー決定が要る。**

| 直列 PR | 範囲 | 単独でマージ可能か |
| --- | --- | --- |
| 3-a | `model.ts`、`paths.ts`、`manifest.ts` と unit test。CLI 非公開 | 可能。CLI の外形が変わらない |
| 3-b | `planner.ts`、`executor.ts`、`process.ts`、binary replacement、`install` 公開 | 可能。`uninstall` が無い状態を一時的に残す |
| 3-c | 既定 `uninstall`、隔離 acceptance、AC 記録 | 可能 |

**3-b だけがマージされた状態は、`install` はできるが `uninstall` ができない production を作りうる。**
分割するなら、3-b の README には「撤収手段は次の PR で入る」を明記し、3-b と 3-c を同じ release train に置くこと。

## 3. 実装順

各 Task は TDD で進める。
**先に失敗するテストを書き、失敗を確認してから実装する。**

### Task 1: 型と path 解決

**Files:**
- Create: `src/installation/model.ts`
- Create: `src/installation/paths.ts`
- Create: `test/installation/paths.test.ts`

**Interfaces:**
- `model.ts` は `InstallationOperation`、`OperationResult`、`InstallOptions`、`UninstallOptions` を設計書 §主要な型のとおりに定義する。**同じ概念を別名で重複定義しない。**
- `paths.ts` は home、prefix、config、log、plist の絶対パスを解決する。

- [ ] **Step 1: `paths.ts` の失敗するテストを書く。** home と prefix の正規化、および危険 prefix の拒否（設計書 §テスト設計 ユニットテスト）。
- [ ] **Step 2: `npm test -- test/installation/paths.test.ts` を実行し、解決関数が無いことで失敗することを確認する。**
- [ ] **Step 3: `model.ts` の型と `paths.ts` の解決だけを実装する。** OS を読まない純関数にする。
- [ ] **Step 4: テストが通ることを確認する。**

**危険 prefix の定義は設計書に無い。** §8 の決定2（ユーザー決定）が列挙を固定した。
`/`、`/usr`、`/bin`、`/sbin`、`/etc`、`/System`、`/Library`、`$HOME` そのものを拒否する。
**この列挙を実装内で増減させない。** 増減が要ると判明したらユーザー決定へ戻す。

### Task 2: manifest の状態機械

**Files:**
- Create: `src/installation/manifest.ts`
- Create: `test/installation/manifest.test.ts`

**Interfaces:**
- schema 検証、atomic read/write、`state` の3値（`installing` / `installed` / `uninstalling`）、`applied-steps`、`created-paths`。

- [ ] **Step 1: 失敗するテストを書く。** 設計書 §マニフェストの JSON 構造、unknown version の拒否、atomic write、3つの state 遷移、`created-paths` に**新規作成したディレクトリだけ**が入ること。
- [ ] **Step 2: テストが失敗することを確認する。**
- [ ] **Step 3: 実装する。** 秘密情報・Spreadsheet ID・OAuth token を書かない。`version` は `APP_VERSION` を使う。
- [ ] **Step 4: テストが通ることを確認する。**
- [ ] **Step 5: 負のコントロールを追加する。** §5 の N-1 と N-2。

**この Task が「install が途中で中断したときに何が残るか」を決める。**
`installing` は**永続的な製品変更を始める前に** atomic write する（設計書 §マニフェスト）。
この順序を守らない実装は、中断時に「何も記録が無いまま binary だけ置き換わった」状態を作る。

### Task 3: planner（副作用ゼロ）

**Files:**
- Create: `src/installation/planner.ts`
- Create: `test/installation/planner.test.ts`

**Interfaces:**
- 入力は現在状態とオプション、出力は `InstallationOperation[]`。**OS を変更しない。**

- [ ] **Step 1: 失敗するテストを書く。** 初回 install、再実行、部分適用からの再開、dry-run、active run 中断の**操作順**を検査する。
- [ ] **Step 2: テストが失敗することを確認する。**
- [ ] **Step 3: 設計書 §インストールフロー 計画 の 1〜7 と §アンインストールフロー 既定 の 1〜11 を plan として実装する。**
- [ ] **Step 4: テストが通ることを確認する。**
- [ ] **Step 5: recording adapter で副作用呼出ゼロを検査する（AC-19 の Vitest 側）。**

**計画段階の禁止事項**（設計書 §計画）:

```text
settings.json を生成しない
認証ファイルは stat による存在確認だけ。内容を読まず、認証クライアントを生成しない
Google 認証を含む外部 API 通信をしない
launchctl print は許可。bootstrap / bootout / enable / kickstart は呼ばない
```

### Task 4: executor と launchctl adapter

**Files:**
- Create: `src/installation/executor.ts`
- Create: `src/installation/process.ts`
- Create: `test/installation/executor.test.ts`
- Create: `test/installation/process.test.ts`

**Interfaces:**
- `executor.ts` は plan の一操作だけを順に実行し、各操作の完了後に manifest と出力を更新する。
- `process.ts` は launchctl adapter。**登録判定の契約は `launchctl print` の終了コードが0か非0かだけとする。出力形式と `state` をパースしない。**

- [ ] **Step 1: 失敗するテストを書く。** `done` / `skipped` / `failed` の記録と中断位置（executor）、終了コードによる登録有無・変更系呼出・待機上限の分類（process）。
- [ ] **Step 2: テストが失敗することを確認する。**
- [ ] **Step 3: 実装する。** 出力は設計書 §エラーと部分適用 の書式に合わせる。
- [ ] **Step 4: テストが通ることを確認する。**

**失敗後の自動 rollback は行わない**（設計書 §エラーと部分適用）。
各操作を冪等にし、同じコマンドの再実行で修復する。
**この決定は Task 2 の状態機械と対で成立する。**片方だけを実装しない。

### Task 5: atomic binary replacement と BinaryCopySource

**Files:**
- Modify: `src/installation/executor.ts`
- Create: `test/installation/binary-copy-source.test.ts`

**Interfaces:**

```typescript
interface BinaryCopySource {
  resolve(): Promise<string>;
}
```

- [ ] **Step 1: 失敗するテストを書く。** 同一ディレクトリの一時ファイル、mode `0755`、fsync、rename、失敗時に一時ファイルだけを削除すること。
- [ ] **Step 2: テストが失敗することを確認する。**
- [ ] **Step 3: 実装する。** production adapter だけが `process.execPath` を返し、**Bun compiled binary であることを検査してから**返す。
- [ ] **Step 4: テストが通ることを確認する。**
- [ ] **Step 5: 負のコントロールを追加する。** §5 の N-3。

**CLI オプション、環境変数、設定ファイルから copy source を上書きできる経路を作らない**（実装分割 §Slice 3）。
テスト用 adapter は fixture の絶対パスを返してよい。

### Task 6: plist 生成の設計追従

**Files:**
- Modify: `src/installation/plist.ts`
- Modify: `test/installation/plist.test.ts`

- [ ] **Step 1: 失敗するテストを書く。** §6.1 で実測した2つの不足（period ごとに2つの実行時刻、`EnvironmentVariables`）を検査する。
- [ ] **Step 2: テストが失敗することを確認する。**
- [ ] **Step 3: `buildPipelinePlist` を設計書 §実行時刻 と §EnvironmentVariables へ追従させる。**
- [ ] **Step 4: AC-07 と AC-34 を再実行し、`PASS` のままであることを確認する**（実装分割 §Slice 3 が要求する再実行）。

### Task 7: CLI 接続

**Files:**
- Create: `src/cli/installation.ts`
- Modify: `src/cli/index.ts`
- Create: `test/cli/installation.test.ts`

- [ ] **Step 1: 失敗するテストを書く。** `install` と `uninstall` のオプション解釈、`--dry-run`、`--launchd`、`--force`、`--prefix`。
- [ ] **Step 2: テストが失敗することを確認する。**
- [ ] **Step 3: Commander へ接続する。** `doctor`、`--purge`、`--wipe` を**公開しない**（実装分割 §Slice 3）。
- [ ] **Step 4: テストが通ることを確認する。**
- [ ] **Step 5: `npm run typecheck` と `npm test` を通す。**

### Task 8: 隔離 acceptance

**Files:**
- Create: `scripts/run-installer-acceptance.sh`
- Modify: `package.json`（`acceptance:installer`）

- [ ] **Step 1: 一時 HOME、一時 prefix、fake launchctl、network deny の harness を用意する。**
- [ ] **Step 2: 設計書 §隔離統合テスト の 1〜6 を自動化する。** 7 と 10〜13 は Slice 4 / 5 の範囲なので入れない。
- [ ] **Step 3: AC-17 の隔離 Bun 試験を入れる。** compiled binary を実行させたまま install し、旧 inode で完走し、置換後 binary が新 version を返す。
- [ ] **Step 4: AC-18 の隔離 Bun 試験を入れる。** 別 process の compiled `serve` を保持し、install が mutation 前に失敗する。
- [ ] **Step 5: AC-19 の隔離 Bun 試験を入れる。** network deny、一時 HOME、fake launchctl で dry-run 前後の tree が一致する。
- [ ] **Step 6: 負のコントロール（§5）をすべて実行し、期待どおり FAIL することを確認する。**

**実ユーザーの LaunchAgents、設定、ログ、Spreadsheet へ触れない。**
`scale_exporter` の実設定、認証、バイナリ、LaunchAgent も作成または変更しない。

### Task 9: 記録

**Files:**
- Modify: `docs/ACCEPTANCE_TEST_REPORT.md`
- Modify: `docs/PLAN.md`（PR #132 が main へ入った後に追随する）

- [ ] **Step 1: §4 の 14 行を、実施方式・対象 commit・実施日時・証跡・判定で更新する。**
- [ ] **Step 2: AC-07 と AC-34 の再実行結果を記録する。**
- [ ] **Step 3: AC-23 と AC-25 の Slice 3 分担分を、owner Slice を変えずに備考へ記録する。**
- [ ] **Step 4: `npm run preflight:ac-ledger` が通ることを確認する。**

**PR #132 と同じ行を触る可能性がある。** PR #132 のマージ後に rebase して追随すること。

## 4. AC 対応表

### 4.1 Slice 3 が閉じる 14 件

| AC | 内容 | 閉じる Task | 必須方式 |
| --- | --- | --- | --- |
| AC-01 | 一時 HOME と prefix で compiled install が成功する | Task 8 | 自動（隔離 Bun） |
| AC-02 | `<prefix>/bin/scale2sheet --version` が成功する | Task 8 | 自動（隔離 Bun） |
| AC-04 | 認証不足のファイル名、絶対パス、取得手順と非0終了 | Task 3・Task 4 | 自動 |
| AC-05 | `--launchd` 無しで plist と launchctl mutation がゼロ | Task 3・Task 7 | 自動 |
| AC-08 | fake launchctl で両 label の bootout と plist 削除 | Task 4 | 自動 |
| AC-09 | 既定 uninstall 後も設定・認証・ログが byte-identical | Task 8 | 自動 |
| AC-10 | manifest の記録済み prefix を正本として削除する | Task 2・Task 3 | 自動 |
| AC-11 | 削除・残置・後続コマンドの出力を検査する | Task 4 | 自動 |
| AC-14 | 未導入 uninstall が「何もすることがない」で正常終了 | Task 3・Task 4 | 自動 |
| AC-15 | 隔離環境で compiled install を連続2回実行する | Task 8 | 自動（Vitest + 隔離 Bun） |
| AC-16 | 編集済み settings の再 install 前後 hash が一致する | Task 3・Task 8 | 自動 |
| AC-17 | 一時 file と rename、旧 inode 完走、置換後 version | Task 5・Task 8 | 自動（Vitest + **隔離 Bun 必須**） |
| AC-18 | active serve での mutation 前中断 | Task 3・Task 8 | 自動（Vitest + **隔離 Bun 必須**） |
| AC-19 | dry-run の副作用ゼロ | Task 3・Task 8 | 自動（Vitest + **隔離 Bun 必須**） |

AC-15、AC-17、AC-18、AC-19 の方式は実装分割の個別表を優先した（同表が本文の表に優先すると明記されている）。

### 4.2 Slice 3 が触るが閉じない AC

| AC | owner | Slice 3 での扱い |
| --- | --- | --- |
| AC-07 | Slice 2 | **再実行する。** paths と manifest を含む実値で plist を再生成するため（実装分割 §Slice 3） |
| AC-34 | Slice 2 | **再実行する。** 同上 |
| AC-23 | Slice 5 | install と既定 uninstall の plan 検査、および uninstall dry-run の tree 不変を Slice 3 で満たす。purge と wipe は Slice 5 で追加するため、**判定は `PARTIAL` に留める** |
| AC-25 | Slice 4 | 「install から doctor が呼ばれない」は doctor が存在しないと検査できない。**Slice 3 では `install` が network adapter を呼ばないことだけを記録し、判定は動かさない** |
| AC-20 | Slice 7 | 本 Slice の side-effect test を一時 HOME・prefix・fake process・network deny で記録する。集約は Slice 7 |

### 4.3 新規 AC は不要である

pm は「Slice 3 の AC は AC-01〜38 の骨格に既にあるはずなので、新設は不要かもしれません。確認してください」と書いた。

**確認した。新設は不要である。**

14 件はすべて AC-01〜AC-38 の範囲に存在し、目標定義に条件文がある。
台帳へ新しい予約を足す必要はない。

ただし **AC が覆っていない設計要求が2つある**（§6.1）。
どちらも `INSTALLATION_DESIGN.md` §テスト設計 のユニットテスト表が `plist.ts` の検証対象として「**時刻**」と「**PATH**」を名指ししている。
**accepted な設計がユニットテストとして要求しているので、AC 番号を新設せずに Task 6 で閉じる。**
AC を増やすと、台帳の予約と定義文書の往復が発生し、設計が既に決めていることを二重管理する。

## 5. 負のコントロール

**「通った」は、判定に解像度があることを保証しない。**
以下は、実装の一部を意図的に壊したときに**試験が FAIL することを確認する**手順である。
Task 8 の Step 6 で全件を実行する。

### 5.1 中断時に何が残るか（pm が重視した点）

| # | 変異 | FAIL すべき試験 | これが検出する事故 |
| --- | --- | --- | --- |
| **N-1** | `installing` の atomic write を、binary replacement の**後**へ移す | 「binary 置換の直後に中断させると、manifest が `installing` で存在し `applied-steps` に置換前の手順だけが入る」 | **記録の無いまま製品が変わった状態。**再実行時にどこまで進んだか分からない |
| **N-2** | `created-paths` へ、**既存ディレクトリも含めて**記録する | 「install 前から存在した config ディレクトリが、既定 uninstall 後も残る」 | **利用者が前から持っていたディレクトリを uninstall が消す** |
| **N-2b** | `created-paths` の記録自体を外す | 「install が新規作成したログディレクトリが、既定 uninstall 後に消える」 | 撤収漏れ。N-2 と対で置き、**両方向の誤りを捉える** |

**N-1 が本計画の中心である。**
manifest の状態機械は「中断しても再実行で修復できる」ためにあり、その価値は**書く順序**にしかない。
順序を壊す変異で試験が落ちなければ、状態機械は飾りである。

### 5.2 それ以外

| # | 変異 | FAIL すべき試験 |
| --- | --- | --- |
| N-3 | atomic replacement を、対象ファイルへの直接上書き（`cp` 相当）へ変える | AC-17 の「実行中 process が旧 inode で完走する」 |
| N-4 | 認証ファイルの検査を binary replacement の**後**へ移す | AC-04 の「認証不足時に binary が変わらない」 |
| N-5 | active run lease の検査を mutation の**後**へ移す | AC-18 の「serve 生存時に install が mutation 前に失敗する」 |
| N-6 | planner が `settings.json` を生成するようにする | AC-19 の「dry-run 前後で tree が一致する」 |
| N-7 | `launchctl print` の**出力文字列**から登録有無を判定するようにする | `process.ts` の「終了コードだけで判定する」試験。出力形式を変えた fake で FAIL する |
| N-8 | `BinaryCopySource` を環境変数から上書きできるようにする | 「production adapter が `process.execPath` 以外を返さない」試験 |

N-7 は設計書 §再登録 の「`launchctl print` の出力形式と `state` は API ではないためパースしない」を守らせるためのものである。
**この契約は、macOS の更新で出力が変わったときに静かに壊れる箇所である。**

## 6. 既存資産の再利用

pm は「`buildPipelinePlist` と `settings-read` は既に在ります」と書いた。
**在るが、`buildPipelinePlist` はそのままでは設計を満たさない。**

### 6.1 `plist.ts` の不足 2 点（実測）

現在の `buildPipelinePlist` は次の入力を取る。

```typescript
interface PipelinePlistInput {
  readonly label: string;
  readonly binaryPath: string;
  readonly period: "morning" | "evening";
  readonly stdoutPath: string;
  readonly stderrPath: string;
  readonly hour: number;      // 単数
  readonly minute: number;    // 単数
}
```

**不足1: 実行時刻が period あたり1つしか表現できない。**

設計書 §実行時刻 は次を要求する。

```text
morning  07:00、11:30
evening  21:00、23:30
```

生成される plist の `StartCalendarInterval` は単一の `dict` である。
production の既存 plist は `array` に2つの `dict` を持つ（`plutil -p` で実測）。
**現在の generator は、既存の production schedule を再現できない。**

**不足2: `EnvironmentVariables` を生成しない。**

設計書 §EnvironmentVariables は `HOME`、`PATH`、`SCALE2SHEET_LAUNCHD_LABEL` の明示を要求し、
`PATH` は `<prefix>/bin` から `/sbin` までの7要素を重複除去して連結すると定める。

```text
grep -rn "EnvironmentVariables\|SCALE2SHEET_LAUNCHD_LABEL" src test
（0 件）
```

**src にも test にも1件も無い。**

どちらも Task 6 で閉じる。
**AC-07 と AC-34 は現状でも `PASS` するため、この不足を AC が捕まえない。**
だから §4.3 のとおり、設計書のユニットテスト表を根拠に閉じる。

### 6.2 そのまま使えるもの

| 資産 | 使い方 |
| --- | --- |
| `settings-read.ts` の `readSettings(settingsPath)` | 設計書 §計画 の手順4。**ファイルを生成しない**契約がそのまま要る |
| `run-lease.ts` の `acquireRunLease` | `kind: "maintenance"` と `origin: "maintenance"` が**既に型にある**。install / uninstall の lease をそのまま表現できる |
| `run-lease.ts` の `requestCooperativeStop` | 設計書 §アンインストールフロー の協調停止 |
| `src/version.ts` の `APP_VERSION` | manifest の `version` と Commander の `--version` を同じ値にする |
| `scripts/run-runtime-safety-acceptance.sh` | Task 8 の harness の下敷き。一時 HOME・prefix・network deny・別 process の型がある |

**`src/config/settings.ts` の `loadOrCreateSettings` は、通常 install の適用段階だけで呼ぶ**（設計書 §モジュール境界）。
planner からは呼ばない。

## 7. 完了判定

| # | 条件 | 検査 |
| --- | --- | --- |
| S-1 | `npm run typecheck` が通る | 終了コード0 |
| S-2 | `npm test` が通る | 終了コード0 |
| S-3 | `npm run build:bun` が通る | 終了コード0 |
| S-4 | `npm run acceptance:installer` が通る | 終了コード0 |
| S-5 | §5 の負のコントロール 9 件すべてで、対応する試験が FAIL する | Task 8 Step 6 の出力 |
| S-6 | AC-01 / 02 / 04 / 05 / 08 / 09 / 10 / 11 / 14 / 15 / 16 / 17 / 18 / 19 が `PASS` | ACCEPTANCE_TEST_REPORT |
| S-7 | AC-07 と AC-34 が再実行後も `PASS` | 同上 |
| S-8 | `npm run preflight:ac-ledger` が通る | 終了コード0 |
| S-9 | `doctor` / `--purge` / `--wipe` が公開されていない | `--help` の出力 |

S-1 から S-3 は実装分割 §Slice ごとの完了ゲート の共通ゲートである。

**S-5 を完了判定に含める。**
負のコントロールを実行しない実装は、14 件の `PASS` が何を意味するかを保証しない。

## 8. 決定事項

初稿は本節を「決めること」として4件の選択肢を並べた。
**2026-08-06T23:37:00+09:00 に4件とも決まった。**以下は決定の記録である。

| # | 論点 | 決定 | 決定者 |
| --- | --- | --- | --- |
| 1 | Slice 3 を 1 PR にするか | **1 PR** | pm |
| 2 | 危険 prefix の定義 | **2-a** | **ユーザー** |
| 3 | `--prefix` の既定値 | **`~/.local`** | pm |
| 4 | PR #129 を更新するか | **4-a** | pm |

### 決定1: Slice 3 は 1 PR とする

理由は §2.1 の3点である。

**初稿の理由づけを訂正する。**
初稿は「採用にはユーザー決定が要る（accepted な実装分割の粒度から外れるため）」と書いた。
直前の文が「1 PR を推奨する」だったため、**ユーザー決定を要するのが 1 PR の側だと読める。逆である。**

accepted な実装分割の §Slice 3 は「manifest、planner、executor を一つの lifecycle として実装する」と書いており、
**1 PR は同分割に従う選択である。**粒度から外れるのは分割する側である。

したがってユーザー決定は不要で、pm が決めた。
§2.3 の「本計画では採らない。採用にはユーザー決定が要る」は**分割**を指しており、そちらは初稿から正しい。
**訂正の対象は §8 の文であって、§2 の判断ではない。**

指摘は pm による（2026-08-06）。

### 決定2: 危険 prefix は 2-a とする（ユーザー決定）

設計書 §テスト設計 は `paths.ts` の検証項目に「危険 prefix の拒否」を挙げるが、**何を危険とするかを定義していない。**

**次を拒否する。**

```text
/
/usr
/bin
/sbin
/etc
/System
/Library
$HOME そのもの
```

不採用: 「書込権限のある任意 path」を許して拒否しない案（2-b）。

**列挙そのものが決定事項である。**
実装者が独断で列挙を決めると、後から「なぜこれが入っていないか」を再構成できない。
pm はこれを「利用者のマシン上で何を拒否するかは製品の振る舞いである」としてユーザーへ上げた。

**Task 1 の実装は、この列挙をそのまま使う。増減させない。**
増減が要ると判明した場合は、実装内で変えずにユーザー決定へ戻す。

### 決定3: `--prefix` の既定値は `~/.local` とする

目標定義 AC-02 は「既定 `--prefix ~/.local` が論点 C-1（`~/.local/bin`）と一致する」と書き、
「prefix の語義そのものは設計判断に委ねる」としている。

**既定値を `~/.local` とし、実体を `~/.local/bin/scale2sheet` とする。**
これは目標定義の記述をそのまま採るもので、新しい判断ではない。

### 決定4: PR #129 は書き換えない（4-a）

§1.3 のとおり、step 4 が `4a33602` で着地した。
PR #129 は基準 main `e5cb5e6` の実測として「step 4 未実装」を記録している。

**PR #129 は書き換えない。**
基準 commit と実測日時を明記した測定記録であり、後から変わった事実で書き換えると、いつ何を測ったかが追えなくなる。

不採用: PR #129 を `4a33602` で取り直す案（4-b）。

**同 PR の作業順 W-5（step 4）は完了済みとして読むこと。**
この事実は pm がコメントで補足する。

## 9. 本書が扱っていないこと

- Slice 4（`doctor`）と Slice 5（`--purge` / `--wipe`）の実装内容
- Slice 6 の配布・runbook・cutover（PR #129 の範囲）
- `INSTALLATION_DESIGN.md` の設計変更
- 危険 prefix の具体的な列挙（§8 の決定2）
- 本番 launchd label への操作。**Slice 3 は一時 label と fake adapter だけを使う**

## 10. 実測コマンド一覧

```sh
# 1. 現況
find src/installation -type f
grep -nE '\.command\(' src/cli/index.ts

# 1.1 Slice 3 の AC 件数
grep -cE '^\| AC-[0-9]+ \| Slice 3 \|' docs/ACCEPTANCE_TEST_REPORT.md
grep -E '^\| AC-[0-9]+ \| Slice 3 \|' docs/ACCEPTANCE_TEST_REPORT.md | grep -c PENDING

# 1.2 Slice 1 の成果物
cat src/version.ts
grep -nE '^export' src/installation/settings-read.ts src/scheduler/run-lease.ts
ls scripts/run-runtime-safety-acceptance.sh

# 6.1 plist の不足
cat src/installation/plist.ts
grep -rn "EnvironmentVariables\|SCALE2SHEET_LAUNCHD_LABEL" src test
plutil -p ~/Library/LaunchAgents/jp.seijin.kappa.scale-pipeline.morning.plist
```

**本番へ副作用のあるコマンドは実行していない。**
`install` / `uninstall` 系、`run` / `pipeline` / `serve` / `auth` はいずれも起動していない。
`plutil -p` は読取のみである。
