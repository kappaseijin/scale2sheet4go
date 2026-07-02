import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  readScaleExporterMeasurements,
  ScaleExporterFileError,
} from "../../src/sources/scale-exporter/index.js";

const timeZone = "Asia/Tokyo";
// 2026-06-18 の日中（Asia/Tokyo）を指す referenceTime
const referenceTime = new Date("2026-06-18T12:00:00+09:00");

describe("readScaleExporterMeasurements", () => {
  let outputDir: string;

  beforeEach(async () => {
    outputDir = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-reader-"));
  });

  afterEach(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  it("reads split sequence files for both exporter sources and maps fields", async () => {
    await writeFile(
      path.join(outputDir, "scale_exporter_2026-06-18_apple-health_001.jsonl"),
      [
        line("2026-06-18T06:50:00+09:00", "weight", 68.6, "kg", "apple_health"),
        line("2026-06-18T06:51:00+09:00", "bodyTemperature", 36.4, "celsius", "apple_health"),
      ].join("\n") + "\n",
    );
    await writeFile(
      path.join(outputDir, "scale_exporter_2026-06-18_google-fit_001.jsonl"),
      [
        line("2026-06-18T06:52:00+09:00", "bloodPressureSystolic", 118, "mmHg", "google_fit"),
        line("2026-06-18T06:52:00+09:00", "bloodPressureDiastolic", 76, "mmHg", "google_fit"),
      ].join("\n") + "\n",
    );
    await writeFile(
      path.join(outputDir, "scale_exporter_2026-06-18_google-fit_002.jsonl"),
      line("2026-06-18T06:53:00+09:00", "heartRate", 62, "bpm", "google_fit") + "\n",
    );

    const readings = await readScaleExporterMeasurements(
      { outputDir },
      referenceTime,
      timeZone,
    );

    expect(readings).toHaveLength(5);
    expect(readings.map((reading) => reading.kind).sort()).toEqual([
      "blood_pressure_diastolic",
      "blood_pressure_systolic",
      "body_temperature",
      "pulse",
      "weight",
    ]);
    const weight = readings.find((reading) => reading.kind === "weight");
    expect(weight?.source).toBe("apple_health_export");
    const pulse = readings.find((reading) => reading.kind === "pulse");
    expect(pulse?.source).toBe("google_fit");
  });

  it("ignores files for other dates", async () => {
    await writeFile(
      path.join(outputDir, "scale_exporter_2026-06-17_apple-health_001.jsonl"),
      line("2026-06-17T06:50:00+09:00", "weight", 68.0, "kg", "apple_health") + "\n",
    );

    const readings = await readScaleExporterMeasurements(
      { outputDir },
      referenceTime,
      timeZone,
    );

    expect(readings).toHaveLength(0);
  });

  it("deduplicates identical readings across file boundaries", async () => {
    const duplicated = line(
      "2026-06-18T06:50:00+09:00",
      "weight",
      68.6,
      "kg",
      "google_fit",
    );
    await writeFile(
      path.join(outputDir, "scale_exporter_2026-06-18_google-fit_001.jsonl"),
      duplicated + "\n",
    );
    await writeFile(
      path.join(outputDir, "scale_exporter_2026-06-18_google-fit_002.jsonl"),
      duplicated + "\n" +
        line("2026-06-18T06:55:00+09:00", "weight", 68.4, "kg", "google_fit") + "\n",
    );

    const readings = await readScaleExporterMeasurements(
      { outputDir },
      referenceTime,
      timeZone,
    );

    expect(readings).toHaveLength(2);
  });

  it("returns empty array when the output directory does not exist", async () => {
    const readings = await readScaleExporterMeasurements(
      { outputDir: path.join(outputDir, "missing") },
      referenceTime,
      timeZone,
    );

    expect(readings).toHaveLength(0);
  });

  it("throws with file and line context for invalid JSON", async () => {
    const fileName = "scale_exporter_2026-06-18_apple-health_001.jsonl";
    await writeFile(path.join(outputDir, fileName), "not json\n");

    await expect(
      readScaleExporterMeasurements({ outputDir }, referenceTime, timeZone),
    ).rejects.toThrow(ScaleExporterFileError);
    await expect(
      readScaleExporterMeasurements({ outputDir }, referenceTime, timeZone),
    ).rejects.toThrow(`${fileName}:1`);
  });

  it("throws for schema-invalid readings", async () => {
    await writeFile(
      path.join(outputDir, "scale_exporter_2026-06-18_apple-health_001.jsonl"),
      '{"measuredAt":"2026-06-18T06:50:00+09:00","kind":"steps","value":100,"unit":"kg","source":"apple_health"}\n',
    );

    await expect(
      readScaleExporterMeasurements({ outputDir }, referenceTime, timeZone),
    ).rejects.toThrow(ScaleExporterFileError);
  });

  it("ignores subdirectories and unrelated files", async () => {
    await mkdir(path.join(outputDir, "scale_exporter_2026-06-18_apple-health_002.jsonl.d"));
    await writeFile(path.join(outputDir, "notes.txt"), "unrelated\n");
    await writeFile(
      path.join(outputDir, "scale_exporter_2026-06-18_apple-health_001.jsonl"),
      line("2026-06-18T06:50:00+09:00", "weight", 68.6, "kg", "apple_health") + "\n",
    );

    const readings = await readScaleExporterMeasurements(
      { outputDir },
      referenceTime,
      timeZone,
    );

    expect(readings).toHaveLength(1);
  });
});

function line(
  measuredAt: string,
  kind: string,
  value: number,
  unit: string,
  source: string,
): string {
  return JSON.stringify({ measuredAt, kind, value, unit, source });
}
