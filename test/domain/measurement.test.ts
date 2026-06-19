import { describe, expect, it } from "vitest";

import {
  latestByKind,
  measurementPeriodLabels,
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
});
