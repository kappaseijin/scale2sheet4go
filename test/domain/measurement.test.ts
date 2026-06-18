import { describe, expect, it } from "vitest";

import {
  measurementPeriodLabels,
  spreadsheetColumns,
} from "../../src/domain/measurement.js";

describe("measurement domain contract", () => {
  it("keeps the spreadsheet columns in the requested order", () => {
    expect(spreadsheetColumns).toEqual([
      "日付",
      "時刻",
      "区分(朝/夜)",
      "体重",
      "体温",
      "血圧上",
      "血圧下",
      "脈拍",
      "ソース",
    ]);
  });

  it("maps normalized periods to spreadsheet labels", () => {
    expect(measurementPeriodLabels).toEqual({
      morning: "朝",
      evening: "夜",
    });
  });
});
