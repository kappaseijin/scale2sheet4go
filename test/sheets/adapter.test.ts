import { DateTime } from "luxon";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  googleSheets: vi.fn(),
  GoogleAuth: vi.fn(),
}));

vi.mock("googleapis", () => ({
  google: {
    sheets: mocks.googleSheets,
    auth: { GoogleAuth: mocks.GoogleAuth },
  },
}));

import {
  buildMeasurementUpdateData,
  buildSheetColumnMapping,
  columnIndexToA1,
  findTodayRowNumber,
  updateSpreadsheetMeasurements,
} from "../../src/sheets/index.js";
import type { LatestMeasurementSet } from "../../src/domain/index.js";

const deadlineMilliseconds = 30_000;
const config = {
  applicationCredentialsPath: "/tmp/credentials.json",
  spreadsheetId: "test-spreadsheet",
  sheetName: "測定値",
};
const latestSet: LatestMeasurementSet = {
  period: "morning",
  capturedAt: "2026-08-11T00:00:00.000Z",
  source: "scale_exporter",
  weightKg: 70.2,
  sourcesByKind: {},
};

type OperationOutcome =
  | { readonly kind: "resolved"; readonly value: unknown }
  | { readonly kind: "rejected"; readonly error: unknown }
  | { readonly kind: "still-pending" };

function waitForAbort(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_, reject) => {
    if (!signal) {
      return;
    }
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

async function outcomeByDeadline(operation: Promise<unknown>): Promise<OperationOutcome> {
  const outcome = Promise.race<OperationOutcome>([
    operation.then(
      (value) => ({ kind: "resolved", value }),
      (error) => ({ kind: "rejected", error }),
    ),
    new Promise<OperationOutcome>((resolve) => {
      setTimeout(() => resolve({ kind: "still-pending" }), deadlineMilliseconds + 1);
    }),
  ]);
  await vi.advanceTimersByTimeAsync(deadlineMilliseconds + 1);
  return outcome;
}

function configureSheetsFake({
  header,
  dateColumn,
  batchUpdate,
}: {
  readonly header: (
    request: unknown,
    options?: { signal?: AbortSignal },
  ) => Promise<unknown>;
  readonly dateColumn: (
    request: unknown,
    options?: { signal?: AbortSignal },
  ) => Promise<unknown>;
  readonly batchUpdate: (
    request: unknown,
    options?: { signal?: AbortSignal },
  ) => Promise<unknown>;
}): void {
  let readCount = 0;
  mocks.googleSheets.mockReturnValue({
    spreadsheets: {
      values: {
        get: (request: unknown, options?: { signal?: AbortSignal }) => {
          readCount += 1;
          return readCount === 1
            ? header(request, options)
            : dateColumn(request, options);
        },
        batchUpdate,
      },
    },
  });
}

function resolvedFakeResponse(values: unknown[][]) {
  return async () => ({ data: { values } });
}

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

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

describe("Google Sheets operation deadline", () => {
  it("P-1: stops a header read that does not respond", async () => {
    vi.useFakeTimers();
    configureSheetsFake({
      header: (_request, options) => waitForAbort(options?.signal),
      dateColumn: resolvedFakeResponse([["月日"], ["2026-08-11"]]),
      batchUpdate: async () => ({ data: { totalUpdatedCells: 1 } }),
    });

    await expect(outcomeByDeadline(updateSpreadsheetMeasurements({
      config,
      latestSet,
      timeZone: "Asia/Tokyo",
    }))).resolves.toMatchObject({
      kind: "rejected",
      error: {
        code: "google-sheets-operation-timeout",
        stage: "auth-or-header-read",
        writeConfirmation: "not-attempted",
      },
    });
  });

  it("P-2: stops a date-column read that does not respond", async () => {
    vi.useFakeTimers();
    configureSheetsFake({
      header: resolvedFakeResponse([["月日", "朝体重"]]),
      dateColumn: (_request, options) => waitForAbort(options?.signal),
      batchUpdate: async () => ({ data: { totalUpdatedCells: 1 } }),
    });

    await expect(outcomeByDeadline(updateSpreadsheetMeasurements({
      config,
      latestSet,
      timeZone: "Asia/Tokyo",
    }))).resolves.toMatchObject({
      kind: "rejected",
      error: {
        code: "google-sheets-operation-timeout",
        stage: "date-column-read",
        writeConfirmation: "not-attempted",
      },
    });
  });

  it("P-3: treats a batch-update response lost at the deadline as unconfirmed", async () => {
    vi.useFakeTimers();
    configureSheetsFake({
      header: resolvedFakeResponse([["月日", "朝体重"]]),
      dateColumn: resolvedFakeResponse([["月日"], ["2026-08-11"]]),
      batchUpdate: (_request, options) => waitForAbort(options?.signal),
    });

    await expect(outcomeByDeadline(updateSpreadsheetMeasurements({
      config,
      latestSet,
      timeZone: "Asia/Tokyo",
    }))).resolves.toMatchObject({
      kind: "rejected",
      error: {
        code: "google-sheets-operation-timeout",
        stage: "batch-update",
        writeConfirmation: "unconfirmed",
      },
    });
  });

  it("P-5: gives header, date-column, and batch-update the same signal", async () => {
    const signals: Array<AbortSignal | undefined> = [];
    configureSheetsFake({
      header: async (_request, options) => {
        signals.push(options?.signal);
        return { data: { values: [["月日", "朝体重"]] } };
      },
      dateColumn: async (_request, options) => {
        signals.push(options?.signal);
        return { data: { values: [["月日"], ["2026-08-11"]] } };
      },
      batchUpdate: async (_request, options) => {
        signals.push(options?.signal);
        return { data: { totalUpdatedCells: 1 } };
      },
    });

    await expect(updateSpreadsheetMeasurements({
      config,
      latestSet,
      timeZone: "Asia/Tokyo",
    })).resolves.toEqual({ state: "written", transferredCellCount: 1 });

    expect(signals).toHaveLength(3);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[1]).toBe(signals[0]);
    expect(signals[2]).toBe(signals[0]);
    expect(mocks.GoogleAuth).toHaveBeenCalledWith(expect.objectContaining({
      clientOptions: {
        transporterOptions: { signal: signals[0] },
      },
    }));
  });

  it("P-4: preserves the confirmed written outcome when all calls respond", async () => {
    configureSheetsFake({
      header: resolvedFakeResponse([["月日", "朝体重"]]),
      dateColumn: resolvedFakeResponse([["月日"], ["2026-08-11"]]),
      batchUpdate: async () => ({ data: { totalUpdatedCells: 1 } }),
    });

    await expect(updateSpreadsheetMeasurements({
      config,
      latestSet,
      timeZone: "Asia/Tokyo",
    })).resolves.toEqual({ state: "written", transferredCellCount: 1 });
  });
});
