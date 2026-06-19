import { DateTime } from "luxon";

import type { AppConfig, GoogleSheetsAuthConfig } from "../config/index.js";
import {
  requireAppleHealthConfig,
  requireGoogleFitConfig,
  requireGoogleSheetsConfig,
} from "../config/index.js";
import type {
  LatestMeasurementSet,
  MeasurementPeriod,
  MeasurementReading,
  MeasurementSource,
  SpreadsheetRow,
} from "../domain/index.js";
import { latestByKind, measurementPeriodLabels } from "../domain/index.js";
import {
  readAppleHealthMeasurements,
  readGoogleFitMeasurements,
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
      `No ${latestSet.period} measurements found in the configured time window. Nothing was written.`,
    );
    return undefined;
  }

  const row = toSpreadsheetRow(latestSet, options.config.timeZone);

  const updated = await updateSpreadsheetMeasurements({
    config:
      options.sheetsConfig ?? requireGoogleSheetsConfig(options.config),
    latestSet,
    timeZone: options.config.timeZone,
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
  return (
    latestSet.weightKg !== undefined ||
    latestSet.bodyTemperatureCelsius !== undefined ||
    latestSet.bloodPressureSystolicMmHg !== undefined ||
    latestSet.bloodPressureDiastolicMmHg !== undefined ||
    latestSet.pulseBpm !== undefined
  );
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
  const latestReadings = latestByKind(readings);

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
    capturedAt,
    source,
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
  return reading ? ({ [key]: reading.value } as Pick<LatestMeasurementSet, Key>) : {};
}
