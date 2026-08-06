import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildLatestMeasurementSet,
  collectLatestMeasurementSet,
  countMeasurements,
  determineMeasurementPeriod,
  deduplicateCrossSourceReadings,
  filterReadingsByPeriodWindow,
  syncMeasurements,
  toSpreadsheetRow,
} from "../../src/service/index.js";
import type { MeasurementReading } from "../../src/domain/index.js";
import type { AppConfig } from "../../src/config/index.js";

const tempDirs: string[] = [];

describe("measurement service", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true })));
  });

  it("deduplicates approximate readings only across source paths", () => {
    const apple = { kind: "weight", value: 68.2, unit: "kg", measuredAt: "2026-08-05T01:00:00.000Z", source: "apple_health" } as const;
    const google = { ...apple, value: 68.19999694824219, source: "google_fit" as const };
    expect(deduplicateCrossSourceReadings([apple, google])).toEqual([apple]);
    expect(deduplicateCrossSourceReadings([apple, { ...apple, value: 68.200001 }])).toHaveLength(2);
    expect(deduplicateCrossSourceReadings([apple, { ...google, value: 68.21 }])).toHaveLength(2);
  });

  it("keeps both count units apart on the run path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scale2sheet-run-identity-"));
    tempDirs.push(dir);
    const measuredAt = "2026-08-03T06:30:00+09:00";
    await writeFile(
      join(dir, "scale_exporter_2026-08-03_apple-health_001.jsonl"),
      `${JSON.stringify({ measuredAt, kind: "weight", value: 68.8, unit: "kg", source: "Xiaomi Home" })}\n`,
      "utf8",
    );
    await writeFile(
      join(dir, "scale_exporter_2026-08-03_google-fit_001.jsonl"),
      `${JSON.stringify({ measuredAt, kind: "weight", value: 68.80000305175781, unit: "kg", source: "google_fit" })}\n`,
      "utf8",
    );

    const config: AppConfig = {
      timeZone: "Asia/Tokyo",
      scaleExporter: { outputDir: dir },
      scheduler: { morningCron: "0 7 * * *", eveningCron: "0 21 * * *" },
    };

    const latest = await collectLatestMeasurementSet({
      config,
      source: "scale-exporter",
      period: "morning",
      referenceTime: new Date("2026-08-03T00:00:00.000Z"),
    });

    expect(latest.counts).toEqual({
      windowedReadingCount: 2,
      uniqueMeasurementCount: 1,
    });
  });

  it("rounds transferred values to the resolution of each kind", () => {
    const latest = buildLatestMeasurementSet({
      readings: [
        { kind: "weight", value: 68.19999694824219, unit: "kg", measuredAt: "2026-08-03T06:30:00+09:00", source: "google_fit" },
        { kind: "body_temperature", value: 36.749999046325684, unit: "celsius", measuredAt: "2026-08-03T06:30:00+09:00", source: "google_fit" },
        { kind: "blood_pressure_systolic", value: 118.4, unit: "mmHg", measuredAt: "2026-08-03T06:30:00+09:00", source: "google_fit" },
        { kind: "blood_pressure_diastolic", value: 77.6, unit: "mmHg", measuredAt: "2026-08-03T06:30:00+09:00", source: "google_fit" },
        { kind: "pulse", value: 61.5, unit: "bpm", measuredAt: "2026-08-03T06:30:00+09:00", source: "google_fit" },
      ],
      period: "morning",
      capturedAt: "2026-08-03T06:40:00+09:00",
    });

    expect(latest.weightKg).toBe(68.2);
    expect(latest.bodyTemperatureCelsius).toBe(36.7);
    expect(latest.bloodPressureSystolicMmHg).toBe(118);
    expect(latest.bloodPressureDiastolicMmHg).toBe(78);
    expect(latest.pulseBpm).toBe(62);
  });

  it("transfers the same value whichever path is read first", async () => {
    const measuredAt = "2026-08-03T06:30:00+09:00";
    const appleLine = `${JSON.stringify({ measuredAt, kind: "weight", value: 68.8, unit: "kg", source: "Xiaomi Home" })}\n`;
    const googleLine = `${JSON.stringify({ measuredAt, kind: "weight", value: 68.80000305175781, unit: "kg", source: "google_fit" })}\n`;

    const transferredWeight = async (firstLine: string, secondLine: string): Promise<number | undefined> => {
      const dir = await mkdtemp(join(tmpdir(), "scale2sheet-read-order-"));
      tempDirs.push(dir);
      await writeFile(join(dir, "scale_exporter_2026-08-03_apple-health_001.jsonl"), firstLine, "utf8");
      await writeFile(join(dir, "scale_exporter_2026-08-03_google-fit_001.jsonl"), secondLine, "utf8");
      const latest = await collectLatestMeasurementSet({
        config: {
          timeZone: "Asia/Tokyo",
          scaleExporter: { outputDir: dir },
          scheduler: { morningCron: "0 7 * * *", eveningCron: "0 21 * * *" },
        },
        source: "scale-exporter",
        period: "morning",
        referenceTime: new Date("2026-08-03T00:00:00.000Z"),
      });
      return toSpreadsheetRow(latest, "Asia/Tokyo").weightKg as number | undefined;
    };

    expect(await transferredWeight(appleLine, googleLine)).toBe(68.8);
    expect(await transferredWeight(googleLine, appleLine)).toBe(68.8);
  });

  it("counts published records and physical measurements separately", () => {
    const apple = { kind: "weight", value: 68.8, unit: "kg", measuredAt: "2026-08-03T06:30:00+09:00", source: "Xiaomi Home" } as const;
    const google = { ...apple, value: 68.80000305175781, source: "google_fit" as const };

    expect(countMeasurements([apple, google])).toEqual({
      windowedReadingCount: 2,
      uniqueMeasurementCount: 1,
    });
    expect(countMeasurements([apple, apple, google])).toEqual({
      windowedReadingCount: 2,
      uniqueMeasurementCount: 1,
    });
    expect(countMeasurements([apple, { ...google, value: 68.9 }])).toEqual({
      windowedReadingCount: 2,
      uniqueMeasurementCount: 2,
    });
  });

  it("determines morning and evening in the configured timezone", () => {
    expect(
      determineMeasurementPeriod(new Date("2026-06-17T23:00:00.000Z"), "Asia/Tokyo"),
    ).toBe("morning");
    expect(
      determineMeasurementPeriod(new Date("2026-06-18T12:00:00.000Z"), "Asia/Tokyo"),
    ).toBe("evening");
  });

  it("filters readings to the target date and period window", () => {
    const readings: MeasurementReading[] = [
      {
        kind: "weight",
        value: 69.9,
        unit: "kg",
        measuredAt: "2026-06-17T19:59:00.000Z",
        source: "apple_health_export",
      },
      {
        kind: "weight",
        value: 70.1,
        unit: "kg",
        measuredAt: "2026-06-17T20:00:00.000Z",
        source: "apple_health_export",
      },
      {
        kind: "pulse",
        value: 61,
        unit: "bpm",
        measuredAt: "2026-06-18T03:01:00.000Z",
        source: "apple_health_export",
      },
      {
        kind: "body_temperature",
        value: 36.5,
        unit: "celsius",
        measuredAt: "2026-06-16T22:30:00.000Z",
        source: "apple_health_export",
      },
    ];

    const filtered = filterReadingsByPeriodWindow({
      readings,
      period: "morning",
      referenceTime: new Date("2026-06-17T23:30:00.000Z"),
      timeZone: "Asia/Tokyo",
    });

    expect(filtered.map((reading) => reading.value)).toEqual([70.1]);
  });

  it("builds latest sets and spreadsheet rows", () => {
    const readings: MeasurementReading[] = [
      {
        kind: "weight",
        value: 70,
        unit: "kg",
        measuredAt: "2026-06-17T21:50:00.000Z",
        source: "apple_health_export",
      },
      {
        kind: "weight",
        value: 70.2,
        unit: "kg",
        measuredAt: "2026-06-17T22:00:00.000Z",
        source: "apple_health_export",
      },
      {
        kind: "pulse",
        value: 62,
        unit: "bpm",
        measuredAt: "2026-06-17T22:01:00.000Z",
        source: "apple_health_export",
      },
    ];

    const latest = buildLatestMeasurementSet({
      readings,
      period: "morning",
      capturedAt: "2026-06-17T22:10:00.000Z",
    });
    const row = toSpreadsheetRow(latest, "Asia/Tokyo");

    expect(latest.weightKg).toBe(70);
    expect(latest.pulseBpm).toBe(62);
    expect(latest.source).toBe("apple_health_export");
    expect(row).toMatchObject({
      date: "2026-06-18",
      time: "06:50",
      periodLabel: "朝",
      weightKg: 70,
      pulseBpm: 62,
      source: "apple_health_export",
    });
  });

  it("selects the latest evening weight", () => {
    const readings: MeasurementReading[] = [
      {
        kind: "weight",
        value: 71.1,
        unit: "kg",
        measuredAt: "2026-06-18T11:50:00.000Z",
        source: "apple_health_export",
      },
      {
        kind: "weight",
        value: 71.3,
        unit: "kg",
        measuredAt: "2026-06-18T12:10:00.000Z",
        source: "apple_health_export",
      },
      {
        kind: "body_temperature",
        value: 36.8,
        unit: "celsius",
        measuredAt: "2026-06-18T12:07:00.000Z",
        source: "apple_health_export",
      },
    ];

    const latest = buildLatestMeasurementSet({
      readings,
      period: "evening",
      capturedAt: "2026-06-18T12:30:00.000Z",
    });

    expect(latest.weightKg).toBe(71.3);
    expect(latest.bodyTemperatureCelsius).toBe(36.8);
    expect(latest.capturedAt).toBe("2026-06-18T12:10:00.000Z");
  });

  it("leaves measurement values empty when no weight is available", () => {
    const latest = buildLatestMeasurementSet({
      readings: [
        {
          kind: "pulse",
          value: 62,
          unit: "bpm",
          measuredAt: "2026-06-17T22:01:00.000Z",
          source: "apple_health_export",
        },
      ],
      period: "morning",
      capturedAt: "2026-06-17T22:10:00.000Z",
    });

    expect(latest.weightKg).toBeUndefined();
    expect(latest.pulseBpm).toBeUndefined();
    expect(latest.capturedAt).toBe("2026-06-17T22:10:00.000Z");
  });

  it("selects other measurements closest to the weight timestamp", () => {
    const latest = buildLatestMeasurementSet({
      readings: [
        {
          kind: "weight",
          value: 70.1,
          unit: "kg",
          measuredAt: "2026-06-17T22:00:00.000Z",
          source: "apple_health_export",
        },
        {
          kind: "body_temperature",
          value: 36.4,
          unit: "celsius",
          measuredAt: "2026-06-17T21:40:00.000Z",
          source: "apple_health_export",
        },
        {
          kind: "body_temperature",
          value: 36.7,
          unit: "celsius",
          measuredAt: "2026-06-17T22:04:00.000Z",
          source: "apple_health_export",
        },
        {
          kind: "pulse",
          value: 61,
          unit: "bpm",
          measuredAt: "2026-06-17T21:58:00.000Z",
          source: "apple_health_export",
        },
        {
          kind: "pulse",
          value: 66,
          unit: "bpm",
          measuredAt: "2026-06-17T22:40:00.000Z",
          source: "apple_health_export",
        },
      ],
      period: "morning",
      capturedAt: "2026-06-17T22:10:00.000Z",
    });

    expect(latest.bodyTemperatureCelsius).toBe(36.7);
    expect(latest.pulseBpm).toBe(61);
  });

  it("applies specified date and period windows to Apple Health readings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scale2sheet-apple-health-"));
    tempDirs.push(dir);
    const exportPath = join(dir, "export.xml");

    await writeFile(
      exportPath,
      `<?xml version="1.0" encoding="UTF-8"?>
<HealthData>
  <Record type="HKQuantityTypeIdentifierBodyMass" sourceName="Scale" unit="kg" value="69.9" startDate="2026-06-17 07:00:00 +0900" endDate="2026-06-17 07:00:00 +0900" creationDate="2026-06-17 07:00:01 +0900"/>
  <Record type="HKQuantityTypeIdentifierBodyMass" sourceName="Scale" unit="kg" value="70.1" startDate="2026-06-18 07:00:00 +0900" endDate="2026-06-18 07:00:00 +0900" creationDate="2026-06-18 07:00:01 +0900"/>
  <Record type="HKQuantityTypeIdentifierBodyMass" sourceName="Scale" unit="kg" value="71.2" startDate="2026-06-18 21:00:00 +0900" endDate="2026-06-18 21:00:00 +0900" creationDate="2026-06-18 21:00:01 +0900"/>
  <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Watch" unit="count/min" value="62" startDate="2026-06-18 07:01:00 +0900" endDate="2026-06-18 07:01:00 +0900" creationDate="2026-06-18 07:01:01 +0900"/>
  <Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Watch" unit="count/min" value="82" startDate="2026-06-18 21:01:00 +0900" endDate="2026-06-18 21:01:00 +0900" creationDate="2026-06-18 21:01:01 +0900"/>
</HealthData>
`,
      "utf8",
    );

    const config: AppConfig = {
      timeZone: "Asia/Tokyo",
      appleHealth: {
        exportXmlPath: exportPath,
      },
      scaleExporter: {
        outputDir: dir,
      },
      scheduler: {
        morningCron: "0 7 * * *",
        eveningCron: "0 21 * * *",
      },
    };

    const morning = await collectLatestMeasurementSet({
      config,
      source: "apple-health",
      period: "morning",
      referenceTime: new Date("2026-06-18T14:59:59.999Z"),
    });
    const evening = await collectLatestMeasurementSet({
      config,
      source: "apple-health",
      period: "evening",
      referenceTime: new Date("2026-06-18T14:59:59.999Z"),
    });

    expect(morning.weightKg).toBe(70.1);
    expect(morning.pulseBpm).toBe(62);
    expect(evening.weightKg).toBe(71.2);
    expect(evening.pulseBpm).toBe(82);
  });

  it("does not sync when the period has no weight reading", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scale2sheet-apple-health-"));
    tempDirs.push(dir);
    const exportPath = join(dir, "export.xml");
    const logMessages: string[] = [];

    await writeFile(
      exportPath,
      `<?xml version="1.0" encoding="UTF-8"?>
<HealthData>
  <Record type="HKQuantityTypeIdentifierBodyTemperature" sourceName="Thermometer" unit="degC" value="36.5" startDate="2026-06-18 07:00:00 +0900" endDate="2026-06-18 07:00:00 +0900" creationDate="2026-06-18 07:00:01 +0900"/>
</HealthData>
`,
      "utf8",
    );

    const config: AppConfig = {
      timeZone: "Asia/Tokyo",
      appleHealth: {
        exportXmlPath: exportPath,
      },
      scaleExporter: {
        outputDir: dir,
      },
      scheduler: {
        morningCron: "0 7 * * *",
        eveningCron: "0 21 * * *",
      },
    };

    const row = await syncMeasurements({
      config,
      source: "apple-health",
      period: "morning",
      referenceTime: new Date("2026-06-17T23:30:00.000Z"),
      logger: {
        log: (message) => logMessages.push(message),
        error: (message) => logMessages.push(message),
      },
    });

    expect(row).toBeUndefined();
    expect(logMessages[0]).toContain("No morning weight measurement");
  });
});
