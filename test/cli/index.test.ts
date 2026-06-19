import { describe, expect, it } from "vitest";

import {
  parseDateOption,
  referenceTimeForDate,
} from "../../src/cli/index.js";

describe("CLI helpers", () => {
  it("accepts valid YYYY-MM-DD date options", () => {
    expect(parseDateOption("2026-06-18")).toBe("2026-06-18");
  });

  it("rejects invalid date options", () => {
    expect(() => parseDateOption("2026/06/18")).toThrow(
      "date must be YYYY-MM-DD",
    );
    expect(() => parseDateOption("2026-02-30")).toThrow(
      "date must be a valid YYYY-MM-DD date",
    );
  });

  it("uses the end of the specified date in the configured timezone", () => {
    expect(referenceTimeForDate("2026-06-18", "Asia/Tokyo").toISOString()).toBe(
      "2026-06-18T14:59:59.999Z",
    );
  });
});
