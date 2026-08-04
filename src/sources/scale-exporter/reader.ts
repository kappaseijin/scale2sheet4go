import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { DateTime } from "luxon";
import { z } from "zod";

import type { ScaleExporterConfig } from "../../config/index.js";
import type {
  MeasurementKind,
  MeasurementReading,
  MeasurementUnit,
} from "../../domain/index.js";

const exporterKinds = [
  "weight",
  "bodyTemperature",
  "bloodPressureSystolic",
  "bloodPressureDiastolic",
  "heartRate",
] as const;

const exporterKindToDomainKind = {
  weight: "weight",
  bodyTemperature: "body_temperature",
  bloodPressureSystolic: "blood_pressure_systolic",
  bloodPressureDiastolic: "blood_pressure_diastolic",
  heartRate: "pulse",
} as const satisfies Record<(typeof exporterKinds)[number], MeasurementKind>;

const readingLineSchema = z.object({
  measuredAt: z.string().min(1),
  kind: z.enum(exporterKinds),
  value: z.number(),
  unit: z.enum(["kg", "celsius", "mmHg", "bpm"]),
  source: z.string().trim().min(1),
});

const fileNamePattern =
  /^scale_exporter_(\d{4}-\d{2}-\d{2})_(apple-health|google-fit)_(\d{3})\.jsonl$/;

export class ScaleExporterFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScaleExporterFileError";
  }
}

export async function readScaleExporterMeasurements(
  config: ScaleExporterConfig,
  referenceTime: Date,
  timeZone: string,
): Promise<MeasurementReading[]> {
  const targetDate = DateTime.fromJSDate(referenceTime, { zone: timeZone })
    .toFormat("yyyy-MM-dd");

  const fileNames = await listTargetFiles(config.outputDir, targetDate);
  const readings: MeasurementReading[] = [];
  const seen = new Set<string>();

  for (const fileName of fileNames) {
    const filePath = path.join(config.outputDir, fileName);
    const text = await readFile(filePath, "utf8");
    const lines = text.split("\n");

    for (const [index, line] of lines.entries()) {
      if (line.trim().length === 0) {
        continue;
      }

      const reading = parseReadingLine(line, fileName, index + 1);
      const dedupKey = [
        reading.measuredAt,
        reading.kind,
        reading.value,
        reading.source,
      ].join("|");
      if (seen.has(dedupKey)) {
        continue;
      }

      seen.add(dedupKey);
      readings.push(reading);
    }
  }

  return readings;
}

async function listTargetFiles(
  outputDir: string,
  targetDate: string,
): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(outputDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  return entries
    .filter((name) => {
      const match = fileNamePattern.exec(name);
      return match !== null && match[1] === targetDate;
    })
    .sort();
}

function parseReadingLine(
  line: string,
  fileName: string,
  lineNumber: number,
): MeasurementReading {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch {
    throw new ScaleExporterFileError(
      `invalid JSON in ${fileName}:${lineNumber}`,
    );
  }

  const parsed = readingLineSchema.safeParse(json);
  if (!parsed.success) {
    throw new ScaleExporterFileError(
      `invalid reading in ${fileName}:${lineNumber}: ${parsed.error.message}`,
    );
  }

  return {
    kind: exporterKindToDomainKind[parsed.data.kind],
    value: parsed.data.value,
    unit: parsed.data.unit as MeasurementUnit,
    measuredAt: parsed.data.measuredAt,
    source: parsed.data.source,
  };
}
