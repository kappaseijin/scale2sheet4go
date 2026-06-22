import { describe, expect, it } from "vitest";

import {
  latestByKind,
  measurementPeriodLabels,
  selectReadingsByWeightAnchor,
  selectWeightByPeriod,
} from "../../src/domain/measurement.js";
import type { MeasurementReading } from "../../src/domain/measurement.js";

describe("measurement domain contract", () => {
  it("maps normalized periods to spreadsheet labels", () => {
    expect(measurementPeriodLabels).toEqual({
      morning: "朝",
      evening: "夜",
    });
  });

  it("selects the latest reading for each measurement kind", () => {
    const readings: MeasurementReading[] = [
      {
        kind: "weight",
        value: 70.1,
        unit: "kg",
        measuredAt: "2026-06-18T07:00:00.000Z",
        source: "apple_health_export",
      },
      {
        kind: "weight",
        value: 70.3,
        unit: "kg",
        measuredAt: "2026-06-18T07:05:00.000Z",
        source: "apple_health_export",
      },
      {
        kind: "pulse",
        value: 64,
        unit: "bpm",
        measuredAt: "2026-06-18T07:03:00.000Z",
        source: "apple_health_export",
      },
    ];

    const latest = latestByKind(readings);

    expect(latest.get("weight")?.value).toBe(70.3);
    expect(latest.get("pulse")?.value).toBe(64);
  });

  it("selects weight by period", () => {
    const readings: MeasurementReading[] = [
      {
        kind: "weight",
        value: 70.1,
        unit: "kg",
        measuredAt: "2026-06-18T07:00:00.000Z",
        source: "apple_health_export",
      },
      {
        kind: "weight",
        value: 70.3,
        unit: "kg",
        measuredAt: "2026-06-18T07:05:00.000Z",
        source: "apple_health_export",
      },
      {
        kind: "pulse",
        value: 64,
        unit: "bpm",
        measuredAt: "2026-06-18T07:03:00.000Z",
        source: "apple_health_export",
      },
    ];

    expect(selectWeightByPeriod(readings, "morning")?.value).toBe(70.1);
    expect(selectWeightByPeriod(readings, "evening")?.value).toBe(70.3);
    expect(selectWeightByPeriod(readings.slice(2), "morning")).toBeUndefined();
  });

  it("selects readings around the weight anchor", () => {
    const readings: MeasurementReading[] = [
      {
        kind: "weight",
        value: 70.1,
        unit: "kg",
        measuredAt: "2026-06-18T07:00:00.000Z",
        source: "apple_health_export",
      },
      {
        kind: "weight",
        value: 70.3,
        unit: "kg",
        measuredAt: "2026-06-18T07:10:00.000Z",
        source: "apple_health_export",
      },
      {
        kind: "body_temperature",
        value: 36.4,
        unit: "celsius",
        measuredAt: "2026-06-18T06:55:00.000Z",
        source: "apple_health_export",
      },
      {
        kind: "body_temperature",
        value: 36.7,
        unit: "celsius",
        measuredAt: "2026-06-18T07:03:00.000Z",
        source: "apple_health_export",
      },
      {
        kind: "pulse",
        value: 64,
        unit: "bpm",
        measuredAt: "2026-06-18T07:11:00.000Z",
        source: "apple_health_export",
      },
    ];

    const morning = selectReadingsByWeightAnchor(readings, "morning");
    const evening = selectReadingsByWeightAnchor(readings, "evening");

    expect(morning.get("weight")?.value).toBe(70.1);
    expect(morning.get("body_temperature")?.value).toBe(36.7);
    expect(morning.get("pulse")?.value).toBe(64);
    expect(evening.get("weight")?.value).toBe(70.3);
    expect(evening.get("body_temperature")?.value).toBe(36.7);
    expect(evening.get("pulse")?.value).toBe(64);
    expect(selectReadingsByWeightAnchor(readings.slice(2), "morning").size).toBe(
      0,
    );
  });
});
