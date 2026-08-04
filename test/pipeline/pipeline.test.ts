import { describe, expect, it } from "vitest";

import type { MeasurementReading } from "../../src/domain/index.js";
import { InputSnapshotError } from "../../src/pipeline/input-snapshot.js";
import { runPipeline } from "../../src/pipeline/pipeline.js";

const referenceTime = new Date("2026-08-03T03:00:00.000Z");

describe("runPipeline", () => {
  it("does not call the transfer port when the input snapshot fails", async () => {
    let transfers = 0;
    const statuses: unknown[] = [];

    await expect(
      runPipeline({
        period: "morning",
        timeZone: "Asia/Tokyo",
        referenceTime,
        readInput: async () => {
          throw new InputSnapshotError(
            "input-invalid-or-partial",
            undefined,
            { matchedFileCount: 1, readLineCount: 2 },
          );
        },
        transfer: async () => {
          transfers += 1;
        },
        statusWriter: {
          write: async (status) => {
            statuses.push(status);
          },
        },
      }),
    ).resolves.toEqual({ exitCode: 1, outcome: "failed:input-invalid-or-partial" });
    expect(transfers).toBe(0);
    expect(statuses).toEqual([
      expect.objectContaining({
        outcome: "running",
        counts: {},
      }),
      expect.objectContaining({
        outcome: "failed:input-invalid-or-partial",
        counts: { matchedFileCount: 1, readLineCount: 2 },
      }),
    ]);
    expect(statuses[0]).not.toHaveProperty("completedAt");
  });

  it("returns completed:no-data without calling the transfer port for no usable readings", async () => {
    let transfers = 0;
    const outsideWindow: MeasurementReading = {
      kind: "weight",
      value: 68.4,
      unit: "kg",
      measuredAt: "2026-08-03T15:00:00+09:00",
      source: "google_fit",
    };

    await expect(
      runPipeline({
        period: "morning",
        timeZone: "Asia/Tokyo",
        referenceTime,
        readInput: async () => ({
          matchedFileCount: 1,
          readLineCount: 1,
          readings: [outsideWindow],
        }),
        transfer: async () => {
          transfers += 1;
        },
      }),
    ).resolves.toEqual({ exitCode: 0, outcome: "completed:no-data" });
    expect(transfers).toBe(0);
  });

  it("deduplicates windowed readings before invoking the transfer port", async () => {
    let transferred: readonly MeasurementReading[] = [];
    const duplicate: MeasurementReading = {
      kind: "weight",
      value: 68.4,
      unit: "kg",
      measuredAt: "2026-08-03T06:30:00+09:00",
      source: "google_fit",
    };

    await expect(
      runPipeline({
        period: "morning",
        timeZone: "Asia/Tokyo",
        referenceTime,
        readInput: async () => ({
          matchedFileCount: 1,
          readLineCount: 2,
          readings: [duplicate, { ...duplicate }],
        }),
        transfer: async (readings) => {
          transferred = readings;
        },
      }),
    ).resolves.toEqual({ exitCode: 0, outcome: "completed:transferred" });
    expect(transferred).toEqual([duplicate]);
  });
});
