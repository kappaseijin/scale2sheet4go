import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import type { SheetsReadPort } from "../../src/installation/sheets-read.js";
import { findTodayRowNumber } from "../../src/installation/sheets-read.js";

class FakeSheetsReadPort implements SheetsReadPort {
  public readonly calls: string[] = [];

  constructor(
    private readonly headerRow: readonly unknown[],
    private readonly dateColumnValues: readonly (readonly unknown[])[],
    private readonly authError?: Error,
  ) {}

  async authenticate(): Promise<void> {
    this.calls.push("authenticate");
    if (this.authError) {
      throw this.authError;
    }
  }

  async readHeaderRow(): Promise<readonly unknown[]> {
    this.calls.push("readHeaderRow");
    return this.headerRow;
  }

  async findTodayRow(dateColumnIndex: number, today: DateTime): Promise<number | undefined> {
    this.calls.push(`findTodayRow:${dateColumnIndex}`);
    return findTodayRowNumber(this.dateColumnValues, today);
  }
}

describe("SheetsReadPort (design §モジュール境界: doctor-only, read-only)", () => {
  it("authenticates, reads the header row, then locates today's row, in that order", async () => {
    const today = DateTime.fromISO("2026-08-07", { zone: "Asia/Tokyo" });
    const port = new FakeSheetsReadPort(
      ["日付", "体重"],
      [["日付"], ["2026-08-06"], ["2026-08-07"]],
    );

    await port.authenticate();
    const header = await port.readHeaderRow();
    const row = await port.findTodayRow(0, today);

    expect(port.calls).toEqual(["authenticate", "readHeaderRow", "findTodayRow:0"]);
    expect(header).toEqual(["日付", "体重"]);
    expect(row).toBe(3);
  });

  it("propagates an authentication failure without reading anything (maps to AUTH_FAILED upstream)", async () => {
    const port = new FakeSheetsReadPort([], [], new Error("invalid_grant"));

    await expect(port.authenticate()).rejects.toThrow("invalid_grant");
  });

  it("returns undefined when no row matches today (maps to TODAY_ROW_MISSING upstream)", async () => {
    const today = DateTime.fromISO("2026-08-07", { zone: "Asia/Tokyo" });
    const port = new FakeSheetsReadPort(
      ["日付"],
      [["日付"], ["2026-08-05"], ["2026-08-06"]],
    );

    await expect(port.findTodayRow(0, today)).resolves.toBeUndefined();
  });

  it("N-1: SheetsReadPort has no write method (write access is impossible by type, not by convention)", () => {
    // This is the negative control for N-1 (plan §5): if a write method
    // (updateCell/appendRow/createSheet/...) is ever added to the interface,
    // this list must be updated by hand — which is the point. A silent
    // addition would make this assertion fail, forcing a reviewer to notice.
    const allowedMethods = ["authenticate", "readHeaderRow", "findTodayRow"];
    const port = new FakeSheetsReadPort([], []);

    const actualMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(port))
      .filter((name) => name !== "constructor");

    expect(actualMethods.sort()).toEqual(allowedMethods.sort());
    for (const name of actualMethods) {
      expect(name).not.toMatch(/update|append|create|write|delete|clear|insert|set[A-Z]/);
    }
  });
});

describe("findTodayRowNumber", () => {
  it("skips the header row and returns a 1-indexed row number for an exact yyyy-MM-dd match", () => {
    const today = DateTime.fromISO("2026-08-07", { zone: "Asia/Tokyo" });
    const values = [["日付"], ["2026-08-05"], ["2026-08-06"], ["2026-08-07"]];

    expect(findTodayRowNumber(values, today)).toBe(4);
  });

  it("returns undefined when today is not present", () => {
    const today = DateTime.fromISO("2026-08-07", { zone: "Asia/Tokyo" });
    const values = [["日付"], ["2026-08-05"], ["2026-08-06"]];

    expect(findTodayRowNumber(values, today)).toBeUndefined();
  });

  it("matches a bare month/day cell against today's year", () => {
    const today = DateTime.fromISO("2026-08-07", { zone: "Asia/Tokyo" });
    const values = [["日付"], ["8/7"]];

    expect(findTodayRowNumber(values, today)).toBe(2);
  });
});
