import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import {
  buildMeasurementUpdateData,
  buildSheetColumnMapping,
  columnIndexToA1,
  findTodayRowNumber,
} from "../../src/sheets/index.js";
import type { LatestMeasurementSet } from "../../src/domain/index.js";

describe("sheet adapter helpers", () => {
  it("builds mappings from Japanese morning/evening headers", () => {
    const mapping = buildSheetColumnMapping([
      "月日",
      "朝体重",
      "朝体温",
      "朝血圧上",
      "朝血圧下",
      "朝脈拍",
      "夜体重",
      "夜体温",
      "夜血圧上",
      "夜血圧下",
      "夜脈拍",
    ]);

    expect(mapping.dateColumnIndex).toBe(0);
    expect(mapping.periods.morning).toMatchObject({
      weight: 1,
      temperature: 2,
      systolicBP: 3,
      diastolicBP: 4,
      heartRate: 5,
    });
    expect(mapping.periods.evening).toMatchObject({
      weight: 6,
      temperature: 7,
      systolicBP: 8,
      diastolicBP: 9,
      heartRate: 10,
    });
  });

  it("builds mappings from blood pressure headers with parentheses", () => {
    const mapping = buildSheetColumnMapping([
      "月日",
      "朝体重",
      "朝体温",
      "朝血圧(上)",
      "朝血圧(下)",
      "朝脈拍",
      "夜体重",
      "夜体温",
      "夜血圧(上)",
      "夜血圧(下)",
      "夜脈拍",
    ]);

    expect(mapping.periods.morning).toMatchObject({
      weight: 1,
      temperature: 2,
      systolicBP: 3,
      diastolicBP: 4,
      heartRate: 5,
    });
    expect(mapping.periods.evening).toMatchObject({
      weight: 6,
      temperature: 7,
      systolicBP: 8,
      diastolicBP: 9,
      heartRate: 10,
    });
  });

  it("finds today's row from supported date formats", () => {
    const targetDate = DateTime.fromISO("2026-06-18T07:00:00", {
      zone: "Asia/Tokyo",
    });

    expect(
      findTodayRowNumber([["月日"], ["2026-06-17"], ["6/18"]], targetDate),
    ).toBe(3);
    expect(
      findTodayRowNumber([["月日"], ["2026/06/18"]], targetDate),
    ).toBe(2);
    expect(findTodayRowNumber([["月日"], ["6月18日"]], targetDate)).toBe(2);
  });

  it("builds batchUpdate data for defined values only", () => {
    const latestSet: LatestMeasurementSet = {
      period: "evening",
      capturedAt: "2026-06-18T12:00:00.000Z",
      source: "apple_health_export",
      weightKg: 70.2,
      bloodPressureSystolicMmHg: 120,
      pulseBpm: 65,
      sourcesByKind: {},
    };
    const mapping = buildSheetColumnMapping([
      "月日",
      "朝体重",
      "夜体重",
      "夜体温",
      "夜血圧上",
      "夜血圧下",
      "夜脈拍",
    ]);

    expect(buildMeasurementUpdateData({
      sheetName: "体温・血圧",
      rowNumber: 12,
      latestSet,
      mapping,
    })).toEqual([
      { range: "'体温・血圧'!C12", values: [[70.2]] },
      { range: "'体温・血圧'!E12", values: [[120]] },
      { range: "'体温・血圧'!G12", values: [[65]] },
    ]);
  });

  it("converts zero-based column indexes to A1 letters", () => {
    expect(columnIndexToA1(0)).toBe("A");
    expect(columnIndexToA1(25)).toBe("Z");
    expect(columnIndexToA1(26)).toBe("AA");
  });
});
