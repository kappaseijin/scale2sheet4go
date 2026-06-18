import { describe, expect, it } from "vitest";

import { measurementPeriodLabels } from "../../src/domain/measurement.js";

describe("measurement domain contract", () => {
  it("maps normalized periods to spreadsheet labels", () => {
    expect(measurementPeriodLabels).toEqual({
      morning: "朝",
      evening: "夜",
    });
  });
});
