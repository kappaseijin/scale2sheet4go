import type { MeasurementPeriod, MeasurementReading } from "../domain/index.js";
import { filterReadingsByPeriodWindow } from "../service/index.js";

import {
  InputSnapshotError,
  type StableInputSnapshot,
} from "./input-snapshot.js";

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
}

export async function runPipeline(options: RunPipelineOptions): Promise<PipelineResult> {
  let input: StableInputSnapshot;
  try {
    input = await options.readInput();
  } catch (error) {
    if (error instanceof InputSnapshotError) {
      await options.notifier?.notify("input", options.period);
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
    return { exitCode: 0, outcome: "completed:no-data" };
  }

  try {
    await options.transfer(deduplicatedReadings);
  } catch (error) {
    await options.notifier?.notify("transfer", options.period);
    return { exitCode: 1, outcome: "failed:transfer" };
  }
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
