export const measurementKinds = [
  "weight",
  "body_temperature",
  "blood_pressure_systolic",
  "blood_pressure_diastolic",
  "pulse",
] as const;

export type MeasurementKind = (typeof measurementKinds)[number];

export const measurementUnits = ["kg", "celsius", "mmHg", "bpm"] as const;

export type MeasurementUnit = (typeof measurementUnits)[number];

export const measurementSources = [
  "google_fit",
  "apple_health_export",
  "mixed",
] as const;

/**
 * Exporter records the physical measurement device name. The historical
 * google_fit and apple_health_export values remain accepted API values.
 */
export type MeasurementSource = string;

export const measurementPeriods = ["morning", "evening"] as const;

export type MeasurementPeriod = (typeof measurementPeriods)[number];

export const measurementPeriodLabels = {
  morning: "朝",
  evening: "夜",
} as const satisfies Record<MeasurementPeriod, string>;

export interface MeasurementReading {
  readonly kind: MeasurementKind;
  readonly value: number;
  readonly unit: MeasurementUnit;
  readonly measuredAt: string;
  readonly source: string;
  readonly sourceRecordId?: string;
}

export interface LatestMeasurementSet {
  readonly period: MeasurementPeriod;
  readonly capturedAt: string;
  readonly source: MeasurementSource;
  readonly weightKg?: number;
  readonly bodyTemperatureCelsius?: number;
  readonly bloodPressureSystolicMmHg?: number;
  readonly bloodPressureDiastolicMmHg?: number;
  readonly pulseBpm?: number;
  readonly sourcesByKind: Partial<
    Record<MeasurementKind, string>
  >;
}

export interface SpreadsheetRow {
  readonly date: string;
  readonly time: string;
  readonly periodLabel: (typeof measurementPeriodLabels)[MeasurementPeriod];
  readonly weightKg: number | "";
  readonly bodyTemperatureCelsius: number | "";
  readonly bloodPressureSystolicMmHg: number | "";
  readonly bloodPressureDiastolicMmHg: number | "";
  readonly pulseBpm: number | "";
  readonly source: MeasurementSource;
}

export function latestByKind(
  readings: readonly MeasurementReading[],
): Map<MeasurementKind, MeasurementReading> {
  const latestMap = new Map<MeasurementKind, MeasurementReading>();

  for (const reading of readings) {
    const current = latestMap.get(reading.kind);
    if (
      !current ||
      Date.parse(reading.measuredAt) > Date.parse(current.measuredAt)
    ) {
      latestMap.set(reading.kind, reading);
    }
  }

  return latestMap;
}

export function selectWeightByPeriod(
  readings: readonly MeasurementReading[],
  period: MeasurementPeriod,
): MeasurementReading | undefined {
  let selected: MeasurementReading | undefined;

  for (const reading of readings) {
    if (reading.kind !== "weight") {
      continue;
    }

    if (
      !selected ||
      shouldReplaceWeight(reading, selected, period)
    ) {
      selected = reading;
    }
  }

  return selected;
}

export function selectReadingsByWeightAnchor(
  readings: readonly MeasurementReading[],
  period: MeasurementPeriod,
): Map<MeasurementKind, MeasurementReading> {
  const selectedWeight = selectWeightByPeriod(readings, period);
  const selectedReadings = new Map<MeasurementKind, MeasurementReading>();

  if (!selectedWeight) {
    return selectedReadings;
  }

  selectedReadings.set("weight", selectedWeight);

  for (const kind of measurementKinds) {
    if (kind === "weight") {
      continue;
    }

    const closest = selectClosestToReference(
      readings,
      kind,
      selectedWeight.measuredAt,
    );
    if (closest) {
      selectedReadings.set(kind, closest);
    }
  }

  return selectedReadings;
}

function selectClosestToReference(
  readings: readonly MeasurementReading[],
  kind: MeasurementKind,
  referenceTime: string,
): MeasurementReading | undefined {
  let selected: MeasurementReading | undefined;
  const referenceMs = Date.parse(referenceTime);

  for (const reading of readings) {
    if (reading.kind !== kind) {
      continue;
    }

    if (
      !selected ||
      Math.abs(Date.parse(reading.measuredAt) - referenceMs) <
        Math.abs(Date.parse(selected.measuredAt) - referenceMs)
    ) {
      selected = reading;
    }
  }

  return selected;
}

function shouldReplaceWeight(
  candidate: MeasurementReading,
  current: MeasurementReading,
  period: MeasurementPeriod,
): boolean {
  const candidateMs = Date.parse(candidate.measuredAt);
  const currentMs = Date.parse(current.measuredAt);

  return period === "morning"
    ? candidateMs < currentMs
    : candidateMs > currentMs;
}
