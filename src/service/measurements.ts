import { DateTime } from "luxon";

import type { AppConfig, GoogleSheetsAuthConfig } from "../config/index.js";
import {
  requireAppleHealthConfig,
  requireGoogleFitConfig,
  requireGoogleSheetsConfig,
} from "../config/index.js";
import type {
  LatestMeasurementSet,
  MeasurementKind,
  MeasurementPeriod,
  MeasurementReading,
  MeasurementSource,
  SpreadsheetRow,
} from "../domain/index.js";
import { measurementPeriodLabels } from "../domain/index.js";
import {
  readAppleHealthLatestMeasurements,
  readGoogleFitLatestMeasurements,
} from "../sources/index.js";
import type { MeasurementSourceOption } from "../sources/index.js";
import { appendSpreadsheetRow } from "../sheets/index.js";

export interface CollectMeasurementsOptions {
  readonly config: AppConfig;
  readonly source: MeasurementSourceOption;
  readonly period?: MeasurementPeriod;
  readonly referenceTime?: Date;
}

export interface SyncMeasurementsOptions extends CollectMeasurementsOptions {
  readonly sheetsConfig?: GoogleSheetsAuthConfig;
}

export async function collectLatestMeasurementSet({
  config,
  source,
  period,
  referenceTime = new Date(),
}: CollectMeasurementsOptions): Promise<LatestMeasurementSet> {
  const readings = await readLatestMeasurementsForSource(
    config,
    source,
    referenceTime,
  );

  return buildLatestMeasurementSet({
    readings,
    period: period ?? determineMeasurementPeriod(referenceTime, config.timeZone),
    capturedAt: referenceTime.toISOString(),
  });
}

export async function syncMeasurements(
  options: SyncMeasurementsOptions,
): Promise<SpreadsheetRow> {
  const latestSet = await collectLatestMeasurementSet(options);
  const row = toSpreadsheetRow(latestSet, options.config.timeZone);

  await appendSpreadsheetRow(
    options.sheetsConfig ?? requireGoogleSheetsConfig(options.config),
    row,
  );

  return row;
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
  const latestByKind = new Map<MeasurementKind, MeasurementReading>();

  for (const reading of readings) {
    const current = latestByKind.get(reading.kind);
    if (
      !current ||
      Date.parse(reading.measuredAt) > Date.parse(current.measuredAt)
    ) {
      latestByKind.set(reading.kind, reading);
    }
  }

  const sources = new Set<Exclude<MeasurementSource, "mixed">>();
  const sourcesByKind: LatestMeasurementSet["sourcesByKind"] = {};

  for (const [kind, reading] of latestByKind) {
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
    ...numberField("weightKg", latestByKind.get("weight")),
    ...numberField(
      "bodyTemperatureCelsius",
      latestByKind.get("body_temperature"),
    ),
    ...numberField(
      "bloodPressureSystolicMmHg",
      latestByKind.get("blood_pressure_systolic"),
    ),
    ...numberField(
      "bloodPressureDiastolicMmHg",
      latestByKind.get("blood_pressure_diastolic"),
    ),
    ...numberField("pulseBpm", latestByKind.get("pulse")),
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
    return readGoogleFitLatestMeasurements(
      requireGoogleFitConfig(config),
      referenceTime,
    );
  }

  return readAppleHealthLatestMeasurements(requireAppleHealthConfig(config));
}

function numberField<Key extends keyof LatestMeasurementSet>(
  key: Key,
  reading: MeasurementReading | undefined,
): Partial<Pick<LatestMeasurementSet, Key>> {
  return reading ? ({ [key]: reading.value } as Pick<LatestMeasurementSet, Key>) : {};
}
