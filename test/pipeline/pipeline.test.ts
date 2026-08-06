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

  it("continues a valid transfer and records filename anomalies once at completion", async () => {
    const statuses: Record<string, unknown>[] = [];
    const logMessages: string[] = [];
    let transfers = 0;
    const anomalyCandidates = [
      {
        name: "scale_exporter_2026-08-03_apple-health-file_001.jsonl",
        reason: "file-name-pattern-mismatch" as const,
      },
    ];
    const reading: MeasurementReading = {
      kind: "weight",
      value: 68.4,
      unit: "kg",
      measuredAt: "2026-08-03T06:30:00+09:00",
      source: "google_fit",
    };
    const options = {
      period: "morning" as const,
      timeZone: "Asia/Tokyo",
      referenceTime,
      targetDate: "2026-08-03",
      readInput: async () => ({
        matchedFileCount: 1,
        readLineCount: 1,
        readings: [reading],
        inputAnomalyCandidates: anomalyCandidates,
      }),
      transfer: async () => {
        transfers += 1;
      },
      statusWriter: {
        write: async (status: Record<string, unknown>) => {
          statuses.push(status);
        },
      },
      logger: {
        log: (message: string) => logMessages.push(message),
      },
      clock: () => new Date("2026-08-03T03:01:00.000Z"),
    };

    await expect(runPipeline(options)).resolves.toEqual({
      exitCode: 0,
      outcome: "completed:transferred",
    });

    expect(transfers).toBe(1);
    expect(statuses).toEqual([
      expect.not.objectContaining({ inputAnomalyCandidates: expect.anything() }),
      expect.objectContaining({
        completedAt: "2026-08-03T03:01:00.000Z",
        targetDate: "2026-08-03",
        inputAnomalyCandidates: anomalyCandidates,
      }),
    ]);
    expect(logMessages).toEqual([
      JSON.stringify({
        at: "2026-08-03T03:01:00.000Z",
        event: "input-anomaly-candidates",
        targetDate: "2026-08-03",
        inputAnomalyCandidates: anomalyCandidates,
      }),
    ]);
  });

  it("records a near-miss-only input failure in its terminal status and log", async () => {
    const statuses: Record<string, unknown>[] = [];
    const logMessages: string[] = [];
    const anomalyCandidates = [
      {
        name: "scale_exporter_2026-08-03_apple-health-file_001.jsonl",
        reason: "file-name-pattern-mismatch" as const,
      },
    ];
    const options = {
      period: "morning" as const,
      timeZone: "Asia/Tokyo",
      referenceTime,
      targetDate: "2026-08-03",
      readInput: async () => {
        throw new InputSnapshotError(
          "input-missing",
          "no target-date files found for 2026-08-03",
          { matchedFileCount: 0 },
          anomalyCandidates,
        );
      },
      transfer: async () => {},
      statusWriter: {
        write: async (status: Record<string, unknown>) => {
          statuses.push(status);
        },
      },
      logger: {
        log: (message: string) => logMessages.push(message),
      },
      clock: () => new Date("2026-08-03T03:01:00.000Z"),
    };

    await expect(runPipeline(options)).resolves.toEqual({
      exitCode: 1,
      outcome: "failed:input-missing",
    });

    expect(statuses[0]).not.toHaveProperty("inputAnomalyCandidates");
    expect(statuses[1]).toMatchObject({
      outcome: "failed:input-missing",
      targetDate: "2026-08-03",
      inputAnomalyCandidates: anomalyCandidates,
    });
    expect(logMessages).toHaveLength(1);
  });

  it("does not add status fields or logs when input has no anomaly candidates", async () => {
    const statuses: Record<string, unknown>[] = [];
    const logMessages: string[] = [];

    await runPipeline({
      period: "morning",
      timeZone: "Asia/Tokyo",
      referenceTime,
      targetDate: "2026-08-03",
      readInput: async () => ({
        matchedFileCount: 1,
        readLineCount: 1,
        readings: [],
      }),
      transfer: async () => {},
      statusWriter: {
        write: async (status: Record<string, unknown>) => {
          statuses.push(status);
        },
      },
      logger: {
        log: (message: string) => logMessages.push(message),
      },
    });

    expect(statuses).toHaveLength(2);
    expect(statuses[0]).not.toHaveProperty("inputAnomalyCandidates");
    expect(statuses[1]).not.toHaveProperty("inputAnomalyCandidates");
    expect(logMessages).toEqual([]);
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

  it("applies cross-source identity before the pipeline transfer", async () => {
    let transferred: readonly MeasurementReading[] = [];
    const apple: MeasurementReading = { kind: "weight", value: 68.2, unit: "kg", measuredAt: "2026-08-03T06:30:00+09:00", source: "apple_health" };
    await runPipeline({ period: "morning", timeZone: "Asia/Tokyo", referenceTime,
      readInput: async () => ({ matchedFileCount: 1, readLineCount: 2, readings: [apple, { ...apple, value: 68.19999694824219, source: "google_fit" }] }),
      transfer: async (readings) => { transferred = readings; },
    });
    expect(transferred).toEqual([apple]);
  });

  it("records published records and physical measurements side by side", async () => {
    const statuses: { counts: Record<string, number> }[] = [];
    const apple: MeasurementReading = { kind: "weight", value: 68.2, unit: "kg", measuredAt: "2026-08-03T06:30:00+09:00", source: "Xiaomi Home" };
    const google: MeasurementReading = { ...apple, value: 68.19999694824219, source: "google_fit" };

    await runPipeline({
      period: "morning",
      timeZone: "Asia/Tokyo",
      referenceTime,
      targetDate: "2026-08-03",
      readInput: async () => ({
        matchedFileCount: 2,
        readLineCount: 3,
        readings: [apple, { ...apple }, google],
      }),
      transfer: async () => {},
      statusWriter: {
        write: async (status) => {
          statuses.push(status as unknown as { counts: Record<string, number> });
        },
      },
    });

    expect(statuses.at(-1)?.counts).toEqual({
      matchedFileCount: 2,
      readLineCount: 3,
      windowedReadingCount: 2,
      uniqueMeasurementCount: 1,
    });
  });
});
