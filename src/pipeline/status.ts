import { chmod, readFile, rename, writeFile } from "node:fs/promises";

import type { InputAnomalyCandidate } from "../sources/scale-exporter/index.js";

export type PipelinePeriod = "morning" | "evening";

export interface PipelineCounts {
  readonly matchedFileCount?: number;
  readonly readLineCount?: number;
  readonly windowedReadingCount?: number;
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
}

export type PersistedPipelineOutcome =
  | "completed:no-data"
  | "completed:transferred"
  | "failed:input-missing"
  | "failed:input-unstable"
  | "failed:input-invalid-or-partial"
  | "failed:transfer";

export interface PipelineStatusWriter {
  write(status: PipelineStatus): Promise<void>;
}

interface HealthStatusV1 {
  readonly state: "unobserved" | "normal" | "alert";
  readonly causes: readonly string[];
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

interface PipelineStatusDocumentV1 {
  readonly schemaVersion: 1;
  readonly definitionsVersion: 1;
  readonly definitionsLabel: "2026-08-04/pre-63";
  readonly updatedAt: string;
  readonly periods: Record<PipelinePeriod, PeriodStatusV1>;
}

export class PipelineStatusSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PipelineStatusSchemaError";
  }
}

export class AtomicPipelineStatusWriter implements PipelineStatusWriter {
  constructor(
    private readonly statusPath: string,
    private readonly runId = "unbound-run",
  ) {}

  async write(status: PipelineStatus): Promise<void> {
    const updatedAt = status.completedAt ?? status.startedAt;
    const document = await this.readDocument(updatedAt);
    const next = status.outcome === "running"
      ? recordActiveRun(document, status, this.runId, updatedAt)
      : recordTerminal(document, status, this.runId, updatedAt);
    const temporaryPath = `${this.statusPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, this.statusPath);
  }

  private async readDocument(observedAt: string): Promise<PipelineStatusDocumentV1> {
    try {
      return parseDocument(JSON.parse(await readFile(this.statusPath, "utf8")), observedAt);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return initialDocument();
      }
      if (error instanceof PipelineStatusSchemaError) {
        throw error;
      }
      throw new PipelineStatusSchemaError(`cannot read pipeline status: ${String(error)}`);
    }
  }
}

function initialDocument(): PipelineStatusDocumentV1 {
  return {
    schemaVersion: 1,
    definitionsVersion: 1,
    definitionsLabel: "2026-08-04/pre-63",
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
): PipelineStatusDocumentV1 {
  if (!isPersistedPipelineOutcome(status.outcome)) {
    throw new PipelineStatusSchemaError(`unsupported terminal pipeline outcome ${status.outcome}`);
  }
  const outcome = status.outcome;
  const completedAt = status.completedAt;
  if (!completedAt) {
    throw new PipelineStatusSchemaError("terminal pipeline status requires completedAt");
  }
  const period = document.periods[status.period];
  const next: PeriodStatusV1 = {
    ...period,
    ...(isFailure(outcome)
      ? { consecutiveFailureCount: period.consecutiveFailureCount + 1 }
      : { consecutiveFailureCount: 0 }),
    ...(outcome === "completed:no-data"
      ? { consecutiveNoDataCount: period.consecutiveNoDataCount + 1 }
      : outcome === "completed:transferred"
      ? { consecutiveNoDataCount: 0 }
      : {}),
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
    },
    ...(outcome.startsWith("completed:") ? { lastDoneAt: completedAt } : {}),
    ...(outcome === "completed:transferred" ? { lastTransferredAt: completedAt } : {}),
  };
  delete (next as { activeRun?: unknown }).activeRun;
  return replacePeriod(document, status.period, next, updatedAt);
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

function parseDocument(value: unknown, observedAt: string): PipelineStatusDocumentV1 {
  if (!isRecord(value)) {
    throw new PipelineStatusSchemaError("pipeline status must be a JSON object");
  }
  if (value.schemaVersion !== 1) {
    throw new PipelineStatusSchemaError(`unsupported status schema version ${String(value.schemaVersion ?? 0)}`);
  }
  if (value.definitionsVersion !== 1) {
    throw new PipelineStatusSchemaError(
      `unsupported status definitions version ${String(value.definitionsVersion ?? 0)}`,
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
  return { ...value, periods: { morning, evening } } as unknown as PipelineStatusDocumentV1;
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

function parsePeriodState(value: unknown, observedAt: unknown): PeriodStatusV1 | undefined {
  if (isValidPeriodState(value)) {
    return value;
  }
  if (!hasValidCounters(value) || !isRecord(value) || "health" in value ||
    !isTerminalObservation(value.lastTerminal) || typeof observedAt !== "string") {
    return undefined;
  }
  const terminal = value.lastTerminal;
  return {
    ...value,
    consecutiveFailureCount: value.consecutiveFailureCount as number,
    consecutiveNoDataCount: value.consecutiveNoDataCount as number,
    health: evaluateRecoveredHealth(value, terminal, observedAt),
    lastNotificationDiagnostic: {
      code: "notification-state-missing",
      observedAt,
      lastTerminalRunId: terminal.runId,
    },
  } as PeriodStatusV1;
}

function evaluateRecoveredHealth(
  period: Record<string, unknown>,
  terminal: TerminalObservationV1,
  observedAt: string,
): HealthStatusV1 {
  const causes: string[] = [];
  if (isFailure(terminal.outcome)) {
    causes.push("terminal-failure");
  }
  if ((period.consecutiveNoDataCount as number) >= 4) {
    causes.push("consecutive-no-data");
  }
  if (typeof period.lastDoneAt === "string" &&
    Date.parse(observedAt) - Date.parse(period.lastDoneAt) >= 2 * 24 * 60 * 60 * 1000) {
    causes.push("v1-stale");
  }
  return causes.length > 0 ? { state: "alert", causes } : { state: "normal", causes: [] };
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
