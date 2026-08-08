import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DateTime } from "luxon";
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
import { findTodayRowNumber } from "../../src/sheets/adapter.js";
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

  /**
   * Characterization tests for Issue #101: the sheet row a transfer targets
   * is NOT the execution day. `buildLatestMeasurementSet` overwrites the
   * passed-in `capturedAt` (execution time) with the selected weight
   * reading's own `measuredAt` whenever a weight is present (only the
   * no-weight case falls back to the passed-in value). These tests fix the
   * CURRENT behavior end-to-end (window filter -> buildLatestMeasurementSet
   * -> toSpreadsheetRow) without changing any implementation; whether this
   * is the intended behavior is undecided (Issue #101 AC not yet written).
   */
  describe("row-selection day (Issue #101 characterization, implementation unchanged)", () => {
    it("targets the sheet row for the weight's own measuredAt day, not the execution day", () => {
      const referenceTime = new Date("2026-06-18T00:00:00.000Z");
      const eveningReadings: MeasurementReading[] = [
        {
          kind: "weight",
          value: 70,
          unit: "kg",
          measuredAt: "2026-06-18T12:10:00.000Z", // 2026-06-18 21:10 JST — inside evening window (20:00-23:30)
          source: "apple_health_export",
        },
      ];

      const windowed = filterReadingsByPeriodWindow({
        readings: eveningReadings,
        period: "evening",
        referenceTime,
        timeZone: "Asia/Tokyo",
      });
      const latest = buildLatestMeasurementSet({
        readings: windowed,
        period: "evening",
        capturedAt: referenceTime.toISOString(),
      });
      const row = toSpreadsheetRow(latest, "Asia/Tokyo");

      expect(latest.capturedAt).toBe("2026-06-18T12:10:00.000Z");
      expect(row.date).toBe("2026-06-18");
    });

    it("moves the target row's date together with the weight's measuredAt day, using a referenceTime that moves in lockstep for each day", () => {
      // referenceTime is NOT held fixed here: the window filter requires
      // measuredAt and referenceTime to fall on the same local calendar day
      // (see the next test), so a fixture that actually held referenceTime
      // fixed while moving measuredAt to a different day would simply be
      // filtered out of the window rather than exercise row selection.
      // This test instead pins referenceTime to each day in turn, alongside
      // a same-day evening weight, and shows the resulting row date tracks
      // measuredAt's calendar day (not, e.g., a value computed once at
      // import time or carried over between calls).
      const dayOneReferenceTime = new Date("2026-06-18T00:00:00.000Z");
      const dayOneReadings: MeasurementReading[] = [
        {
          kind: "weight",
          value: 70,
          unit: "kg",
          measuredAt: "2026-06-18T12:10:00.000Z", // 2026-06-18 21:10 JST
          source: "apple_health_export",
        },
      ];
      const dayTwoReferenceTime = new Date("2026-06-19T00:00:00.000Z");
      const dayTwoReadings: MeasurementReading[] = [
        {
          kind: "weight",
          value: 70,
          unit: "kg",
          measuredAt: "2026-06-19T12:10:00.000Z", // 2026-06-19 21:10 JST
          source: "apple_health_export",
        },
      ];

      for (const { referenceTime, readings, expectedDate } of [
        { referenceTime: dayOneReferenceTime, readings: dayOneReadings, expectedDate: "2026-06-18" },
        { referenceTime: dayTwoReferenceTime, readings: dayTwoReadings, expectedDate: "2026-06-19" },
      ]) {
        const windowed = filterReadingsByPeriodWindow({
          readings,
          period: "evening",
          referenceTime,
          timeZone: "Asia/Tokyo",
        });
        const latest = buildLatestMeasurementSet({
          readings: windowed,
          period: "evening",
          capturedAt: referenceTime.toISOString(),
        });
        const row = toSpreadsheetRow(latest, "Asia/Tokyo");
        expect(row.date).toBe(expectedDate);
      }
    });

    it("falls back to the execution day only when no weight reading is present", () => {
      const referenceTime = new Date("2026-06-18T00:00:00.000Z");
      const pulseOnly: MeasurementReading[] = [
        {
          kind: "pulse",
          value: 62,
          unit: "bpm",
          measuredAt: "2026-06-18T12:10:00.000Z",
          source: "apple_health_export",
        },
      ];

      const windowed = filterReadingsByPeriodWindow({
        readings: pulseOnly,
        period: "evening",
        referenceTime,
        timeZone: "Asia/Tokyo",
      });
      const latest = buildLatestMeasurementSet({
        readings: windowed,
        period: "evening",
        capturedAt: referenceTime.toISOString(),
      });
      const row = toSpreadsheetRow(latest, "Asia/Tokyo");

      expect(latest.weightKg).toBeUndefined();
      expect(latest.capturedAt).toBe(referenceTime.toISOString());
      expect(row.date).toBe("2026-06-18");
    });

    it("does not let a reading whose measuredAt is on a different local calendar day than referenceTime cross into the window", () => {
      // referenceTime is 2026-06-18 (JST); the reading is measured at
      // 2026-06-19 21:00 JST — a different local day, but its clock time
      // (21:00) falls squarely inside the evening window's hour range
      // (20:00-23:30). This isolates the day check: a fixture whose clock
      // time also failed the hour check would pass even with the day check
      // removed, and would prove nothing about the day check specifically
      // (confirmed by first writing this test with such a fixture, which
      // stayed green after deleting the day check — see mutation notes in
      // the commit).
      const referenceTime = new Date("2026-06-18T00:00:00.000Z");
      const nextDayReadings: MeasurementReading[] = [
        {
          kind: "weight",
          value: 70,
          unit: "kg",
          measuredAt: "2026-06-19T12:00:00.000Z", // 2026-06-19 21:00 JST
          source: "apple_health_export",
        },
      ];

      const windowed = filterReadingsByPeriodWindow({
        readings: nextDayReadings,
        period: "evening",
        referenceTime,
        timeZone: "Asia/Tokyo",
      });

      expect(windowed).toEqual([]);
    });

    it("classifies a reading by its local (JST) calendar day, not its UTC calendar day, at the JST/UTC day-boundary crossing", () => {
      // 2026-06-17 21:00 UTC == 2026-06-18 06:00 JST: the UTC calendar day
      // (06-17) and the JST calendar day (06-18) disagree. referenceTime is
      // JST 06-18, and the reading is a morning-window (05:00-12:00 JST)
      // measurement on that same JST day. If any of the three date
      // computations (window filter, buildLatestMeasurementSet's
      // capturedAt passthrough, toSpreadsheetRow) used the UTC calendar day
      // instead of JST, this reading would either be excluded from the
      // window or land on the wrong sheet row.
      const referenceTime = new Date("2026-06-18T00:00:00.000Z"); // 2026-06-18 09:00 JST
      const crossingReadings: MeasurementReading[] = [
        {
          kind: "weight",
          value: 70,
          unit: "kg",
          measuredAt: "2026-06-17T21:00:00.000Z", // 2026-06-18 06:00 JST
          source: "apple_health_export",
        },
      ];

      const windowed = filterReadingsByPeriodWindow({
        readings: crossingReadings,
        period: "morning",
        referenceTime,
        timeZone: "Asia/Tokyo",
      });
      expect(windowed).toHaveLength(1);

      const latest = buildLatestMeasurementSet({
        readings: windowed,
        period: "morning",
        capturedAt: referenceTime.toISOString(),
      });
      const row = toSpreadsheetRow(latest, "Asia/Tokyo");

      expect(row.date).toBe("2026-06-18");
    });

    it("row-selection date agrees with findTodayRowNumber's own date matching for the same capturedAt (adapter/service consistency)", () => {
      const referenceTime = new Date("2026-06-18T00:00:00.000Z");
      const readings: MeasurementReading[] = [
        {
          kind: "weight",
          value: 70,
          unit: "kg",
          measuredAt: "2026-06-17T21:00:00.000Z", // 2026-06-18 06:00 JST
          source: "apple_health_export",
        },
      ];

      const windowed = filterReadingsByPeriodWindow({
        readings,
        period: "morning",
        referenceTime,
        timeZone: "Asia/Tokyo",
      });
      const latest = buildLatestMeasurementSet({
        readings: windowed,
        period: "morning",
        capturedAt: referenceTime.toISOString(),
      });

      // sheets/adapter.ts's own targetDate derivation, reproduced here
      // (read-only characterization; does not import a network-capable
      // adapter): DateTime.fromISO(latestSet.capturedAt, {zone:"utc"}).setZone(timeZone)
      const dateColumn = [
        ["日付"],
        ["2026-06-17"],
        ["2026-06-18"],
        ["2026-06-19"],
      ];
      const targetDate = DateTime.fromISO(latest.capturedAt, { zone: "utc" }).setZone("Asia/Tokyo");
      const rowNumber = findTodayRowNumber(dateColumn, targetDate);

      expect(rowNumber).toBe(3); // "2026-06-18" is index 2 (0-indexed), so row 3 (1-indexed, header skipped)
      expect(toSpreadsheetRow(latest, "Asia/Tokyo").date).toBe("2026-06-18");
    });

    it("keeps a weight measured at the 23:30 evening execution in that same day's window", () => {
      // 23:30 JST is scale2sheet's own late evening execution time and the
      // evening window's closing edge (20:00-23:30 JST). This pins the
      // pre-midnight side of the day-crossing boundary directly, rather
      // than an arbitrary in-window time like 21:00.
      const referenceTime = new Date("2026-06-18T14:30:00.000Z"); // 2026-06-18 23:30 JST
      const readings: MeasurementReading[] = [
        {
          kind: "weight",
          value: 70,
          unit: "kg",
          measuredAt: "2026-06-18T14:30:00.000Z", // 2026-06-18 23:30 JST
          source: "apple_health_export",
        },
      ];

      const windowed = filterReadingsByPeriodWindow({
        readings,
        period: "evening",
        referenceTime,
        timeZone: "Asia/Tokyo",
      });
      expect(windowed).toHaveLength(1);

      const latest = buildLatestMeasurementSet({
        readings: windowed,
        period: "evening",
        capturedAt: referenceTime.toISOString(),
      });
      expect(toSpreadsheetRow(latest, "Asia/Tokyo").date).toBe("2026-06-18");
    });

    it("excludes a 23:30 weight from the next day's 00:40 execution, on the day check alone, not the time-of-day check", () => {
      // 00:40 JST is scale_exporter's own real execution time just after
      // midnight, ~70 minutes after our 23:30 evening execution. The
      // reading's own clock time (23:30) is deliberately kept INSIDE the
      // evening window's range (20:00-23:30 JST): only its calendar day
      // (06-18) differs from referenceTime's (06-19). This isolates the day
      // check specifically — a reading whose clock time is also out of
      // range (e.g. 00:40 itself) would be excluded by the time-of-day
      // check regardless of the day check, and a mutation that deleted the
      // day check would go undetected (confirmed: the first version of this
      // test used such a fixture and stayed green after that mutation).
      const referenceTime = new Date("2026-06-18T15:40:00.000Z"); // 2026-06-19 00:40 JST
      const readings: MeasurementReading[] = [
        {
          kind: "weight",
          value: 70,
          unit: "kg",
          measuredAt: "2026-06-18T14:30:00.000Z", // 2026-06-18 23:30 JST (in-range clock time, prior day)
          source: "apple_health_export",
        },
      ];

      const windowed = filterReadingsByPeriodWindow({
        readings,
        period: "evening",
        referenceTime,
        timeZone: "Asia/Tokyo",
      });
      expect(windowed).toEqual([]);
    });
  });
});
