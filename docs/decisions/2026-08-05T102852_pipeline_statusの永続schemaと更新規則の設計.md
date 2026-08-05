---
type: Design
title: pipeline status の永続 schema と更新規則の設計
description: Issue #46 の状態記録について、構造 schema、period ごとの集約、連続値、排他と atomic replacement、初期導入、V-3、保持する履歴を定義する。
tags:
  - design
  - scale2sheet
  - pipeline
  - observability
  - status
  - slice2
  - slice6
timestamp: "2026-08-05T10:28:52+09:00"
updated: "2026-08-05T11:04:44+09:00"
status: proposed
---

# pipeline status の永続 schema と更新規則の設計

起草: `scale2sheet_architect_codex`

検証: `scale2sheet_reviewer_claude`

決定済みの要件: ユーザー

| 項目 | 値 |
| --- | --- |
| 対象 Issue | #46 |
| 基準 HEAD | `560fd07` |
| AC 予約 | PR #98 で AC-118〜123 を予約 |
| 範囲 | `pipeline-status.json` の構造と更新規則。実装は含まない |

## 1. 結論

`pipeline-status.json` は、構造を識別する `schemaVersion` と、観測値の意味を識別する `definitionsVersion` を別々に持つ。

構造は単一の JSON document とし、`periods.morning` と `periods.evening` を必須キーにする。

各 period は進行中の run、最新の terminal observation、連続値、最後の `done`、最後の実転記、health state、最後の notification attempt を保持する。

無制限の terminal history は status に持たせない。

時系列の監査は既存 log が担い、status は次の判定と `doctor` に必要な最新状態だけを保持する。

書き手は共通 run lease を取得してから document 全体を read-modify-write する。

同じ directory の一時 file へ mode `0600` で書き、`rename` で置換する現在の方式を維持する。

本機の production 配置に移行元 file は存在しないため、旧 snapshot の自動 migration は実装しない。

初回は `schemaVersion: 1` から始める。

## 2. 固定する要件

本書は次の決定を変更しない。

- T-1 を主、T-3 を従とする。
- V-3 を主、V-1 を従とする。
- V-3 は、実行時に window 内の体重があったかと、セルを実際に更新したかを突き合わせる。
- V-1 は最後の `done` から2日を閾値とする。
- 通知は state が変わったときだけ試み、同じ `alert` の継続中は繰り返さない。
- `doctor` は period ごとの最後の `done`、最後の実転記、現在の異常継続日数を報告する。
- 常設表示と追加の常駐 job は作らない。
- status の器を通知より先に実装する。
- `definitionsVersion` は、定義変更より前から記録する。

## 3. 現状から分かる制約

### 3.1 production に移行対象は無い

2026-08-05 10:25 JST に、次の条件で本機を再確認した。

```sh
find "$HOME" -maxdepth 6 -name pipeline-status.json -print
```

結果は0件だった。

したがって、現在の `src/pipeline/status.ts` が書く単一 run snapshot を production data として移行する作業は発生しない。

source 上に旧 interface があることと、移行対象の永続 data があることは別である。

### 3.2 現行 writer が保証する範囲

現行 writer は、target と同じ directory に一時 file を作り、書込み、`chmod(0600)`、`rename` の順で置換する。

macOS の `rename(2)` は、source と target が同じ filesystem にある場合、置換中も target 名の file が存在することを保証する。

このため process が書込み前または rename 前に停止すれば旧 target が残り、rename が完了すれば新しい完全な JSON が target になる。

target に途中までの JSON が見える経路は作らない。

ただし `writeFile` と `rename` だけでは、停電や kernel panic 後に最新内容が永続 media へ残ることまでは保証しない。

本書は process crash と `SIGKILL` に対する atomic replacement を要求し、電源断に対する durability のための file と directory の `fsync` は追加しない。

status 全損を初回導入と区別できない限界は、AC-112 で既に受け入れている。

### 3.3 更新の排他は writer ではなく run lease が担う

morning と evening は別の launchd job だが、`acquireRunLease` は同じ config directory から一つの `active-run.lock` を導く。

したがって、どちらの period も同時に lease を取得できない。

pipeline は lease を取得してから status を読み、全更新を終えてから lease を解放する。

`rename` は一回の置換を atomic にするが、二つの process による read-modify-write の lost update は防がない。

その lost update は共通 lease で防ぐ。

status を書く将来の maintenance command も同じ lease を取得する。

`doctor` は読取専用なので lease を取得せず、rename の前後どちらかの完全な document を読む。

## 4. 構造の選択肢

### 4.1 S-1 単一 snapshot と period map

一つの document に morning と evening を置き、各 period の最新 terminal と集約値だけを持つ。

共通 lease の下で document 全体を更新する。

file 数は増えず、notification state と terminal observation を同じ versioned status に置ける。

一方、書き手が lease を迂回すると lost update が起きる。

### 4.2 S-2 period ごとの file

morning と evening を別 file にすれば、二つの period の更新は衝突しない。

しかし、既に単一 file として決めた `pipeline-status.json` の契約を変え、`doctor` と notification state の読取も複数 file の結合に依存する。

片方だけが失われた場合の初回判定も増える。

### 4.3 S-3 append-only history

全 terminal observation を一つの配列へ追加すれば、status 単体で履歴を再構成できる。

しかし、file は上限なく増え、毎回の atomic replacement が過去の全履歴を書き直す。

履歴の保持期間と圧縮を追加で決める必要もある。

### 4.4 採用

S-1 を採用する。

共通 run lease が既に存在し、時系列 log も既にあるため、S-2 と S-3 が増やす状態は要件に寄与しない。

## 5. 二つの version

### 5.1 `schemaVersion`

`schemaVersion` は JSON の構造を識別する非負整数である。

本書で初めて構造を固定するため、最初の値を `1` とする。

reader は `schemaVersion: 1` だけを更新可能な document として受け入れる。

値が無い document は構造版0と分類する。

0を1へ読み替えず、field を新構造へ写さない。

1より大きい値は新しい binary が書いた可能性があるため、古い binary は上書きしない。

### 5.2 `definitionsVersion`

`definitionsVersion` は件数、outcome、window、同一性、連続 no-data 閾値の意味を識別する。

構造が同じでも意味が変われば、この値を上げる。

構造を変えても意味が同じなら、`schemaVersion` だけを上げる。

`definitionsLabel` は人が読む補助値であり、機械判定には使わない。

writer は版表にある current version の label を書く。

reader は label の存在と文字列型だけを検証し、表との一致を status の受理、停止、再基準化の条件にしない。

意味の選択は整数の version だけで行い、label から version を推測、補正、拒否しない。

定義の適用順は次のとおりである。

| `definitionsVersion` | `definitionsLabel` | 適用段階 | 本書との関係 |
| ---: | --- | --- | --- |
| 1 | `2026-08-04/pre-63` | #63 実装前 | status の器を最初に入れる段階。現行の exact dedup と outcome 意味を維持する |
| 2 | `2026-08-04/post-63` | #63 実装後 | 経路をまたぐ物理測定の同一性と `uniqueMeasurementCount` を導入する |
| 3 | `2026-08-05/v3-transfer-observation` | #46 の V-3 実装後 | `completed:no-data` を window 内の体重0件、`completed:transferred` を1セル以上の実更新として固定する |

status schema の導入と #46 の V-3 有効化を同じものとして扱わない。

器だけを先に入れる変更は `schemaVersion: 1`、`definitionsVersion: 1` で開始できる。

#63 の実装は2へ上げ、V-3 と実転記の判定を有効にする変更は3へ上げる。

各 build は `CURRENT_DEFINITIONS_VERSION` を一つだけ持つ。

status の版が current と同じなら通常更新し、0以外の既知の小さい版なら §5.3 の再基準化を行う。

status の版が current より大きければ、古い binary は意味を解釈できないため上書きしない。

TypeScript の `1 | 2 | 3` は正本に登録済みの値域を表し、すべての build が三つの版を書いてよいことを意味しない。

### 5.3 定義版を変更するときの再基準化

異なる定義で得た連続値をつなげない。

writer が現在の build の定義版と status の定義版の違いを検出した場合、次を一つの atomic replacement で行う。

1. 両 period の連続失敗回数と連続 no-data 回数を0にする。
2. 両 period の health state を `unobserved` にする。
3. `lastTerminal`、`lastDoneAt`、`lastTransferredAt`、notification attempt、notification diagnostic を引き継がない。
4. top level の `lastDefinitionsTransition` に旧版、新版、変更時刻を一件だけ残す。

`doctor` はこの transition を報告する。

古い観測を新版の意味で表示しないための再基準化であり、構造 migration ではない。

## 6. schema version 1

### 6.1 top level

```ts
interface PipelineStatusDocumentV1 {
  readonly schemaVersion: 1;
  readonly definitionsVersion: 1 | 2 | 3;
  readonly definitionsLabel: string;
  readonly updatedAt: string;
  readonly periods: Record<"morning" | "evening", PeriodStatusV1>;
  readonly lastDefinitionsTransition?: {
    readonly fromVersion: number;
    readonly toVersion: 1 | 2 | 3;
    readonly changedAt: string;
  };
}
```

`periods` は morning と evening の両方を必須にする。

未観測の period も空の object にはせず、counter 0 と `health.state: "unobserved"` を持つ。

この canonical schema とは別に、reader は §9.1 の条件をすべて満たす「terminal history があり health だけが欠落した状態」を notification state 喪失候補として分類できる。

候補を通常の `PipelineStatusDocumentV1` として downstream へ渡さず、限定回復を完了してから canonical schema として扱う。

すべての時刻は `Date.prototype.toISOString()` と同じ UTC の ISO 8601 文字列で保存する。

### 6.2 period state

```ts
interface PeriodStatusV1 {
  readonly consecutiveFailureCount: number;
  readonly consecutiveNoDataCount: number;
  readonly health: {
    readonly state: "unobserved" | "normal" | "alert";
    readonly causes: readonly HealthCause[];
    readonly since?: string;
  };
  readonly activeRun?: ActiveRunV1;
  readonly lastInterruptedRun?: InterruptedRunV1;
  readonly lastTerminal?: TerminalObservationV1;
  readonly lastDoneAt?: string;
  readonly lastTransferredAt?: string;
  readonly lastNotificationDiagnostic?: NotificationDiagnosticV1;
  readonly lastNotificationAttempt?: NotificationAttemptV1;
}

type HealthCause =
  | "terminal-failure"
  | "v3-not-transferred"
  | "v1-stale"
  | "consecutive-no-data";

interface NotificationDiagnosticV1 {
  readonly code: "notification-state-missing";
  readonly observedAt: string;
  readonly lastTerminalRunId: string;
}
```

counter は0以上の整数とする。

`unobserved` と `normal` の `causes` は空配列とし、`since` を持たせない。

`alert` は一つ以上の cause と `since` を持つ。

cause が変わっても state が `alert` のままなら `since` を変えず、再通知しない。

`lastNotificationDiagnostic` は notification state の喪失を検出した最新の一件だけを保持する。

terminal observation の `diagnostic` と notification diagnostic を別 field にし、一方で他方を上書きしない。

### 6.3 active run と中断記録

```ts
interface ActiveRunV1 {
  readonly runId: string;
  readonly startedAt: string;
  readonly targetDate: string;
}

interface InterruptedRunV1 extends ActiveRunV1 {
  readonly observedAt: string;
}
```

run 開始時は `activeRun` だけを置換し、counter、`lastTerminal`、最後の `done`、最後の実転記を変えない。

`runId` には、共通 run lease が発行した `ownerToken` を使う。

別の random identifier を増やさず、status observation と排他の owner を一つの値で対応づける。

次の run が既存の `activeRun` を見つけた場合、その一件を `lastInterruptedRun` へ移してから新しい `activeRun` を置く。

中断 run は terminal outcome を持たないため、連続失敗回数へ加えない。

V-1 は `lastDoneAt` が更新されないことで中断期間を検出する。

`doctor` は status の `activeRun` だけを根拠に process が生存中だと断定せず、lease の生存確認を行わない場合は「active または未照合」と報告する。

### 6.4 terminal observation

```ts
type PersistedPipelineOutcome =
  | "completed:no-data"
  | "completed:transferred"
  | "failed:input-missing"
  | "failed:input-unstable"
  | "failed:input-invalid-or-partial"
  | "failed:transfer";

interface TerminalObservationV1 {
  readonly runId: string;
  readonly outcome: PersistedPipelineOutcome;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly targetDate: string;
  readonly counts: {
    readonly matchedFileCount?: number;
    readonly readLineCount?: number;
    readonly windowedReadingCount?: number;
    readonly uniqueMeasurementCount?: number;
  };
  readonly partialInput?: boolean;
  readonly diagnostic?: string;
  readonly inputAnomalyCandidates?: readonly InputAnomalyCandidate[];
  readonly v3?: V3ObservationV1;
}
```

未到達の count key は書かない。

未計測を0と書かず、観測した0と区別する既存契約を維持する。

outcome、diagnostic、counts、`partialInput`、存在する場合の V-3 observation は同じ run の不可分な組にする。

`definitionsVersion` 1では `uniqueMeasurementCount` と `v3` を書かない。

版2では window 集計へ到達した terminal に `uniqueMeasurementCount` を書くが、`v3` は書かない。

版3ではすべての terminal に `v3` を必須とし、input failure は `input: "unavailable"` で未到達を表す。

top level の定義版を変更すると旧 terminal を引き継がないため、一つの document にこの三つの規則を混在させない。

`failed:invalid-arguments` は有効な period が無く、CLI 境界で副作用前に拒否されるため status へ保存しない。

## 7. V-3 の表現

### 7.1 input と transfer を分ける

```ts
interface V3ObservationV1 {
  readonly input: "ready" | "unavailable";
  readonly windowedWeightCount?: number;
  readonly transfer: {
    readonly state:
      | "not-attempted"
      | "written"
      | "not-written"
      | "failed"
      | "unknown";
    readonly requestedCellCount?: number;
    readonly transferredCellCount?: number;
  };
}
```

`windowedWeightCount` は period window を適用し、現在の `definitionsVersion` の同一性規則で重複を除いた体重 reading の数である。

V-3 の判定は0か1件以上かだけを使う。

`windowedReadingCount` は体重以外も含むため、`windowedWeightCount` の代用にしない。

transfer adapter は request data の cell 数を `requestedCellCount` とし、Google Sheets の成功 response が返す `totalUpdatedCells` を `transferredCellCount` とする。

成功 response に `totalUpdatedCells` が無い場合は `unknown` とし、実転記を推測しない。

### 7.2 outcome と V-3 の組

| input | `windowedWeightCount` | transfer state | `transferredCellCount` | outcome | health |
| --- | ---: | --- | ---: | --- | --- |
| `unavailable` | 未計測 | `not-attempted` | 未計測 | 対応する `failed:input-*` | `alert` |
| `ready` | 0 | `not-attempted` | 未計測 | `completed:no-data` | V-1 と連続 no-data が未発火なら `normal` |
| `ready` | 1以上 | `written` | 1以上 | `completed:transferred` | V-1 が未発火なら `normal` |
| `ready` | 1以上 | `not-written` | 0 | `failed:transfer` | `alert`。V-3 cause を含める |
| `ready` | 1以上 | `failed` | 未計測 | `failed:transfer` | `alert` |
| `ready` | 1以上 | `unknown` | 未計測 | `failed:transfer` | `alert`。実転記を成功扱いしない |

`completed:transferred` は transfer port を呼んだことではなく、1セル以上の更新を server response で確認したことを表す。

### 7.3 2026-08-04 の実例

21:22 の evening 実行では、当日の体重は11:16の一件だけで evening window の外だった。

この実行は `input: "ready"`、`windowedWeightCount: 0`、`transfer.state: "not-attempted"`、`completed:no-data` になる。

転記しなかったが正常である。

22:03 の evening 実行では、21:31の体重を得て5セルを転記した。

この実行は `windowedWeightCount: 1`、`transfer.state: "written"`、`transferredCellCount: 5`、`completed:transferred` になる。

体重があるのに response が0セルなら `failed:transfer` と V-3 alert になる。

この三つを outcome だけから推測せず、input と transfer の組として残す。

## 8. counter と health の更新

### 8.1 terminal outcome の更新表

| event | 連続失敗 | 連続 no-data | `lastDoneAt` | `lastTransferredAt` |
| --- | --- | --- | --- | --- |
| run 開始 | 維持 | 維持 | 維持 | 維持 |
| `failed:input-*` | 1増やす | 維持 | 維持 | 維持 |
| `failed:transfer` | 1増やす | 維持 | 維持 | 維持 |
| `completed:no-data` | 0 | 1増やす | `completedAt` | 維持 |
| `completed:transferred` | 0 | 0 | `completedAt` | `completedAt` |
| `failed:invalid-arguments` | status を更新しない | status を更新しない | status を更新しない | status を更新しない |
| 中断した `activeRun` の発見 | 維持 | 維持 | 維持 | 維持 |
| `definitionsVersion` の変更 | 0 | 0 | 引き継がない | 引き継がない |

連続失敗回数は、同じ period で最後の `completed:*` 以後に観測した `failed:*` の回数である。

連続 no-data 回数は AC-43 に従い、同じ period で最後に実転記が成立した後に観測した `completed:no-data` の回数である。

`failed:*` は no-data に加算せず reset もしない。
`completed:transferred` だけが連続 no-data 回数を0に戻す。
したがって `no-data, no-data, failed, no-data, no-data` は4へ到達する。

### 8.2 health state

各 period の health は次の条件で評価する。

1. 現在の terminal outcome が `failed:*` なら `terminal-failure` を付ける。
2. `windowedWeightCount` が1以上で transfer が `written` でなければ `v3-not-transferred` を付ける。
3. `lastDoneAt` から2日以上経過していれば `v1-stale` を付ける。
4. `consecutiveNoDataCount` が設定値4以上なら `consecutive-no-data` を付ける。

一つ以上の cause があれば `alert` にする。

cause が無く、過去または現在の terminal observation があれば `normal` にする。

terminal observation が無く、明示的な異常も無ければ `unobserved` にする。

`doctor` は現在時刻で V-1 を再評価するが、status を変更せず通知も要求しない。

pipeline は開始時に V-1 を再評価し、2日閾値を越えた `normal -> alert` または `unobserved -> alert` を見つけた場合、入力読取より前に transition を claim する。

## 9. notification state

### 9.1 health state を通知の正本にする

通知だけのために `previousState` を重複保存しない。

period の `health.state` が前回 state であり、同じ atomic update で今回 state と notification claim を保存する。

morning と evening は別の health state を持つ。

morning が `alert` の間に evening が初めて `alert` になった場合、evening の transition は一回通知する。

同じ period で cause だけが変わり `alert` が続く場合は通知しない。

canonical writer はすべての period に `health` を必ず書く。

ただし parser は、有効な `lastTerminal` があるのに `health` key だけが無い period を、notification state 喪失として限定的に回復できる。
`health` が無いその他の構造や、`health` の型が不正な構造は §11.3 の壊れた file として停止する。

notification state 喪失を検出した場合は、現在の definitions で `lastTerminal`、counter、現在時刻から health を再評価する。

- 再評価が `alert` なら、`notification-state-missing` diagnostic、回復した health、notification claim を同じ atomic replacement で保存し、alert 通知を1回試みる。
- 再評価が `normal` なら、diagnostic と回復した health を同じ replacement で保存し、recovery 通知は試みない。

回復後は `health` が再び存在するため、次の run は同じ喪失を再度 claim しない。

status file 全体の喪失は terminal history も失うため、この回復経路を使わず本当の初回と同じ扱いにする。

### 9.2 notification attempt

```ts
type NotificationAttemptV1 = NotificationAttemptTriggerV1 & NotificationAttemptResultV1;

type NotificationAttemptTriggerV1 =
  | {
      readonly trigger: "state-transition";
      readonly fromState: "unobserved";
      readonly toState: "alert";
    }
  | {
      readonly trigger: "state-transition";
      readonly fromState: "normal";
      readonly toState: "alert";
    }
  | {
      readonly trigger: "state-transition";
      readonly fromState: "alert";
      readonly toState: "normal";
    }
  | {
      readonly trigger: "notification-state-loss";
      readonly fromState?: never;
      readonly toState: "alert";
    };

interface NotificationAttemptResultV1 {
  readonly attemptId: string;
  readonly claimedAt: string;
  readonly result: "claimed" | "success" | "nonzero" | "timeout" | "unknown";
  readonly completedAt?: string;
  readonly exitCode?: number;
  readonly stderr?: string;
  readonly elapsedMilliseconds?: number;
}
```

`state-transition` は `unobserved -> alert`、`normal -> alert`、`alert -> normal` の三組に閉じる。

`unobserved -> normal`、`normal -> normal`、`alert -> alert` は型で表現できず、通知を試みない。

notification state 喪失時の alert は過去 state が無いため通常の transition に偽装せず、`notification-state-loss` の別 trigger とする。

notification claim は terminal observation、counter、health、存在する場合の notification diagnostic と同じ atomic replacement に含める。

`osascript` の完了後に attempt result だけを次の replacement で更新する。

再起動時に `result: "claimed"` が残っていれば配送結果を `unknown` として扱い、同じ attempt を再送しない。

`stderr` は UTF-8 で4096 byteまでに切り詰め、notification diagnostic を terminal diagnostic へ混ぜない。

## 10. crash と外部副作用

### 10.1 status 更新中の停止

一時 file の書込み中に停止した場合、target は前の完全な document のままである。

rename 後に停止した場合、target は新しい完全な document である。

一時 file の残骸は reader が対象にせず、次の成功した置換を妨げない。

### 10.2 active run 中の停止

run 開始の replacement 後に停止した場合、`activeRun` と前回の `lastTerminal` が両方残る。

前回 terminal を `running` で上書きしない。

status の読取側は、active または未照合の run record と、最後に完了した run を区別できる。

次の pipeline は lease 取得済みなので、残った `activeRun` を中断として確定できる。

一方、読取専用の `doctor` は lease の生存を別途確認しない限り、残った `activeRun` を「active または未照合」と表示する。

### 10.3 Sheets 更新後の停止

Sheets の更新と local status replacement は一つの transaction にできない。

Sheets 成功後、terminal status 保存前に停止すると、セルは更新済みでも `lastTransferredAt` は更新されない。

次の run は冪等な upsert を再実行し、成功 response を得た時点で status を確定する。

この crash window では、一時的に実転記を未観測として扱う。

推測で `lastTransferredAt` を進めない。

## 11. 初期導入と互換性

### 11.1 file が無い場合

両 period を counter 0、`health.state: "unobserved"` で初期化する。

最初の実行で過去成功が無いことだけを alert にしない。

最初の実行が明示的な input failure、transfer failure、V-3 mismatch を観測した場合は、その period を `alert` にして一回通知を試みる。

### 11.2 schema version 0

`schemaVersion` の無い file は構造版0として識別する。

`schemaVersion: 1` でも `definitionsVersion` が無い file は定義版0として識別する。

現行の単一 run snapshot から period 集約へ field を写さない。

definitions も不明なので、版1または版3の観測として扱わない。

reader は pipeline の転記前に `unsupported status schema version 0` として停止し、元 file を上書きしない。

`doctor` は削除または退避後の再実行を案内する。

### 11.3 未知版と壊れた file

§9.1 の「有効な `lastTerminal` があり `health` key だけが無い」場合だけは、notification state 喪失として限定回復する。

未知の `schemaVersion`、未知の `definitionsVersion`、JSON parse error、型不一致では、pipeline は Sheets を更新せずに停止する。

§9.1 の notification state 喪失候補だけはこの一般停止規則の例外とし、同節の diagnostic、health、必要な claim 以外の field を変更しない。

元 file を上書きしない。

古い binary が新しい status を壊す経路と、壊れた state の上で通知を重複させる経路を閉じるためである。

この停止自体を status へ書くことはできないため、stderr と既存 log に原因を残す。

同じ状態で macOS 通知を毎回直接発火すると state-change-only の契約を守れないため、status 外からの通知は追加しない。

## 12. 保持する履歴

status に保持する履歴は period ごとに次の一件ずつに限定する。

- 現在の `activeRun`
- 最後に見つけた中断 run
- 最新の terminal observation
- 最新の notification diagnostic
- 最新の notification attempt
- 最後の `done` と最後の実転記
- 現在の連続値と health state

過去 terminal の配列、過去 notification attempt の配列、測定値、Spreadsheet ID、認証情報は保持しない。

時系列の監査には timestamp log を使う。

status 単体で必要なのは、次の run の更新、state transition の重複防止、`doctor` の現在値である。

## 13. 実装境界

status の parser、初期値、reducer、atomic store を pipeline の outcome 分岐から分離する。

pipeline は同じ run の observation を reducer へ渡し、counter と health の更新規則を独自に再実装しない。

Sheets adapter は `requestedCellCount` と `totalUpdatedCells` を transfer result として返す。

pipeline は transfer function が resolve したことだけで `completed:transferred` を作らない。

notification adapter は health transition の claim を受け取り、pipeline failure stage を直接受け取る現行 interface から切り離す。

#76 の「失敗経路ごとに notify を assert する」は採用しない。

自動試験は、最初の明示的 failure で一回要求し、同じ period の後続 failure では増えないことを対で固定する。

## 14. 合格条件

PR #98 で予約した AC-118〜123 の6条件を使う。

- **AC-118**: `pipeline-status.json` が `schemaVersion: 1`、top level の `definitionsVersion` と `definitionsLabel`、必須の `periods.morning` と `periods.evening` を持つこと。
  構造版と定義版を別々に検証し、版無しをそれぞれ0として識別して1へ読み替えず、current build より大きい版または正本に無い版を既知版として更新しないこと。
  label は人向けの文字列として保存するが、version との一致を status の受理、停止、再基準化の条件にしないこと。
- **AC-119**: 同じ period の terminal event について、§8.1 の全行どおりに連続失敗、連続 no-data、最後の `done`、最後の実転記を更新すること。
  `no-data, no-data, failed, no-data, no-data, no-data, no-data` で連続 no-data が6へ到達し、次の `completed:transferred` で0へ戻る列を自動検証すること。
  反対 period の全 field が変わらないこと、定義版変更で両 period を再基準化することを負のコントロールに含めること。
- **AC-120**: pipeline と将来の書込み command が同じ run lease の取得後に document 全体を read-modify-write し、同じ filesystem の mode `0600` 一時 file と rename で置換すること。
  morning が lease を保持する間は evening が status を変更できず、writer を rename 前後で停止しても target が旧 document または新 document の完全な一方で、部分 JSON と period の lost update が生じないことを自動検証すること。
  電源断後の最新内容の durability と Sheets と status の transaction は保証しないことを文書化すること。
- **AC-121**: production の `pipeline-status.json` が0件であることを実装着手時に再確認し、file 無しから `schemaVersion: 1` を初期化すること。
  現行 source の単一 run snapshot を production migration の対象に数えず、schema version 0、未知版、壊れた file の field を自動移送せず、元 file と Sheets を変更しないこと。
  §9.1 の notification state 喪失候補は限定例外とし、terminal、counter、最後の `done`、最後の実転記を変更せずに diagnostic、health、必要な claim だけを回復すること。
- **AC-122**: V-3 を §7.2 の全組合せで検証すること。
  window 内の体重0件では transfer を呼ばず正常 no-data、体重1件以上かつ `totalUpdatedCells` 1以上だけを transferred、体重1件以上で0件、例外、更新数不明を transfer failure と alert にすること。
  21:22 の窓外体重と22:03 の5セル転記に相当する fixture を正負の対にすること。
- **AC-123**: status の履歴を period ごとの active run、中断 run、最新 terminal、集約値、最新 notification diagnostic、最新 notification attempt 各一件に制限し、unbounded array と別 receipt file を作らないこと。
  `running` が前回 terminal を消さないこと、outcome、diagnostic、counts、版3の V-3 が同じ run の組であること、health state と notification claim を同じ replacement で保存すること、claim 後の再起動で同じ transition を再送しないことを自動検証すること。
  terminal history を残して `health` だけを欠落させた fixture で、記録喪失 diagnostic、現在が alert のときの1回だけの alert attempt、normal のときの無通知、claim 後再起動の無再送を自動検証すること。

## 15. 範囲外と限界

- production に存在しない旧 status の変換 utility
- 無制限の terminal history
- log rotation と長期監査保存
- 電源断に対する最新 status の durability
- Sheets 更新と local status の分散 transaction
- §9.1 の notification state 喪失候補を除き、status schema が壊れた状態での state-change-only 通知
- OS 通知の配信と既読の証明
- pipeline が起動しない期間中の自発的な検出

## 16. 実装順序

1. schema version 1、definitions version 1、period map、parser、reducer、atomic store を入れる。
2. 現行 pipeline の terminal observation を period map へ保存する。
3. #63 の同一性と件数を入れ、definitions version を2へ上げる。
4. V-3 の体重有無、Sheets response の実更新数、health evaluator を入れ、definitions version を3へ上げる。
5. notification transition と `doctor` を接続する。

各段階は、定義を変える変更と `definitionsVersion` の更新を同じ PR に含める。

器の PR が version 1 を書き始めた後に、版無し record を新たに作る経路を残さない。
