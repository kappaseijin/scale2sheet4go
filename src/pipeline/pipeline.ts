import type { MeasurementPeriod, MeasurementReading } from "../domain/index.js";
import { filterReadingsByPeriodWindow } from "../service/index.js";

import {
  InputSnapshotError,
  type StableInputSnapshot,
} from "./input-snapshot.js";
import type { PipelineStatusWriter } from "./status.js";
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
  readonly transfer: (readings: readonly MeasurementReading[]) => Promise<void>;
  readonly notifier?: { notify(stage: "input" | "transfer", period: MeasurementPeriod): Promise<void> };
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
  ) => {
    const completedAt = outcome === "running"
      ? undefined
      : (options.clock ?? (() => new Date()))().toISOString();
    await options.statusWriter?.write({
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
    });
    if (completedAt && options.targetDate && inputAnomalyCandidates.length > 0) {
      (options.logger ?? console).log(JSON.stringify({
        at: completedAt,
        event: "input-anomaly-candidates",
        targetDate: options.targetDate,
        inputAnomalyCandidates,
      }));
    }
  };
  await writeStatus("running", {});
  let input: StableInputSnapshot;
  try {
    input = await options.readInput();
  } catch (error) {
    if (error instanceof InputSnapshotError) {
      await options.notifier?.notify("input", options.period);
      await writeStatus(
        `failed:${error.outcome}`,
        error.counts,
        error.diagnostic,
        error.inputAnomalyCandidates,
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
  const deduplicatedReadings = deduplicateReadings(windowedReadings);
  if (deduplicatedReadings.length === 0) {
    await writeStatus("completed:no-data", {
      matchedFileCount: input.matchedFileCount,
      readLineCount: input.readLineCount,
      windowedReadingCount: 0,
    }, undefined, input.inputAnomalyCandidates);
    return { exitCode: 0, outcome: "completed:no-data" };
  }

  try {
    await options.transfer(deduplicatedReadings);
  } catch (error) {
    await options.notifier?.notify("transfer", options.period);
    await writeStatus("failed:transfer", {
      matchedFileCount: input.matchedFileCount,
      readLineCount: input.readLineCount,
      windowedReadingCount: deduplicatedReadings.length,
    }, error instanceof Error ? error.message : String(error), input.inputAnomalyCandidates);
    return { exitCode: 1, outcome: "failed:transfer" };
  }
  await writeStatus("completed:transferred", {
    matchedFileCount: input.matchedFileCount,
    readLineCount: input.readLineCount,
    windowedReadingCount: deduplicatedReadings.length,
  }, undefined, input.inputAnomalyCandidates);
  return { exitCode: 0, outcome: "completed:transferred" };
}

function deduplicateReadings(readings: readonly MeasurementReading[]): MeasurementReading[] {
  const seen = new Set<string>();
  return readings.filter((reading) => {
    const key = [reading.measuredAt, reading.kind, reading.value, reading.source].join("|");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
