import { describe, expect, it } from "vitest";

import {
  buildLatestMeasurementSet,
  determineMeasurementPeriod,
  filterReadingsByPeriodWindow,
  toSpreadsheetRow,
} from "../../src/service/index.js";
import type { MeasurementReading } from "../../src/domain/index.js";

describe("measurement service", () => {
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

    expect(latest.weightKg).toBe(70.2);
    expect(latest.pulseBpm).toBe(62);
    expect(latest.source).toBe("apple_health_export");
    expect(row).toMatchObject({
      date: "2026-06-18",
      time: "07:10",
      periodLabel: "朝",
      weightKg: 70.2,
      pulseBpm: 62,
      source: "apple_health_export",
    });
  });
});
