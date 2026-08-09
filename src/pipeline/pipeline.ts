import type { MeasurementPeriod, MeasurementReading, TransferOutcome } from "../domain/index.js";
import {
  countMeasurements,
  deduplicateCrossSourceReadings,
  deduplicateExactReadings,
  filterReadingsByPeriodWindow,
} from "../service/index.js";

import {
  InputSnapshotError,
  type StableInputSnapshot,
} from "./input-snapshot.js";
import type { HealthState, PipelineStatusWriter, V3Observation } from "./status.js";
import type { InputAnomalyCandidate } from "../sources/scale-exporter/index.js";

export type PipelineOutcome =
  | "completed:no-data"
  | "completed:transferred"
  | "failed:input-missing"
  | "failed:input-unstable"
  | "failed:input-invalid-or-partial"
  | "failed:transfer"
  | "failed:invalid-arguments";

export interface PipelineResult {
  readonly exitCode: 0 | 1 | 2;
  readonly outcome: PipelineOutcome;
}

export interface RunPipelineOptions {
  readonly period: MeasurementPeriod;
  readonly timeZone: string;
  readonly referenceTime: Date;
  readonly readInput: () => Promise<StableInputSnapshot>;
  readonly transfer: (readings: readonly MeasurementReading[]) => Promise<TransferOutcome>;
  readonly notifier?: {
    notify(period: MeasurementPeriod, transition: { fromState: HealthState; toState: HealthState }): Promise<void>;
  };
  readonly logger?: Pick<Console, "log">;
  readonly statusWriter?: PipelineStatusWriter;
  readonly clock?: () => Date;
  readonly targetDate?: string;
}

export async function runPipeline(options: RunPipelineOptions): Promise<PipelineResult> {
  const startedAt = (options.clock ?? (() => new Date()))().toISOString();
  const writeStatus = async (
    outcome: PipelineOutcome | "running",
    counts: Parameters<PipelineStatusWriter["write"]>[0]["counts"],
    diagnostic?: string,
    inputAnomalyCandidates: readonly InputAnomalyCandidate[] = [],
    v3?: V3Observation,
  ) => {
    const completedAt = outcome === "running"
      ? undefined
      : (options.clock ?? (() => new Date()))().toISOString();
    const result = await options.statusWriter?.write({
      period: options.period,
      outcome,
      startedAt,
      ...(completedAt ? { completedAt } : {}),
      ...(options.targetDate ? { targetDate: options.targetDate } : {}),
      counts,
      ...(diagnostic ? { diagnostic } : {}),
      ...(inputAnomalyCandidates.length > 0
        ? { inputAnomalyCandidates }
        : {}),
      ...(v3 ? { v3 } : {}),
    });
    if (completedAt && options.targetDate && inputAnomalyCandidates.length > 0) {
      (options.logger ?? console).log(JSON.stringify({
        at: completedAt,
        event: "input-anomaly-candidates",
        targetDate: options.targetDate,
        inputAnomalyCandidates,
      }));
    }
    /**
     * AC-112: notify only the transition(s) this write claimed, never on
     * every failure. design §9.1/§9.2: `notification-state-loss` also
     * claims one alert notification when a status document that lost its
     * `health` key is recovered and re-evaluates to `alert` (never to
     * `normal` — that case claims nothing, per §9.1). It carries no
     * `fromState` (the prior confirmed state was lost, not skipped), so
     * `unobserved` is used: the closest true reading is "no confirmed
     * state existed before this", which is also the only other trigger
     * whose toState is `alert` and that MacOsNotifier's message doesn't
     * otherwise distinguish by fromState.
     *
     * #165: recovery is a document-wide event. A single write can claim a
     * notification for its OWN period (this run's outcome) and, at the
     * same time, for the OTHER period (its missing health recovered by
     * this same read). Both are real alerts and both are delivered here,
     * to the period each one actually belongs to — not always
     * options.period.
     */
    for (const entry of result?.notifications ?? []) {
      if (entry.notification.trigger === "state-transition") {
        await options.notifier?.notify(entry.period, {
          fromState: entry.notification.fromState,
          toState: entry.notification.toState,
        });
      } else if (entry.notification.trigger === "notification-state-loss") {
        await options.notifier?.notify(entry.period, {
          fromState: "unobserved",
          toState: entry.notification.toState,
        });
      }
    }
  };
  await writeStatus("running", {});
  let input: StableInputSnapshot;
  try {
    input = await options.readInput();
  } catch (error) {
    if (error instanceof InputSnapshotError) {
      await writeStatus(
        `failed:${error.outcome}`,
        error.counts,
        error.diagnostic,
        error.inputAnomalyCandidates,
        { input: "unavailable", transfer: { state: "not-attempted" } },
      );
      return { exitCode: 1, outcome: `failed:${error.outcome}` };
    }
    throw error;
  }

  const windowedReadings = filterReadingsByPeriodWindow({
    readings: input.readings,
    period: options.period,
    referenceTime: options.referenceTime,
    timeZone: options.timeZone,
  });
  const deduplicatedReadings = deduplicateCrossSourceReadings(
    deduplicateExactReadings(windowedReadings),
  );
  const counts = {
    matchedFileCount: input.matchedFileCount,
    readLineCount: input.readLineCount,
    ...countMeasurements(windowedReadings),
  };
  /** V-3 (design §7.2): the decision to transfer uses weight presence only, not any reading. */
  const windowedWeightCount = deduplicatedReadings.filter((reading) => reading.kind === "weight").length;
  if (windowedWeightCount === 0) {
    await writeStatus(
      "completed:no-data",
      counts,
      undefined,
      input.inputAnomalyCandidates,
      { input: "ready", windowedWeightCount: 0, transfer: { state: "not-attempted" } },
    );
    return { exitCode: 0, outcome: "completed:no-data" };
  }

  let transferOutcome: TransferOutcome;
  try {
    transferOutcome = await options.transfer(deduplicatedReadings);
  } catch (error) {
    await writeStatus(
      "failed:transfer",
      counts,
      error instanceof Error ? error.message : String(error),
      input.inputAnomalyCandidates,
      { input: "ready", windowedWeightCount, transfer: { state: "failed" } },
    );
    return { exitCode: 1, outcome: "failed:transfer" };
  }

  const v3: V3Observation = {
    input: "ready",
    windowedWeightCount,
    transfer: {
      state: transferOutcome.state,
      ...(transferOutcome.transferredCellCount !== undefined
        ? { transferredCellCount: transferOutcome.transferredCellCount }
        : {}),
    },
  };

  /** V-3 (design §7.2): a response with no confirmed cell updates is a failure, not a success. */
  if (transferOutcome.state !== "written" || (transferOutcome.transferredCellCount ?? 0) < 1) {
    await writeStatus(
      "failed:transfer",
      counts,
      `transfer reported ${transferOutcome.state} with ${transferOutcome.transferredCellCount ?? "unknown"} cell(s) updated`,
      input.inputAnomalyCandidates,
      v3,
    );
    return { exitCode: 1, outcome: "failed:transfer" };
  }

  await writeStatus("completed:transferred", counts, undefined, input.inputAnomalyCandidates, v3);
  return { exitCode: 0, outcome: "completed:transferred" };
}
