import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { MeasurementReading } from "../../src/domain/index.js";
import { InputSnapshotError } from "../../src/pipeline/input-snapshot.js";
import { runPipeline } from "../../src/pipeline/pipeline.js";
import { AtomicPipelineStatusWriter } from "../../src/pipeline/status.js";

const referenceTime = new Date("2026-08-03T03:00:00.000Z");
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true })));
});

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
          return { state: "written" as const, transferredCellCount: 1 };
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
          return { state: "written" as const, transferredCellCount: 1 };
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
        return { state: "written" as const, transferredCellCount: 1 };
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
      transfer: async () => ({ state: "written" as const, transferredCellCount: 1 }),
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
      transfer: async () => ({ state: "written" as const, transferredCellCount: 1 }),
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
          return { state: "written" as const, transferredCellCount: 1 };
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
      transfer: async (readings) => { transferred = readings; return { state: "written" as const, transferredCellCount: 1 }; },
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
      transfer: async () => ({ state: "written" as const, transferredCellCount: 1 }),
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

  it("does not attempt a transfer when the window has other kinds but no weight (V-3)", async () => {
    let transfers = 0;
    const temperature: MeasurementReading = {
      kind: "body_temperature",
      value: 36.5,
      unit: "celsius",
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
          readLineCount: 1,
          readings: [temperature],
        }),
        transfer: async () => {
          transfers += 1;
          return { state: "written" as const, transferredCellCount: 1 };
        },
      }),
    ).resolves.toEqual({ exitCode: 0, outcome: "completed:no-data" });
    expect(transfers).toBe(0);
  });

  it.each([
    { state: "not-written" as const, transferredCellCount: 0, label: "not-written with zero cells" },
    { state: "written" as const, transferredCellCount: 0, label: "written with zero cells" },
    { state: "unknown" as const, transferredCellCount: undefined, label: "unknown cell count" },
  ])("treats $label as a transfer failure (V-3)", async ({ state, transferredCellCount }) => {
    const weight: MeasurementReading = {
      kind: "weight",
      value: 68.4,
      unit: "kg",
      measuredAt: "2026-08-03T06:30:00+09:00",
      source: "google_fit",
    };
    let notified = 0;
    const dir = await mkdtemp(join(tmpdir(), "scale2sheet-pipeline-notify-"));
    tempDirs.push(dir);

    await expect(
      runPipeline({
        period: "morning",
        timeZone: "Asia/Tokyo",
        referenceTime,
        targetDate: "2026-08-03",
        readInput: async () => ({
          matchedFileCount: 1,
          readLineCount: 1,
          readings: [weight],
        }),
        transfer: async () => ({ state, transferredCellCount }),
        statusWriter: new AtomicPipelineStatusWriter(join(dir, "pipeline-status.json"), "run-morning"),
        notifier: {
          notify: async () => {
            notified += 1;
          },
        },
      }),
    ).resolves.toEqual({ exitCode: 1, outcome: "failed:transfer" });
    /** The first terminal write is unobserved -> alert: exactly one transition notification. */
    expect(notified).toBe(1);
  });

  /**
   * design §9.1/§9.2 (PR #134 review): a status document that lost its
   * `health` key (schema drift/corruption) but still has a valid
   * `lastTerminal` is recovered on read, not treated as broken. If the
   * re-evaluated health is `alert`, that recovery claims a
   * `notification-state-loss` attempt and must fire an alert notification —
   * a real one, not just a claim recorded in the file. This trigger has no
   * `fromState` (the prior confirmed state was lost), unlike the three
   * `state-transition` triggers pipeline.ts already delivered.
   */
  function corruptedStatusMissingHealth(outcome: "failed:transfer" | "completed:transferred"): string {
    return JSON.stringify({
      schemaVersion: 1,
      definitionsVersion: 3,
      definitionsLabel: "2026-08-05/v3-transfer-observation",
      updatedAt: "2026-08-07T00:01:00.000Z",
      periods: {
        morning: {
          consecutiveFailureCount: 0,
          consecutiveNoDataCount: 0,
          lastTerminal: {
            runId: "previous-run",
            outcome,
            startedAt: "2026-08-07T00:00:00.000Z",
            completedAt: "2026-08-07T00:01:00.000Z",
            targetDate: "2026-08-07",
            counts: { windowedReadingCount: 1 },
          },
          lastDoneAt: outcome === "completed:transferred" ? "2026-08-07T00:01:00.000Z" : undefined,
          lastTransferredAt: outcome === "completed:transferred" ? "2026-08-07T00:01:00.000Z" : undefined,
        },
        evening: { consecutiveFailureCount: 0, consecutiveNoDataCount: 0, health: { state: "unobserved", causes: [] } },
      },
    });
  }

  it("delivers a real notification for a notification-state-loss recovery into alert (design §9.1)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scale2sheet-pipeline-state-loss-"));
    tempDirs.push(dir);
    const statusPath = join(dir, "pipeline-status.json");
    // The prior terminal failed, so re-evaluating health from it yields "alert".
    await writeFile(statusPath, corruptedStatusMissingHealth("failed:transfer"), "utf8");

    const weight: MeasurementReading = {
      kind: "weight",
      value: 68.4,
      unit: "kg",
      measuredAt: "2026-08-08T06:30:00+09:00",
      source: "google_fit",
    };
    const notifications: Array<{ period: string; fromState: string; toState: string }> = [];

    // This run's own transfer also fails, so health stays alert -> alert
    // (no type-level transition trigger of its own). This isolates the
    // recovery notification from the FIRST ("running") write as the only
    // thing that could call notify() — otherwise a healthy second write
    // would itself produce an alert -> normal transition and this test
    // would pass for the wrong reason (confirmed: the first version of
    // this test used a successful transfer and passed even with the
    // bug present, because the run's own second write's alert -> normal
    // transition delivered a notification regardless).
    await expect(
      runPipeline({
        period: "morning",
        timeZone: "Asia/Tokyo",
        referenceTime: new Date("2026-08-08T06:40:00+09:00"),
        targetDate: "2026-08-08",
        // Pins observedAt/startedAt/completedAt to the fixture's own time,
        // not the real wall clock (default `new Date()`). Without this,
        // evaluateHealth's v1-stale check compares the real "now" against
        // corruptedStatusMissingHealth's hardcoded lastDoneAt
        // (2026-08-07), which silently flips normal -> alert once real
        // time drifts more than 2 days past that fixture date.
        clock: () => new Date("2026-08-08T06:40:00+09:00"),
        readInput: async () => ({ matchedFileCount: 1, readLineCount: 1, readings: [weight] }),
        transfer: async () => ({ state: "not-written" as const, transferredCellCount: 0 }),
        statusWriter: new AtomicPipelineStatusWriter(statusPath, "run-morning"),
        notifier: {
          notify: async (period, transition) => {
            notifications.push({ period, ...transition });
          },
        },
      }),
    ).resolves.toEqual({ exitCode: 1, outcome: "failed:transfer" });

    expect(notifications).toEqual([{ period: "morning", fromState: "unobserved", toState: "alert" }]);
  });

  it("does not notify for a notification-state-loss recovery into normal (design §9.1: recovery-to-normal claims nothing)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scale2sheet-pipeline-state-loss-"));
    tempDirs.push(dir);
    const statusPath = join(dir, "pipeline-status.json");
    // The prior terminal succeeded, so re-evaluating health from it yields "normal".
    await writeFile(statusPath, corruptedStatusMissingHealth("completed:transferred"), "utf8");

    const weight: MeasurementReading = {
      kind: "weight",
      value: 68.4,
      unit: "kg",
      measuredAt: "2026-08-08T06:30:00+09:00",
      source: "google_fit",
    };
    const notifications: unknown[] = [];

    await expect(
      runPipeline({
        period: "morning",
        timeZone: "Asia/Tokyo",
        referenceTime: new Date("2026-08-08T06:40:00+09:00"),
        targetDate: "2026-08-08",
        // Pins observedAt/startedAt/completedAt to the fixture's own time,
        // not the real wall clock (default `new Date()`). Without this,
        // evaluateHealth's v1-stale check compares the real "now" against
        // corruptedStatusMissingHealth's hardcoded lastDoneAt
        // (2026-08-07), which silently flips normal -> alert once real
        // time drifts more than 2 days past that fixture date.
        clock: () => new Date("2026-08-08T06:40:00+09:00"),
        readInput: async () => ({ matchedFileCount: 1, readLineCount: 1, readings: [weight] }),
        transfer: async () => ({ state: "written" as const, transferredCellCount: 1 }),
        statusWriter: new AtomicPipelineStatusWriter(statusPath, "run-morning"),
        notifier: {
          notify: async (period, transition) => {
            notifications.push({ period, ...transition });
          },
        },
      }),
    ).resolves.toEqual({ exitCode: 0, outcome: "completed:transferred" });

    expect(notifications).toEqual([]);
  });

  it("does not re-send a claimed notification-state-loss attempt across a restart (design §9.2: recovered health is written back)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scale2sheet-pipeline-state-loss-"));
    tempDirs.push(dir);
    const statusPath = join(dir, "pipeline-status.json");
    await writeFile(statusPath, corruptedStatusMissingHealth("failed:transfer"), "utf8");

    const weight: MeasurementReading = {
      kind: "weight",
      value: 68.4,
      unit: "kg",
      measuredAt: "2026-08-08T06:30:00+09:00",
      source: "google_fit",
    };
    const notifications: Array<{ fromState: string; toState: string }> = [];
    // Both runs' own transfer fails too, keeping health at alert -> alert
    // throughout, so only the first run's recovery notification can ever
    // fire (see the previous test's comment for why this isolation matters).
    const runOnce = () =>
      runPipeline({
        period: "morning",
        timeZone: "Asia/Tokyo",
        referenceTime: new Date("2026-08-08T06:40:00+09:00"),
        targetDate: "2026-08-08",
        // Pins observedAt/startedAt/completedAt to the fixture's own time,
        // not the real wall clock (default `new Date()`). Without this,
        // evaluateHealth's v1-stale check compares the real "now" against
        // corruptedStatusMissingHealth's hardcoded lastDoneAt
        // (2026-08-07), which silently flips normal -> alert once real
        // time drifts more than 2 days past that fixture date.
        clock: () => new Date("2026-08-08T06:40:00+09:00"),
        readInput: async () => ({ matchedFileCount: 1, readLineCount: 1, readings: [weight] }),
        transfer: async () => ({ state: "not-written" as const, transferredCellCount: 0 }),
        statusWriter: new AtomicPipelineStatusWriter(statusPath, "run-morning"),
        notifier: { notify: async (_period, transition) => { notifications.push(transition); } },
      });

    await runOnce();
    expect(notifications).toEqual([{ fromState: "unobserved", toState: "alert" }]);

    // health is now present in the file, so a second "restart" no longer
    // finds a missing-health period to recover, and does not re-claim.
    await runOnce();
    expect(notifications).toEqual([{ fromState: "unobserved", toState: "alert" }]);
    const document = JSON.parse(await readFile(statusPath, "utf8"));
    expect(document.periods.morning.health).toBeDefined();
  });

  it("matches the 2026-08-04 evening pair: window-out weight is no-data, a real transfer is completed (AC-122)", async () => {
    const outsideEveningWindow: MeasurementReading = {
      kind: "weight",
      value: 70.5,
      unit: "kg",
      measuredAt: "2026-08-04T11:16:00+09:00",
      source: "apple_health",
    };
    const noDataResult = await runPipeline({
      period: "evening",
      timeZone: "Asia/Tokyo",
      referenceTime: new Date("2026-08-04T12:22:00+09:00"),
      readInput: async () => ({
        matchedFileCount: 1,
        readLineCount: 1,
        readings: [outsideEveningWindow],
      }),
      transfer: async () => ({ state: "written" as const, transferredCellCount: 1 }),
    });
    expect(noDataResult).toEqual({ exitCode: 0, outcome: "completed:no-data" });

    const insideEveningWindow: MeasurementReading = {
      kind: "weight",
      value: 70.4,
      unit: "kg",
      measuredAt: "2026-08-04T21:31:00+09:00",
      source: "apple_health",
    };
    const transferredResult = await runPipeline({
      period: "evening",
      timeZone: "Asia/Tokyo",
      referenceTime: new Date("2026-08-04T22:03:00+09:00"),
      readInput: async () => ({
        matchedFileCount: 1,
        readLineCount: 1,
        readings: [insideEveningWindow],
      }),
      transfer: async () => ({ state: "written" as const, transferredCellCount: 5 }),
    });
    expect(transferredResult).toEqual({ exitCode: 0, outcome: "completed:transferred" });
  });
});
