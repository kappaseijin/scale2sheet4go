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

/**
 * F-2: counts are kept in both units and never collapsed into one (AC-57).
 * `windowedReadingCount` answers #54 (their published record count) and
 * `uniqueMeasurementCount` answers #38 and the Slice 7 gate (AC-59).
 */
/**
 * V-3 (design §7.1): the pipeline decides the transfer outcome from what the
 * sheet actually reports, not from "the call didn't throw". `written` means
 * the adapter got a success response; whether cells actually changed is a
 * separate question answered by `transferredCellCount`.
 */
export interface TransferOutcome {
  readonly state: "written" | "not-written" | "unknown";
  readonly transferredCellCount?: number;
}

export interface MeasurementCounts {
  /** Published records inside the window, after exact same-path deduplication. */
  readonly windowedReadingCount: number;
  /** Physical measurements, after cross-path identity merges them (D-5). */
  readonly uniqueMeasurementCount: number;
}

export interface LatestMeasurementSet {
  readonly period: MeasurementPeriod;
  readonly capturedAt: string;
  readonly source: MeasurementSource;
  readonly counts: MeasurementCounts;
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

/**
 * E-3: the transferred value is rounded to the resolution of its kind, so no
 * path priority has to be decided and `68.19999694824219` cannot reach the
 * spreadsheet (AC-60, AC-61). Resolutions are 0.1 kg, 0.1 celsius, 1 mmHg and
 * 1 bpm, expressed as decimal places to keep the rounding exact in binary.
 */
const measurementResolutionDigits = {
  weight: 1,
  body_temperature: 1,
  blood_pressure_systolic: 0,
  blood_pressure_diastolic: 0,
  pulse: 0,
} as const satisfies Record<MeasurementKind, number>;

export function roundToMeasurementResolution(
  value: number,
  kind: MeasurementKind,
): number {
  return Number(value.toFixed(measurementResolutionDigits[kind]));
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
