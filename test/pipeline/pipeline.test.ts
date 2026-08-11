import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { MeasurementReading } from "../../src/domain/index.js";
import { InputSnapshotError } from "../../src/pipeline/input-snapshot.js";
import { runPipeline } from "../../src/pipeline/pipeline.js";
import { AtomicPipelineStatusWriter } from "../../src/pipeline/status.js";
import { GoogleSheetsOperationTimeoutError } from "../../src/sheets/index.js";

const referenceTime = new Date("2026-08-03T03:00:00.000Z");
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true })));
});

describe("runPipeline", () => {
  it("P-7: persists a Sheets operation timeout as failed:transfer", async () => {
    const statuses: Record<string, unknown>[] = [];
    const timeout = new GoogleSheetsOperationTimeoutError(
      "batch-update",
      30_000,
      "unconfirmed",
    );
    const weight: MeasurementReading = {
      kind: "weight",
      value: 68.4,
      unit: "kg",
      measuredAt: "2026-08-03T06:30:00+09:00",
      source: "scale_exporter",
    };

    await expect(runPipeline({
      period: "morning",
      timeZone: "Asia/Tokyo",
      referenceTime,
      readInput: async () => ({ matchedFileCount: 1, readLineCount: 1, readings: [weight] }),
      transfer: async () => {
        throw timeout;
      },
      statusWriter: {
        write: async (status: Record<string, unknown>) => {
          statuses.push(status);
        },
      },
    })).resolves.toEqual({ exitCode: 1, outcome: "failed:transfer" });

    expect(statuses).toEqual([
      expect.objectContaining({ outcome: "running" }),
      expect.objectContaining({
        outcome: "failed:transfer",
        diagnostic: "google-sheets-operation-timeout stage=batch-update deadlineMilliseconds=30000 writeConfirmation=unconfirmed",
        v3: {
          input: "ready",
          windowedWeightCount: 1,
          transfer: { state: "failed" },
        },
      }),
    ]);
  });

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

  /**
   * Issue #165: recovery is a document-wide event, not scoped to whichever
   * period this run happens to be for. A status document that lost its
   * `health` key on BOTH periods gets both re-evaluated and both written
   * back to disk on any single write -- but before this fix, only the
   * period matching the run's own `options.period` ever had its recovery
   * notification delivered. The other period's alert was recorded as
   * `claimed` in the file (a lie: nothing was ever sent) and, since the
   * health key was now present, could never recover -- and therefore never
   * notify -- again.
   */
  function bothPeriodsMissingHealth(): string {
    const terminal = (runId: string, targetDate: string) => ({
      runId,
      outcome: "failed:transfer" as const,
      startedAt: `${targetDate}T00:00:00.000Z`,
      completedAt: `${targetDate}T00:01:00.000Z`,
      targetDate,
      counts: { windowedReadingCount: 1 },
    });
    return JSON.stringify({
      schemaVersion: 1,
      definitionsVersion: 3,
      definitionsLabel: "2026-08-05/v3-transfer-observation",
      updatedAt: "2026-08-08T00:01:00.000Z",
      periods: {
        morning: {
          consecutiveFailureCount: 0,
          consecutiveNoDataCount: 0,
          lastTerminal: terminal("previous-morning-run", "2026-08-08"),
        },
        evening: {
          consecutiveFailureCount: 0,
          consecutiveNoDataCount: 0,
          lastTerminal: terminal("previous-evening-run", "2026-08-08"),
        },
      },
    });
  }

  it("delivers both periods' recovered alerts from a single run, and does not re-send on restart (AC-1/AC-2, #165)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scale2sheet-pipeline-both-recovered-"));
    tempDirs.push(dir);
    const statusPath = join(dir, "pipeline-status.json");
    await writeFile(statusPath, bothPeriodsMissingHealth(), "utf8");

    const weight: MeasurementReading = {
      kind: "weight",
      value: 68.4,
      unit: "kg",
      measuredAt: "2026-08-08T06:30:00+09:00",
      source: "google_fit",
    };
    const notifications: Array<{ period: string; fromState: string; toState: string }> = [];
    // This run's own transfer also fails, keeping morning's health at
    // alert -> alert (no state-transition trigger of its own), so morning's
    // notification here can only be the notification-state-loss recovery
    // claim -- the same isolation used by the single-period tests above.
    const runOnce = () =>
      runPipeline({
        period: "morning",
        timeZone: "Asia/Tokyo",
        referenceTime: new Date("2026-08-08T06:40:00+09:00"),
        targetDate: "2026-08-08",
        clock: () => new Date("2026-08-08T06:40:00+09:00"),
        readInput: async () => ({ matchedFileCount: 1, readLineCount: 1, readings: [weight] }),
        transfer: async () => ({ state: "not-written" as const, transferredCellCount: 0 }),
        statusWriter: new AtomicPipelineStatusWriter(statusPath, "run-morning"),
        notifier: {
          notify: async (period, transition) => {
            notifications.push({ period, ...transition });
          },
        },
      });

    await runOnce();
    // AC-1: both periods' alerts are delivered from the one execution --
    // not just morning (the period that actually ran).
    expect(notifications).toEqual(
      expect.arrayContaining([
        { period: "morning", fromState: "unobserved", toState: "alert" },
        { period: "evening", fromState: "unobserved", toState: "alert" },
      ]),
    );
    expect(notifications).toHaveLength(2);

    // AC-2: lastNotificationAttempt=claimed corresponds to an actual
    // delivery, for both periods -- not a recorded claim nobody received.
    const document = JSON.parse(await readFile(statusPath, "utf8"));
    expect(document.periods.morning.lastNotificationAttempt).toMatchObject({ result: "claimed" });
    expect(document.periods.evening.lastNotificationAttempt).toMatchObject({ result: "claimed" });
    expect(document.periods.morning.health).toBeDefined();
    expect(document.periods.evening.health).toBeDefined();

    // Restart: both periods now have a health key, so neither can recover
    // (and therefore neither can claim) again. No re-send.
    notifications.length = 0;
    await runOnce();
    expect(notifications).toEqual([]);
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

  /**
   * Issue #164 (replaces #142): the existing test group above proves the
   * delivery mechanism itself (state-transition / notification-state-loss
   * triggers, no-double-send, no-false-positive) but never exercises two
   * paths #76 named directly: the three input-stage failure outcomes, and
   * a `normal -> alert` transition (as opposed to `unobserved -> alert`,
   * the only direction the existing tests drive). Negative controls
   * confirmed both were previously undetected (see PR body / #164).
   */
  describe("notification coverage for input failures and normal -> alert (#164)", () => {
    it.each([
      ["input-missing", "failed:input-missing"],
      ["input-unstable", "failed:input-unstable"],
      ["input-invalid-or-partial", "failed:input-invalid-or-partial"],
    ] as const)(
      "delivers one notification when readInput fails with %s (AC-1)",
      async (inputOutcome, pipelineOutcome) => {
        const dir = await mkdtemp(join(tmpdir(), "scale2sheet-pipeline-input-failure-"));
        tempDirs.push(dir);
        const statusPath = join(dir, "pipeline-status.json");
        const notifications: Array<{ period: string; fromState: string; toState: string }> = [];

        await expect(
          runPipeline({
            period: "morning",
            timeZone: "Asia/Tokyo",
            referenceTime: new Date("2026-08-08T06:40:00+09:00"),
            targetDate: "2026-08-08",
            clock: () => new Date("2026-08-08T06:40:00+09:00"),
            readInput: async () => {
              throw new InputSnapshotError(inputOutcome, undefined, { matchedFileCount: 0, readLineCount: 0 });
            },
            transfer: async () => ({ state: "written" as const, transferredCellCount: 1 }),
            statusWriter: new AtomicPipelineStatusWriter(statusPath, "run-morning"),
            notifier: {
              notify: async (period, transition) => {
                notifications.push({ period, ...transition });
              },
            },
          }),
        ).resolves.toEqual({ exitCode: 1, outcome: pipelineOutcome });

        expect(notifications).toEqual([{ period: "morning", fromState: "unobserved", toState: "alert" }]);
      },
    );

    it("delivers one notification for normal -> alert, not just unobserved -> alert (AC-2)", async () => {
      const dir = await mkdtemp(join(tmpdir(), "scale2sheet-pipeline-normal-to-alert-"));
      tempDirs.push(dir);
      const statusPath = join(dir, "pipeline-status.json");
      const weight: MeasurementReading = {
        kind: "weight",
        value: 68.4,
        unit: "kg",
        measuredAt: "2026-08-08T06:30:00+09:00",
        source: "google_fit",
      };
      const notifications: Array<{ fromState: string; toState: string }> = [];
      const clock = () => new Date("2026-08-08T06:40:00+09:00");
      const notifier = { notify: async (_period: string, transition: { fromState: string; toState: string }) => { notifications.push(transition); } };
      const baseOptions = {
        period: "morning" as const,
        timeZone: "Asia/Tokyo",
        referenceTime: new Date("2026-08-08T06:40:00+09:00"),
        targetDate: "2026-08-08",
        clock,
        statusWriter: new AtomicPipelineStatusWriter(statusPath, "run-morning"),
        notifier,
      };

      // Run 1: succeeds, establishing health=normal (unobserved -> normal
      // claims no notification, per design; only unobserved/normal -> alert
      // and alert -> normal claim one).
      await expect(
        runPipeline({
          ...baseOptions,
          readInput: async () => ({ matchedFileCount: 1, readLineCount: 1, readings: [weight] }),
          transfer: async () => ({ state: "written" as const, transferredCellCount: 1 }),
        }),
      ).resolves.toEqual({ exitCode: 0, outcome: "completed:transferred" });
      expect(notifications).toEqual([]);

      // Run 2: fails. This is #46's actual shape -- something that was
      // working stops, not a first-ever failure -- and is the direction
      // NC-2 targets (stateTransitionTrigger's fromState === "normal" arm).
      await expect(
        runPipeline({
          ...baseOptions,
          readInput: async () => ({ matchedFileCount: 1, readLineCount: 1, readings: [weight] }),
          transfer: async () => ({ state: "not-written" as const, transferredCellCount: 0 }),
        }),
      ).resolves.toEqual({ exitCode: 1, outcome: "failed:transfer" });

      expect(notifications).toEqual([{ fromState: "normal", toState: "alert" }]);
    });

    it("does not deliver a second notification while failures continue, alert -> alert (AC-3)", async () => {
      const dir = await mkdtemp(join(tmpdir(), "scale2sheet-pipeline-alert-to-alert-"));
      tempDirs.push(dir);
      const statusPath = join(dir, "pipeline-status.json");
      const weight: MeasurementReading = {
        kind: "weight",
        value: 68.4,
        unit: "kg",
        measuredAt: "2026-08-08T06:30:00+09:00",
        source: "google_fit",
      };
      const notifications: Array<{ fromState: string; toState: string }> = [];
      const clock = () => new Date("2026-08-08T06:40:00+09:00");
      const notifier = { notify: async (_period: string, transition: { fromState: string; toState: string }) => { notifications.push(transition); } };
      const runOnce = () =>
        runPipeline({
          period: "morning",
          timeZone: "Asia/Tokyo",
          referenceTime: new Date("2026-08-08T06:40:00+09:00"),
          targetDate: "2026-08-08",
          clock,
          statusWriter: new AtomicPipelineStatusWriter(statusPath, "run-morning"),
          notifier,
          readInput: async () => ({ matchedFileCount: 1, readLineCount: 1, readings: [weight] }),
          transfer: async () => ({ state: "not-written" as const, transferredCellCount: 0 }),
        });

      await expect(runOnce()).resolves.toEqual({ exitCode: 1, outcome: "failed:transfer" });
      expect(notifications).toEqual([{ fromState: "unobserved", toState: "alert" }]);

      await expect(runOnce()).resolves.toEqual({ exitCode: 1, outcome: "failed:transfer" });
      expect(notifications).toEqual([{ fromState: "unobserved", toState: "alert" }]);
    });
  });
});
