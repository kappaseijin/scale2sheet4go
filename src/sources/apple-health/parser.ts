import { createReadStream } from "node:fs";

import { SaxesParser } from "saxes";
import type { SaxesTagPlain } from "saxes";

import type { AppleHealthConfig } from "../../config/index.js";
import type {
  MeasurementKind,
  MeasurementReading,
  MeasurementUnit,
} from "../../domain/index.js";

const appleHealthTypeToKind = {
  HKQuantityTypeIdentifierBodyMass: "weight",
  HKQuantityTypeIdentifierBodyTemperature: "body_temperature",
  HKQuantityTypeIdentifierBloodPressureSystolic: "blood_pressure_systolic",
  HKQuantityTypeIdentifierBloodPressureDiastolic: "blood_pressure_diastolic",
  HKQuantityTypeIdentifierHeartRate: "pulse",
} as const satisfies Record<string, MeasurementKind>;

type AppleHealthIdentifier = keyof typeof appleHealthTypeToKind;

export async function readAppleHealthLatestMeasurements(
  config: AppleHealthConfig,
): Promise<MeasurementReading[]> {
  return parseAppleHealthLatestMeasurements(config.exportXmlPath);
}

export async function parseAppleHealthLatestMeasurements(
  exportXmlPath: string,
): Promise<MeasurementReading[]> {
  const latestByKind = new Map<MeasurementKind, MeasurementReading>();
  const parser = new SaxesParser({ xmlns: false });

  parser.on("opentag", (tag: SaxesTagPlain) => {
    if (tag.name !== "Record") {
      return;
    }

    const reading = recordToReading(tag.attributes);
    if (!reading) {
      return;
    }

    const current = latestByKind.get(reading.kind);
    if (
      !current ||
      Date.parse(reading.measuredAt) > Date.parse(current.measuredAt)
    ) {
      latestByKind.set(reading.kind, reading);
    }
  });

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(exportXmlPath, { encoding: "utf8" });

    stream.on("data", (chunk) => parser.write(chunk));
    stream.on("error", reject);
    stream.on("end", () => {
      try {
        parser.close();
        resolve();
      } catch (error) {
        reject(error);
      }
    });
    parser.on("error", reject);
  });

  return [...latestByKind.values()];
}

function recordToReading(
  attributes: Record<string, string>,
): MeasurementReading | undefined {
  const type = attributes.type as AppleHealthIdentifier | undefined;
  if (!type || !(type in appleHealthTypeToKind)) {
    return undefined;
  }

  const rawValue = attributes.value;
  const rawUnit = attributes.unit;
  const measuredAt = normalizeAppleDate(attributes.endDate ?? attributes.startDate);

  if (!rawValue || !rawUnit || !measuredAt) {
    return undefined;
  }

  const value = Number.parseFloat(rawValue);
  if (!Number.isFinite(value)) {
    return undefined;
  }

  const kind = appleHealthTypeToKind[type];
  const converted = convertAppleHealthValue(kind, value, rawUnit);
  if (!converted) {
    return undefined;
  }

  return {
    kind,
    value: converted.value,
    unit: converted.unit,
    measuredAt,
    source: "apple_health_export",
    sourceRecordId: [
      attributes.sourceName,
      attributes.creationDate,
      type,
      attributes.endDate ?? attributes.startDate,
    ]
      .filter(Boolean)
      .join(":"),
  };
}

function normalizeAppleDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function convertAppleHealthValue(
  kind: MeasurementKind,
  value: number,
  unit: string,
): { readonly value: number; readonly unit: MeasurementUnit } | undefined {
  switch (kind) {
    case "weight":
      return convertWeight(value, unit);
    case "body_temperature":
      return convertTemperature(value, unit);
    case "blood_pressure_systolic":
    case "blood_pressure_diastolic":
      return unit === "mmHg" ? { value, unit: "mmHg" } : undefined;
    case "pulse":
      return unit === "count/min" || unit === "/min"
        ? { value, unit: "bpm" }
        : undefined;
  }
}

function convertWeight(
  value: number,
  unit: string,
): { readonly value: number; readonly unit: MeasurementUnit } | undefined {
  if (unit === "kg") {
    return { value, unit: "kg" };
  }

  if (unit === "g") {
    return { value: value / 1000, unit: "kg" };
  }

  if (unit === "lb" || unit === "lbs") {
    return { value: value * 0.45359237, unit: "kg" };
  }

  return undefined;
}

function convertTemperature(
  value: number,
  unit: string,
): { readonly value: number; readonly unit: MeasurementUnit } | undefined {
  if (["degC", "°C", "C"].includes(unit)) {
    return { value, unit: "celsius" };
  }

  if (["degF", "°F", "F"].includes(unit)) {
    return { value: ((value - 32) * 5) / 9, unit: "celsius" };
  }

  return undefined;
}
