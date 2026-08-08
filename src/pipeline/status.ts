import { chmod, readFile, rename, writeFile } from "node:fs/promises";

import type { InputAnomalyCandidate } from "../sources/scale-exporter/index.js";

export type PipelinePeriod = "morning" | "evening";

export interface PipelineCounts {
  readonly matchedFileCount?: number;
  readonly readLineCount?: number;
  /** F-2: published records. Used for the #54 count comparison (AC-59). */
  readonly windowedReadingCount?: number;
  /** F-2: physical measurements. Used for #38 and the Slice 7 gate (AC-59). */
  readonly uniqueMeasurementCount?: number;
}

/** V-3 (design §7.1): what the pipeline observed about this run's transfer attempt. */
export type V3TransferState = "not-attempted" | "written" | "not-written" | "failed" | "unknown";

export interface V3Observation {
  readonly input: "ready" | "unavailable";
  readonly windowedWeightCount?: number;
  readonly transfer: {
    readonly state: V3TransferState;
    readonly requestedCellCount?: number;
    readonly transferredCellCount?: number;
  };
}

export interface PipelineStatus {
  readonly period: PipelinePeriod;
  readonly outcome: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly targetDate?: string;
  readonly counts: PipelineCounts;
  readonly diagnostic?: string;
  readonly inputAnomalyCandidates?: readonly InputAnomalyCandidate[];
  readonly v3?: V3Observation;
}

export type PersistedPipelineOutcome =
  | "completed:no-data"
  | "completed:transferred"
  | "failed:input-missing"
  | "failed:input-unstable"
  | "failed:input-invalid-or-partial"
  | "failed:transfer";

export interface PipelineStatusWriteResult {
  /** Set only when this write claimed a state-transition notification attempt (design §9.1). */
  readonly notification?: NotificationAttemptV1;
}

export interface PipelineStatusWriter {
  write(status: PipelineStatus): Promise<PipelineStatusWriteResult>;
}

export interface AtomicPipelineStatusWriterOptions {
  readonly renameFile?: typeof rename;
}

export type HealthCause =
  | "terminal-failure"
  | "v3-not-transferred"
  | "v1-stale"
  | "consecutive-no-data"
  | "input-anomaly-candidates";

export type HealthState = "unobserved" | "normal" | "alert";

interface HealthStatusV1 {
  readonly state: HealthState;
  readonly causes: readonly HealthCause[];
}

interface TerminalObservationV1 {
  readonly runId: string;
  readonly outcome: PersistedPipelineOutcome;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly targetDate: string;
  readonly counts: PipelineCounts;
  readonly diagnostic?: string;
  readonly inputAnomalyCandidates?: readonly InputAnomalyCandidate[];
  readonly v3?: V3Observation;
}

interface PeriodStatusV1 {
  readonly consecutiveFailureCount: number;
  readonly consecutiveNoDataCount: number;
  readonly health: HealthStatusV1;
  readonly activeRun?: {
    readonly runId: string;
    readonly startedAt: string;
    readonly targetDate: string;
  };
  readonly lastInterruptedRun?: {
    readonly runId: string;
    readonly startedAt: string;
    readonly targetDate: string;
    readonly observedAt: string;
  };
  readonly lastTerminal?: TerminalObservationV1;
  readonly lastDoneAt?: string;
  readonly lastTransferredAt?: string;
  readonly lastNotificationDiagnostic?: {
    readonly code: "notification-state-missing";
    readonly observedAt: string;
    readonly lastTerminalRunId: string;
  };
  readonly lastNotificationAttempt?: NotificationAttemptV1;
}

export type NotificationAttemptV1 = {
  readonly attemptId: string;
  readonly claimedAt: string;
  readonly result: "claimed" | "success" | "nonzero" | "timeout" | "unknown";
} & (
  | { readonly trigger: "state-transition"; readonly fromState: "unobserved" | "normal"; readonly toState: "alert" }
  | { readonly trigger: "state-transition"; readonly fromState: "alert"; readonly toState: "normal" }
  | { readonly trigger: "notification-state-loss"; readonly toState: "alert" }
);

/** Registered definition versions. A build writes exactly one of them. */
export type DefinitionsVersion = 1 | 2 | 3;

/** The #46 V-3 transfer observation and health evaluator apply from here (design §5.2). */
export const CURRENT_DEFINITIONS_VERSION = 3 satisfies DefinitionsVersion;
const CURRENT_DEFINITIONS_LABEL = "2026-08-05/v3-transfer-observation";

interface PipelineStatusDocumentV1 {
  readonly schemaVersion: 1;
  readonly definitionsVersion: DefinitionsVersion;
  readonly definitionsLabel: string;
  readonly updatedAt: string;
  readonly periods: Record<PipelinePeriod, PeriodStatusV1>;
  readonly lastDefinitionsTransition?: {
    readonly fromVersion: number;
    readonly toVersion: DefinitionsVersion;
    readonly changedAt: string;
  };
}

export class PipelineStatusSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PipelineStatusSchemaError";
  }
}

export class AtomicPipelineStatusWriter implements PipelineStatusWriter {
  private readonly renameFile: typeof rename;

  constructor(
    private readonly statusPath: string,
    private readonly runId = "unbound-run",
    options: AtomicPipelineStatusWriterOptions = {},
  ) {
    this.renameFile = options.renameFile ?? rename;
  }

  async write(status: PipelineStatus): Promise<PipelineStatusWriteResult> {
    const updatedAt = status.completedAt ?? status.startedAt;
    const read = await this.readDocument(updatedAt, status.period);
    const document = rebaselineForDefinitions(read.document, updatedAt);
    /** A version change discards prior history (design §5.3), so a stale recovery claim goes with it. */
    const recoveryNotification = document === read.document ? read.notification : undefined;
    const { document: next, notification: ownNotification } = status.outcome === "running"
      ? { document: recordActiveRun(document, status, this.runId, updatedAt) }
      : recordTerminal(document, status, this.runId, updatedAt);
    const temporaryPath = `${this.statusPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(temporaryPath, 0o600);
    await this.renameFile(temporaryPath, this.statusPath);
    /** This run's own transition (if any) reflects the most current outcome and takes priority. */
    const notification = ownNotification ?? recoveryNotification;
    return { ...(notification ? { notification } : {}) };
  }

  private async readDocument(
    observedAt: string,
    currentPeriod: PipelinePeriod,
  ): Promise<{ readonly document: PipelineStatusDocumentV1; readonly notification?: NotificationAttemptV1 }> {
    try {
      return parseDocument(JSON.parse(await readFile(this.statusPath, "utf8")), observedAt, currentPeriod);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { document: initialDocument() };
      }
      if (error instanceof PipelineStatusSchemaError) {
        throw error;
      }
      throw new PipelineStatusSchemaError(`cannot read pipeline status: ${String(error)}`);
    }
  }
}

/**
 * Design §5.3: observations counted under one definition are never continued
 * under another. An older status is rebaselined instead of being carried over.
 */
function rebaselineForDefinitions(
  document: PipelineStatusDocumentV1,
  changedAt: string,
): PipelineStatusDocumentV1 {
  if (document.definitionsVersion === CURRENT_DEFINITIONS_VERSION) {
    return document;
  }
  return {
    schemaVersion: 1,
    definitionsVersion: CURRENT_DEFINITIONS_VERSION,
    definitionsLabel: CURRENT_DEFINITIONS_LABEL,
    updatedAt: document.updatedAt,
    periods: { morning: initialPeriod(), evening: initialPeriod() },
    lastDefinitionsTransition: {
      fromVersion: document.definitionsVersion,
      toVersion: CURRENT_DEFINITIONS_VERSION,
      changedAt,
    },
  };
}

function initialDocument(): PipelineStatusDocumentV1 {
  return {
    schemaVersion: 1,
    definitionsVersion: CURRENT_DEFINITIONS_VERSION,
    definitionsLabel: CURRENT_DEFINITIONS_LABEL,
    updatedAt: new Date(0).toISOString(),
    periods: {
      morning: initialPeriod(),
      evening: initialPeriod(),
    },
  };
}

function initialPeriod(): PeriodStatusV1 {
  return {
    consecutiveFailureCount: 0,
    consecutiveNoDataCount: 0,
    health: { state: "unobserved", causes: [] },
  };
}

function recordActiveRun(
  document: PipelineStatusDocumentV1,
  status: PipelineStatus,
  runId: string,
  updatedAt: string,
): PipelineStatusDocumentV1 {
  const period = document.periods[status.period];
  const targetDate = requireTargetDate(status);
  return replacePeriod(document, status.period, {
    ...period,
    ...(period.activeRun
      ? {
          lastInterruptedRun: {
            ...period.activeRun,
            observedAt: updatedAt,
          },
        }
      : {}),
    activeRun: { runId, startedAt: status.startedAt, targetDate },
  }, updatedAt);
}

function recordTerminal(
  document: PipelineStatusDocumentV1,
  status: PipelineStatus,
  runId: string,
  updatedAt: string,
): { readonly document: PipelineStatusDocumentV1; readonly notification?: NotificationAttemptV1 } {
  if (!isPersistedPipelineOutcome(status.outcome)) {
    throw new PipelineStatusSchemaError(`unsupported terminal pipeline outcome ${status.outcome}`);
  }
  const outcome = status.outcome;
  const completedAt = status.completedAt;
  if (!completedAt) {
    throw new PipelineStatusSchemaError("terminal pipeline status requires completedAt");
  }
  const period = document.periods[status.period];
  const consecutiveNoDataCount = outcome === "completed:no-data"
    ? period.consecutiveNoDataCount + 1
    : outcome === "completed:transferred"
      ? 0
      : period.consecutiveNoDataCount;
  const lastDoneAt = outcome.startsWith("completed:") ? completedAt : period.lastDoneAt;
  const health = evaluateHealth({
    outcome,
    v3: status.v3,
    consecutiveNoDataCount,
    lastDoneAt,
    inputAnomalyCandidates: status.inputAnomalyCandidates,
    observedAt: updatedAt,
  });
  const transition = stateTransitionTrigger(period.health.state, health.state);
  const notification: NotificationAttemptV1 | undefined = transition
    ? { ...transition, attemptId: runId, claimedAt: updatedAt, result: "claimed" }
    : undefined;
  const next: PeriodStatusV1 = {
    ...period,
    ...(isFailure(outcome)
      ? { consecutiveFailureCount: period.consecutiveFailureCount + 1 }
      : { consecutiveFailureCount: 0 }),
    consecutiveNoDataCount,
    health,
    lastTerminal: {
      runId,
      outcome,
      startedAt: status.startedAt,
      completedAt,
      targetDate: requireTargetDate(status),
      counts: status.counts,
      ...(status.diagnostic ? { diagnostic: status.diagnostic } : {}),
      ...(status.inputAnomalyCandidates
        ? { inputAnomalyCandidates: status.inputAnomalyCandidates }
        : {}),
      ...(status.v3 ? { v3: status.v3 } : {}),
    },
    ...(lastDoneAt !== period.lastDoneAt ? { lastDoneAt } : {}),
    ...(outcome === "completed:transferred" ? { lastTransferredAt: completedAt } : {}),
    ...(notification ? { lastNotificationAttempt: notification } : {}),
  };
  delete (next as { activeRun?: unknown }).activeRun;
  return { document: replacePeriod(document, status.period, next, updatedAt), ...(notification ? { notification } : {}) };
}

/**
 * Design §9.1/AC-112: only these three moves are notified. A cause change
 * that leaves the state at `alert` re-notifies nobody.
 */
function stateTransitionTrigger(
  fromState: "unobserved" | "normal" | "alert",
  toState: "unobserved" | "normal" | "alert",
):
  | { readonly trigger: "state-transition"; readonly fromState: "unobserved" | "normal"; readonly toState: "alert" }
  | { readonly trigger: "state-transition"; readonly fromState: "alert"; readonly toState: "normal" }
  | undefined {
  if ((fromState === "unobserved" || fromState === "normal") && toState === "alert") {
    return { trigger: "state-transition", fromState, toState };
  }
  if (fromState === "alert" && toState === "normal") {
    return { trigger: "state-transition", fromState, toState };
  }
  return undefined;
}

/** Design §8.2: health is re-evaluated from this run's terminal, not carried forward. */
function evaluateHealth(options: {
  readonly outcome: PersistedPipelineOutcome;
  readonly v3: V3Observation | undefined;
  readonly consecutiveNoDataCount: number;
  readonly lastDoneAt: string | undefined;
  readonly observedAt: string;
  readonly inputAnomalyCandidates?: readonly InputAnomalyCandidate[] | undefined;
}): HealthStatusV1 {
  const causes: HealthCause[] = [];
  if (isFailure(options.outcome)) {
    causes.push("terminal-failure");
  }
  if ((options.v3?.windowedWeightCount ?? 0) >= 1 && options.v3?.transfer.state !== "written") {
    causes.push("v3-not-transferred");
  }
  if (options.lastDoneAt !== undefined &&
    Date.parse(options.observedAt) - Date.parse(options.lastDoneAt) >= 2 * 24 * 60 * 60 * 1000) {
    causes.push("v1-stale");
  }
  if (options.consecutiveNoDataCount >= 4) {
    causes.push("consecutive-no-data");
  }
  /** #66 (design 2026-08-04T171300 §4): an unrecognized filename is not silently absorbed. */
  if ((options.inputAnomalyCandidates?.length ?? 0) > 0) {
    causes.push("input-anomaly-candidates");
  }
  return causes.length > 0 ? { state: "alert", causes } : { state: "normal", causes: [] };
}

function replacePeriod(
  document: PipelineStatusDocumentV1,
  period: PipelinePeriod,
  nextPeriod: PeriodStatusV1,
  updatedAt: string,
): PipelineStatusDocumentV1 {
  return {
    ...document,
    updatedAt,
    periods: { ...document.periods, [period]: nextPeriod },
  };
}

function requireTargetDate(status: PipelineStatus): string {
  if (!status.targetDate) {
    throw new PipelineStatusSchemaError("pipeline status requires targetDate");
  }
  return status.targetDate;
}

function isFailure(outcome: PersistedPipelineOutcome): boolean {
  return outcome.startsWith("failed:");
}

function isPersistedPipelineOutcome(value: string): value is PersistedPipelineOutcome {
  return value === "completed:no-data" ||
    value === "completed:transferred" ||
    value === "failed:input-missing" ||
    value === "failed:input-unstable" ||
    value === "failed:input-invalid-or-partial" ||
    value === "failed:transfer";
}

function parseDocument(
  value: unknown,
  observedAt: string,
  currentPeriod: PipelinePeriod,
): { readonly document: PipelineStatusDocumentV1; readonly notification?: NotificationAttemptV1 } {
  if (!isRecord(value)) {
    throw new PipelineStatusSchemaError("pipeline status must be a JSON object");
  }
  if (value.schemaVersion !== 1) {
    throw new PipelineStatusSchemaError(`unsupported status schema version ${String(value.schemaVersion ?? 0)}`);
  }
  if (!isWellFormedDefinitionsVersion(value.definitionsVersion)) {
    throw new PipelineStatusSchemaError(
      `unsupported status definitions version ${String(value.definitionsVersion ?? 0)}`,
    );
  }
  if (value.definitionsVersion > CURRENT_DEFINITIONS_VERSION) {
    throw new PipelineStatusSchemaError(
      `status definitions version ${value.definitionsVersion} is newer than this build`,
    );
  }
  if (typeof value.definitionsLabel !== "string") {
    throw new PipelineStatusSchemaError("pipeline status definitionsLabel must be a string");
  }
  if (!isRecord(value.periods)) {
    throw new PipelineStatusSchemaError("pipeline status has an invalid period state");
  }
  const morning = parsePeriodState(value.periods.morning, observedAt);
  const evening = parsePeriodState(value.periods.evening, observedAt);
  if (!morning || !evening) {
    throw new PipelineStatusSchemaError("pipeline status has an invalid period state");
  }
  const document = {
    ...value,
    periods: { morning: morning.period, evening: evening.period },
  } as unknown as PipelineStatusDocumentV1;
  const recovered = currentPeriod === "morning" ? morning : evening;
  return { document, ...(recovered.notification ? { notification: recovered.notification } : {}) };
}

/**
 * Any positive integer is a well-formed version number, known or not: design
 * §5.2 treats an unrecognized higher value as a newer binary's write, not
 * corruption, so the two must stay distinguishable at the parse boundary.
 */
function isWellFormedDefinitionsVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidPeriodState(value: unknown): value is PeriodStatusV1 {
  if (!hasValidCounters(value) ||
    !isRecord(value.health) ||
    (value.health.state !== "unobserved" && value.health.state !== "normal" && value.health.state !== "alert") ||
    !Array.isArray(value.health.causes)) {
    return false;
  }
  return true;
}

function parsePeriodState(
  value: unknown,
  observedAt: unknown,
): { readonly period: PeriodStatusV1; readonly notification?: NotificationAttemptV1 } | undefined {
  if (isValidPeriodState(value)) {
    return { period: value };
  }
  if (!hasValidCounters(value) || !isRecord(value) || "health" in value ||
    !isTerminalObservation(value.lastTerminal) || typeof observedAt !== "string") {
    return undefined;
  }
  const terminal = value.lastTerminal;
  const health = evaluateRecoveredHealth(value, terminal, observedAt);
  /** Design §9.1: recovering into `alert` claims one notification; recovering into `normal` claims none. */
  const notification: NotificationAttemptV1 | undefined = health.state === "alert"
    ? {
        trigger: "notification-state-loss",
        toState: "alert",
        attemptId: `notification-state-loss:${terminal.runId}`,
        claimedAt: observedAt,
        result: "claimed",
      }
    : undefined;
  const period = {
    ...value,
    consecutiveFailureCount: value.consecutiveFailureCount as number,
    consecutiveNoDataCount: value.consecutiveNoDataCount as number,
    health,
    lastNotificationDiagnostic: {
      code: "notification-state-missing",
      observedAt,
      lastTerminalRunId: terminal.runId,
    },
    ...(notification ? { lastNotificationAttempt: notification } : {}),
  } as PeriodStatusV1;
  return { period, ...(notification ? { notification } : {}) };
}

function evaluateRecoveredHealth(
  period: Record<string, unknown>,
  terminal: TerminalObservationV1,
  observedAt: string,
): HealthStatusV1 {
  return evaluateHealth({
    outcome: terminal.outcome,
    v3: terminal.v3,
    consecutiveNoDataCount: period.consecutiveNoDataCount as number,
    lastDoneAt: typeof period.lastDoneAt === "string" ? period.lastDoneAt : undefined,
    observedAt,
    inputAnomalyCandidates: terminal.inputAnomalyCandidates,
  });
}

function hasValidCounters(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) ||
    typeof value.consecutiveFailureCount !== "number" ||
    !Number.isInteger(value.consecutiveFailureCount) || value.consecutiveFailureCount < 0 ||
    typeof value.consecutiveNoDataCount !== "number" ||
    !Number.isInteger(value.consecutiveNoDataCount) || value.consecutiveNoDataCount < 0) {
    return false;
  }
  return true;
}

function isTerminalObservation(value: unknown): value is TerminalObservationV1 {
  return isRecord(value) && typeof value.runId === "string" &&
    typeof value.outcome === "string" && isPersistedPipelineOutcome(value.outcome) &&
    typeof value.startedAt === "string" && typeof value.completedAt === "string" &&
    typeof value.targetDate === "string" && isRecord(value.counts);
}
