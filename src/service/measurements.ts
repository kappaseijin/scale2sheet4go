import { DateTime } from "luxon";

import type { AppConfig, GoogleSheetsAuthConfig } from "../config/index.js";
import {
  requireAppleHealthConfig,
  requireGoogleFitConfig,
  requireGoogleSheetsConfig,
} from "../config/index.js";
import type {
  LatestMeasurementSet,
  MeasurementCounts,
  MeasurementPeriod,
  MeasurementReading,
  MeasurementSource,
  SpreadsheetRow,
} from "../domain/index.js";
import {
  measurementPeriodLabels,
  roundToMeasurementResolution,
  selectReadingsByWeightAnchor,
} from "../domain/index.js";
import {
  readAppleHealthMeasurements,
  readGoogleFitMeasurements,
  readScaleExporterMeasurements,
} from "../sources/index.js";
import type { MeasurementSourceOption } from "../sources/index.js";
import { updateSpreadsheetMeasurements } from "../sheets/index.js";

interface Logger {
  log(message: string): void;
  error(message: string): void;
}

export interface CollectMeasurementsOptions {
  readonly config: AppConfig;
  readonly source: MeasurementSourceOption;
  readonly period?: MeasurementPeriod;
  readonly referenceTime?: Date;
}

export interface SyncMeasurementsOptions extends CollectMeasurementsOptions {
  readonly sheetsConfig?: GoogleSheetsAuthConfig;
  readonly logger?: Logger;
}

export async function collectLatestMeasurementSet({
  config,
  source,
  period,
  referenceTime = new Date(),
}: CollectMeasurementsOptions): Promise<LatestMeasurementSet> {
  const resolvedPeriod =
    period ?? determineMeasurementPeriod(referenceTime, config.timeZone);
  const readings = await readLatestMeasurementsForSource(
    config,
    source,
    referenceTime,
  );
  const windowedReadings = filterReadingsByPeriodWindow({
    readings,
    period: resolvedPeriod,
    referenceTime,
    timeZone: config.timeZone,
  });

  return buildLatestMeasurementSet({
    readings: windowedReadings,
    period: resolvedPeriod,
    capturedAt: referenceTime.toISOString(),
  });
}

export async function syncMeasurements(
  options: SyncMeasurementsOptions,
): Promise<SpreadsheetRow | undefined> {
  const logger = options.logger ?? console;
  const latestSet = await collectLatestMeasurementSet(options);
  if (!hasAnyMeasurementValue(latestSet)) {
    logger.log(
      `No ${latestSet.period} weight measurement found in the configured time window. Nothing was written.`,
    );
    return undefined;
  }

  return transferLatestMeasurementSet({
    latestSet,
    sheetsConfig: options.sheetsConfig ?? requireGoogleSheetsConfig(options.config),
    timeZone: options.config.timeZone,
    logger,
  });
}

export interface TransferLatestMeasurementSetOptions {
  readonly latestSet: LatestMeasurementSet;
  readonly sheetsConfig: GoogleSheetsAuthConfig;
  readonly timeZone: string;
  readonly logger?: Logger;
}

/** Transfers a prepared set without reading, windowing, or no-data classification. */
export async function transferLatestMeasurementSet({
  latestSet,
  sheetsConfig,
  timeZone,
  logger = console,
}: TransferLatestMeasurementSetOptions): Promise<SpreadsheetRow | undefined> {
  const row = toSpreadsheetRow(latestSet, timeZone);

  const updated = await updateSpreadsheetMeasurements({
    config: sheetsConfig,
    latestSet,
    timeZone,
    logger,
  });

  return updated ? row : undefined;
}

export interface FilterReadingsByPeriodWindowOptions {
  readonly readings: readonly MeasurementReading[];
  readonly period: MeasurementPeriod;
  readonly referenceTime: Date;
  readonly timeZone: string;
}

export function filterReadingsByPeriodWindow({
  readings,
  period,
  referenceTime,
  timeZone,
}: FilterReadingsByPeriodWindowOptions): MeasurementReading[] {
  const targetDate = DateTime.fromJSDate(referenceTime, { zone: timeZone });
  return readings.filter((reading) =>
    isReadingInPeriodWindow(reading, period, targetDate, timeZone),
  );
}

export function isReadingInPeriodWindow(
  reading: MeasurementReading,
  period: MeasurementPeriod,
  targetDate: DateTime,
  timeZone: string,
): boolean {
  const measuredAt = DateTime.fromISO(reading.measuredAt, {
    zone: "utc",
  }).setZone(timeZone);
  if (!measuredAt.isValid || !measuredAt.hasSame(targetDate, "day")) {
    return false;
  }

  const minutes = measuredAt.hour * 60 + measuredAt.minute;
  const window = measurementPeriodWindowMinutes[period];
  return minutes >= window.start && minutes <= window.end;
}

const measurementPeriodWindowMinutes = {
  morning: {
    start: 5 * 60,
    end: 12 * 60,
  },
  evening: {
    start: 20 * 60,
    end: 23 * 60 + 30,
  },
} as const satisfies Record<
  MeasurementPeriod,
  { readonly start: number; readonly end: number }
>;

export function hasAnyMeasurementValue(latestSet: LatestMeasurementSet): boolean {
  return latestSet.weightKg !== undefined;
}

export function buildLatestMeasurementSet({
  readings,
  period,
  capturedAt,
}: {
  readonly readings: readonly MeasurementReading[];
  readonly period: MeasurementPeriod;
  readonly capturedAt: string;
}): LatestMeasurementSet {
  const publishedReadings = deduplicateExactReadings(readings);
  const uniqueReadings = deduplicateCrossSourceReadings(publishedReadings);
  const latestReadings = selectReadingsByWeightAnchor(uniqueReadings, period);
  const weightReading = latestReadings.get("weight");

  const sources = new Set<Exclude<MeasurementSource, "mixed">>();
  const sourcesByKind: LatestMeasurementSet["sourcesByKind"] = {};

  for (const [kind, reading] of latestReadings) {
    sources.add(reading.source);
    sourcesByKind[kind] = reading.source;
  }

  const source =
    sources.size === 0
      ? "mixed"
      : sources.size === 1
        ? [...sources][0] ?? "mixed"
        : "mixed";

  return {
    period,
    capturedAt: weightReading?.measuredAt ?? capturedAt,
    source,
    counts: {
      windowedReadingCount: publishedReadings.length,
      uniqueMeasurementCount: uniqueReadings.length,
    },
    sourcesByKind,
    ...numberField("weightKg", latestReadings.get("weight")),
    ...numberField(
      "bodyTemperatureCelsius",
      latestReadings.get("body_temperature"),
    ),
    ...numberField(
      "bloodPressureSystolicMmHg",
      latestReadings.get("blood_pressure_systolic"),
    ),
    ...numberField(
      "bloodPressureDiastolicMmHg",
      latestReadings.get("blood_pressure_diastolic"),
    ),
    ...numberField("pulseBpm", latestReadings.get("pulse")),
  };
}

/** F-2: both units are counted from one place so `run` and `pipeline` cannot drift apart. */
export function countMeasurements(
  readings: readonly MeasurementReading[],
): MeasurementCounts {
  const publishedReadings = deduplicateExactReadings(readings);
  return {
    windowedReadingCount: publishedReadings.length,
    uniqueMeasurementCount: deduplicateCrossSourceReadings(publishedReadings).length,
  };
}

/** AC-55: exact repeats of one published record stay removed, path by path. */
export function deduplicateExactReadings(
  readings: readonly MeasurementReading[],
): MeasurementReading[] {
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

/** D-5: compare approximate values only across source paths, never within one path. */
export function deduplicateCrossSourceReadings(readings: readonly MeasurementReading[]): MeasurementReading[] {
  const retained: MeasurementReading[] = [];
  for (const reading of readings) {
    const duplicate = retained.find((other) => other.source !== reading.source && other.kind === reading.kind &&
      other.measuredAt === reading.measuredAt && Math.abs(other.value - reading.value) /
        Math.max(Math.abs(other.value), Math.abs(reading.value), 1) <= 1e-5);
    if (!duplicate) retained.push(reading);
  }
  return retained;
}

export function determineMeasurementPeriod(
  referenceTime: Date,
  timeZone: string,
): MeasurementPeriod {
  const hour = DateTime.fromJSDate(referenceTime, { zone: timeZone }).hour;
  return hour < 12 ? "morning" : "evening";
}

export function toSpreadsheetRow(
  latestSet: LatestMeasurementSet,
  timeZone: string,
): SpreadsheetRow {
  const capturedAt = DateTime.fromISO(latestSet.capturedAt, {
    zone: "utc",
  }).setZone(timeZone);

  return {
    date: capturedAt.toFormat("yyyy-MM-dd"),
    time: capturedAt.toFormat("HH:mm"),
    periodLabel: measurementPeriodLabels[latestSet.period],
    weightKg: latestSet.weightKg ?? "",
    bodyTemperatureCelsius: latestSet.bodyTemperatureCelsius ?? "",
    bloodPressureSystolicMmHg: latestSet.bloodPressureSystolicMmHg ?? "",
    bloodPressureDiastolicMmHg: latestSet.bloodPressureDiastolicMmHg ?? "",
    pulseBpm: latestSet.pulseBpm ?? "",
    source: latestSet.source,
  };
}

export async function readLatestMeasurementsForSource(
  config: AppConfig,
  source: MeasurementSourceOption,
  referenceTime: Date,
): Promise<MeasurementReading[]> {
  if (source === "scale-exporter") {
    return readScaleExporterMeasurements(
      config.scaleExporter,
      referenceTime,
      config.timeZone,
    );
  }

  if (source === "google-fit") {
    return readGoogleFitMeasurements(
      requireGoogleFitConfig(config),
      referenceTime,
    );
  }

  return readAppleHealthMeasurements(requireAppleHealthConfig(config));
}

function numberField<Key extends keyof LatestMeasurementSet>(
  key: Key,
  reading: MeasurementReading | undefined,
): Partial<Pick<LatestMeasurementSet, Key>> {
  return reading
    ? ({
        [key]: roundToMeasurementResolution(reading.value, reading.kind),
      } as Pick<LatestMeasurementSet, Key>)
    : {};
}
