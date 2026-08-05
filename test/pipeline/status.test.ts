import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AtomicPipelineStatusWriter } from "../../src/pipeline/status.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe("AtomicPipelineStatusWriter", () => {
  it("keeps both periods and resets a no-data streak only after a transferred terminal", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-status-"));
    temporaryDirectories.push(directory);
    const statusPath = path.join(directory, "pipeline-status.json");
    const writer = new AtomicPipelineStatusWriter(statusPath, "run-morning");

    await writer.write({
      period: "morning",
      outcome: "running",
      startedAt: "2026-08-05T00:00:00.000Z",
      targetDate: "2026-08-05",
      counts: {},
    });
    await writer.write({
      period: "morning",
      outcome: "completed:no-data",
      startedAt: "2026-08-05T00:00:00.000Z",
      completedAt: "2026-08-05T00:01:00.000Z",
      targetDate: "2026-08-05",
      counts: { windowedReadingCount: 0 },
    });
    await writer.write({
      period: "morning",
      outcome: "completed:no-data",
      startedAt: "2026-08-06T00:00:00.000Z",
      completedAt: "2026-08-06T00:01:00.000Z",
      targetDate: "2026-08-06",
      counts: { windowedReadingCount: 0 },
    });
    await writer.write({
      period: "morning",
      outcome: "failed:transfer",
      startedAt: "2026-08-07T00:00:00.000Z",
      completedAt: "2026-08-07T00:01:00.000Z",
      targetDate: "2026-08-07",
      counts: { windowedReadingCount: 1 },
      diagnostic: "network failure",
    });

    let document = JSON.parse(await readFile(statusPath, "utf8"));
    expect(document).toMatchObject({
      schemaVersion: 1,
      definitionsVersion: 1,
      definitionsLabel: "2026-08-04/pre-63",
      periods: {
        morning: {
          consecutiveFailureCount: 1,
          consecutiveNoDataCount: 2,
          lastDoneAt: "2026-08-06T00:01:00.000Z",
        },
        evening: {
          consecutiveFailureCount: 0,
          consecutiveNoDataCount: 0,
          health: { state: "unobserved", causes: [] },
        },
      },
    });

    await writer.write({
      period: "morning",
      outcome: "completed:transferred",
      startedAt: "2026-08-08T00:00:00.000Z",
      completedAt: "2026-08-08T00:01:00.000Z",
      targetDate: "2026-08-08",
      counts: { windowedReadingCount: 1 },
    });

    document = JSON.parse(await readFile(statusPath, "utf8"));
    expect(document.periods.morning).toMatchObject({
      consecutiveFailureCount: 0,
      consecutiveNoDataCount: 0,
      lastDoneAt: "2026-08-08T00:01:00.000Z",
      lastTransferredAt: "2026-08-08T00:01:00.000Z",
    });
  });

  it("does not overwrite a schema v1 document with an invalid period state", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-status-"));
    temporaryDirectories.push(directory);
    const statusPath = path.join(directory, "pipeline-status.json");
    const invalid = JSON.stringify({
      schemaVersion: 1,
      definitionsVersion: 1,
      definitionsLabel: "2026-08-04/pre-63",
      updatedAt: "2026-08-05T00:00:00.000Z",
      periods: {
        morning: { consecutiveFailureCount: 0, consecutiveNoDataCount: 0, health: "invalid" },
        evening: { consecutiveFailureCount: 0, consecutiveNoDataCount: 0, health: { state: "unobserved", causes: [] } },
      },
    });
    await writeFile(statusPath, invalid, "utf8");
    const writer = new AtomicPipelineStatusWriter(statusPath, "run-morning");

    await expect(writer.write({
      period: "morning",
      outcome: "running",
      startedAt: "2026-08-05T00:00:00.000Z",
      targetDate: "2026-08-05",
      counts: {},
    })).rejects.toThrow("invalid period state");
    await expect(readFile(statusPath, "utf8")).resolves.toBe(invalid);
  });

  it("recovers only a missing health key when a valid terminal observation remains", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-status-"));
    temporaryDirectories.push(directory);
    const statusPath = path.join(directory, "pipeline-status.json");
    await writeFile(statusPath, JSON.stringify({
      schemaVersion: 1,
      definitionsVersion: 1,
      definitionsLabel: "human label is not used for machine acceptance",
      updatedAt: "2026-08-05T00:01:00.000Z",
      periods: {
        morning: {
          consecutiveFailureCount: 0,
          consecutiveNoDataCount: 0,
          lastTerminal: {
            runId: "previous-run",
            outcome: "completed:transferred",
            startedAt: "2026-08-05T00:00:00.000Z",
            completedAt: "2026-08-05T00:01:00.000Z",
            targetDate: "2026-08-05",
            counts: { windowedReadingCount: 1 },
          },
          lastDoneAt: "2026-08-05T00:01:00.000Z",
          lastTransferredAt: "2026-08-05T00:01:00.000Z",
        },
        evening: {
          consecutiveFailureCount: 0,
          consecutiveNoDataCount: 0,
          health: { state: "unobserved", causes: [] },
        },
      },
    }), "utf8");
    const writer = new AtomicPipelineStatusWriter(statusPath, "run-morning");

    await writer.write({
      period: "evening",
      outcome: "running",
      startedAt: "2026-08-05T10:00:00.000Z",
      targetDate: "2026-08-05",
      counts: {},
    });

    const document = JSON.parse(await readFile(statusPath, "utf8"));
    expect(document.definitionsLabel).toBe("human label is not used for machine acceptance");
    expect(document.periods.morning).toMatchObject({
      lastTerminal: { runId: "previous-run" },
      consecutiveNoDataCount: 0,
      health: { state: "normal", causes: [] },
      lastNotificationDiagnostic: {
        code: "notification-state-missing",
        lastTerminalRunId: "previous-run",
      },
    });
  });

  it("re-evaluates stale and consecutive no-data causes when recovering a missing health key", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-status-"));
    temporaryDirectories.push(directory);
    const statusPath = path.join(directory, "pipeline-status.json");
    await writeFile(statusPath, JSON.stringify({
      schemaVersion: 1,
      definitionsVersion: 1,
      definitionsLabel: "2026-08-04/pre-63",
      updatedAt: "2026-08-05T00:01:00.000Z",
      periods: {
        morning: {
          consecutiveFailureCount: 0,
          consecutiveNoDataCount: 10,
          lastTerminal: {
            runId: "previous-run",
            outcome: "completed:no-data",
            startedAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-01T00:01:00.000Z",
            targetDate: "2026-01-01",
            counts: { windowedReadingCount: 0 },
          },
          lastDoneAt: "2026-01-01T00:01:00.000Z",
        },
        evening: { consecutiveFailureCount: 0, consecutiveNoDataCount: 0, health: { state: "unobserved", causes: [] } },
      },
    }), "utf8");

    await new AtomicPipelineStatusWriter(statusPath, "run-evening").write({
      period: "evening", outcome: "running", startedAt: "2026-08-05T10:00:00.000Z", targetDate: "2026-08-05", counts: {},
    });

    const document = JSON.parse(await readFile(statusPath, "utf8"));
    expect(document.periods.morning.health).toEqual({
      state: "alert",
      causes: expect.arrayContaining(["v1-stale", "consecutive-no-data"]),
    });
  });

  it("rejects version zero and unknown versions without overwriting the source document", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-status-"));
    temporaryDirectories.push(directory);
    const writer = new AtomicPipelineStatusWriter(path.join(directory, "pipeline-status.json"), "run-morning");
    for (const schemaVersion of [0, 2]) {
      const source = JSON.stringify({ schemaVersion, definitionsVersion: 1, definitionsLabel: "label", periods: {} });
      await writeFile(path.join(directory, "pipeline-status.json"), source, "utf8");
      await expect(writer.write({ period: "morning", outcome: "running", startedAt: "2026-08-05T00:00:00.000Z", targetDate: "2026-08-05", counts: {} }))
        .rejects.toThrow("unsupported status schema version");
      await expect(readFile(path.join(directory, "pipeline-status.json"), "utf8")).resolves.toBe(source);
    }
    for (const definitionsVersion of [0, 2]) {
      const source = JSON.stringify({ schemaVersion: 1, definitionsVersion, definitionsLabel: "label", periods: {} });
      await writeFile(path.join(directory, "pipeline-status.json"), source, "utf8");
      await expect(writer.write({ period: "morning", outcome: "running", startedAt: "2026-08-05T00:00:00.000Z", targetDate: "2026-08-05", counts: {} }))
        .rejects.toThrow("unsupported status definitions version");
      await expect(readFile(path.join(directory, "pipeline-status.json"), "utf8")).resolves.toBe(source);
    }
  });

  it("does not recover a type-invalid health field even when a valid terminal remains", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-status-"));
    temporaryDirectories.push(directory);
    const statusPath = path.join(directory, "pipeline-status.json");
    const source = JSON.stringify({
      schemaVersion: 1,
      definitionsVersion: 1,
      definitionsLabel: "label",
      updatedAt: "2026-08-05T00:01:00.000Z",
      periods: {
        morning: {
          consecutiveFailureCount: 0,
          consecutiveNoDataCount: 0,
          health: "invalid",
          lastTerminal: {
            runId: "previous-run", outcome: "completed:transferred",
            startedAt: "2026-08-05T00:00:00.000Z", completedAt: "2026-08-05T00:01:00.000Z",
            targetDate: "2026-08-05", counts: {},
          },
        },
        evening: { consecutiveFailureCount: 0, consecutiveNoDataCount: 0, health: { state: "unobserved", causes: [] } },
      },
    });
    await writeFile(statusPath, source, "utf8");
    const writer = new AtomicPipelineStatusWriter(statusPath, "run-evening");
    await expect(writer.write({ period: "evening", outcome: "running", startedAt: "2026-08-05T10:00:00.000Z", targetDate: "2026-08-05", counts: {} }))
      .rejects.toThrow("invalid period state");
    await expect(readFile(statusPath, "utf8")).resolves.toBe(source);
  });

  it("keeps the latest terminal observation when recording the next active run", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-status-"));
    temporaryDirectories.push(directory);
    const statusPath = path.join(directory, "pipeline-status.json");
    const writer = new AtomicPipelineStatusWriter(statusPath, "run-morning");
    await writer.write({ period: "morning", outcome: "running", startedAt: "2026-08-05T00:00:00.000Z", targetDate: "2026-08-05", counts: {} });
    await writer.write({ period: "morning", outcome: "completed:transferred", startedAt: "2026-08-05T00:00:00.000Z", completedAt: "2026-08-05T00:01:00.000Z", targetDate: "2026-08-05", counts: {} });
    await writer.write({ period: "morning", outcome: "running", startedAt: "2026-08-06T00:00:00.000Z", targetDate: "2026-08-06", counts: {} });
    const document = JSON.parse(await readFile(statusPath, "utf8"));
    expect(document.periods.morning).toMatchObject({
      activeRun: { runId: "run-morning", targetDate: "2026-08-06" },
      lastTerminal: { outcome: "completed:transferred", targetDate: "2026-08-05" },
    });
  });
});
