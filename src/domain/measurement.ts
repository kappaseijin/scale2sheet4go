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

export type MeasurementSource = (typeof measurementSources)[number];

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
  readonly source: Exclude<MeasurementSource, "mixed">;
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
    Record<MeasurementKind, Exclude<MeasurementSource, "mixed">>
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
