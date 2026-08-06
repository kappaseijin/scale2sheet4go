import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

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
      definitionsVersion: 3,
      definitionsLabel: "2026-08-05/v3-transfer-observation",
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
      definitionsVersion: 3,
      definitionsLabel: "2026-08-05/v3-transfer-observation",
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
      definitionsVersion: 3,
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
      definitionsVersion: 3,
      definitionsLabel: "2026-08-05/v3-transfer-observation",
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
      const source = JSON.stringify({ schemaVersion, definitionsVersion: 3, definitionsLabel: "label", periods: {} });
      await writeFile(path.join(directory, "pipeline-status.json"), source, "utf8");
      await expect(writer.write({ period: "morning", outcome: "running", startedAt: "2026-08-05T00:00:00.000Z", targetDate: "2026-08-05", counts: {} }))
        .rejects.toThrow("unsupported status schema version");
      await expect(readFile(path.join(directory, "pipeline-status.json"), "utf8")).resolves.toBe(source);
    }
    for (const definitionsVersion of [0, -1, 1.5]) {
      const source = JSON.stringify({ schemaVersion: 1, definitionsVersion, definitionsLabel: "label", periods: {} });
      await writeFile(path.join(directory, "pipeline-status.json"), source, "utf8");
      await expect(writer.write({ period: "morning", outcome: "running", startedAt: "2026-08-05T00:00:00.000Z", targetDate: "2026-08-05", counts: {} }))
        .rejects.toThrow("unsupported status definitions version");
      await expect(readFile(path.join(directory, "pipeline-status.json"), "utf8")).resolves.toBe(source);
    }
  });

  it("rebaselines instead of continuing counts recorded under an older definition", async () => {
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
          consecutiveFailureCount: 3,
          consecutiveNoDataCount: 5,
          health: { state: "alert", causes: ["terminal-failure"] },
          lastTerminal: {
            runId: "pre-63-run",
            outcome: "failed:transfer",
            startedAt: "2026-08-05T00:00:00.000Z",
            completedAt: "2026-08-05T00:01:00.000Z",
            targetDate: "2026-08-05",
            counts: { windowedReadingCount: 1 },
          },
          lastDoneAt: "2026-08-05T00:01:00.000Z",
          lastTransferredAt: "2026-08-04T00:01:00.000Z",
        },
        evening: { consecutiveFailureCount: 0, consecutiveNoDataCount: 0, health: { state: "unobserved", causes: [] } },
      },
    }), "utf8");

    await new AtomicPipelineStatusWriter(statusPath, "run-morning").write({
      period: "morning",
      outcome: "running",
      startedAt: "2026-08-06T00:00:00.000Z",
      targetDate: "2026-08-06",
      counts: {},
    });

    const document = JSON.parse(await readFile(statusPath, "utf8"));
    expect(document.definitionsVersion).toBe(3);
    expect(document.definitionsLabel).toBe("2026-08-05/v3-transfer-observation");
    expect(document.lastDefinitionsTransition).toEqual({
      fromVersion: 1,
      toVersion: 3,
      changedAt: "2026-08-06T00:00:00.000Z",
    });
    expect(document.periods.morning).toMatchObject({
      consecutiveFailureCount: 0,
      consecutiveNoDataCount: 0,
      health: { state: "unobserved", causes: [] },
    });
    expect(document.periods.morning).not.toHaveProperty("lastTerminal");
    expect(document.periods.morning).not.toHaveProperty("lastDoneAt");
    expect(document.periods.morning).not.toHaveProperty("lastTransferredAt");
  });

  it("does not overwrite a status written under a newer definition", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-status-"));
    temporaryDirectories.push(directory);
    const statusPath = path.join(directory, "pipeline-status.json");
    const source = JSON.stringify({
      schemaVersion: 1,
      definitionsVersion: 4,
      definitionsLabel: "a future build's definitions",
      updatedAt: "2026-08-05T00:01:00.000Z",
      periods: {
        morning: { consecutiveFailureCount: 0, consecutiveNoDataCount: 0, health: { state: "unobserved", causes: [] } },
        evening: { consecutiveFailureCount: 0, consecutiveNoDataCount: 0, health: { state: "unobserved", causes: [] } },
      },
    });
    await writeFile(statusPath, source, "utf8");

    await expect(new AtomicPipelineStatusWriter(statusPath, "run-morning").write({
      period: "morning",
      outcome: "running",
      startedAt: "2026-08-06T00:00:00.000Z",
      targetDate: "2026-08-06",
      counts: {},
    })).rejects.toThrow("newer than this build");
    await expect(readFile(statusPath, "utf8")).resolves.toBe(source);
  });

  it("does not recover a type-invalid health field even when a valid terminal remains", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-status-"));
    temporaryDirectories.push(directory);
    const statusPath = path.join(directory, "pipeline-status.json");
    const source = JSON.stringify({
      schemaVersion: 1,
      definitionsVersion: 3,
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

  it("exposes only complete documents while repeatedly replacing the status file", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-status-"));
    temporaryDirectories.push(directory);
    const statusPath = path.join(directory, "pipeline-status.json");
    const writer = new AtomicPipelineStatusWriter(statusPath, "run-morning");
    const completeDocuments = new Set<string>();

    for (let index = 0; index < 40; index += 1) {
      await writer.write({
        period: "morning",
        outcome: index % 2 === 0 ? "completed:no-data" : "completed:transferred",
        startedAt: `2026-08-05T00:${String(index).padStart(2, "0")}:00.000Z`,
        completedAt: `2026-08-05T00:${String(index).padStart(2, "0")}:01.000Z`,
        targetDate: "2026-08-05",
        counts: { matchedFileCount: index, readLineCount: index + 1, windowedReadingCount: index + 2 },
      });
      const document = await readFile(statusPath, "utf8");
      JSON.parse(document);
      completeDocuments.add(document);
      expect((await stat(statusPath)).mode & 0o777).toBe(0o600);
      expect(await readdir(directory)).not.toContain("pipeline-status.json.temporary");
    }

    expect(completeDocuments.size).toBe(40);
    expect(JSON.parse(await readFile(statusPath, "utf8"))).toMatchObject({
      periods: { morning: { lastTerminal: { outcome: "completed:transferred" } } },
    });
  });

  it("commits the prepared document with rename instead of direct status writes", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-status-"));
    temporaryDirectories.push(directory);
    const statusPath = path.join(directory, "pipeline-status.json");
    const renameFile = vi.fn(async (temporaryPath: string, targetPath: string) => {
      await import("node:fs/promises").then(({ rename }) => rename(temporaryPath, targetPath));
    });
    const writer = new AtomicPipelineStatusWriter(statusPath, "run-morning", { renameFile });

    await writer.write({
      period: "morning",
      outcome: "running",
      startedAt: "2026-08-05T00:00:00.000Z",
      targetDate: "2026-08-05",
      counts: {},
    });

    expect(renameFile).toHaveBeenCalledTimes(1);
    expect(renameFile.mock.calls[0][0]).toMatch(/pipeline-status\.json\.\d+\.tmp$/u);
    expect(renameFile.mock.calls[0][1]).toBe(statusPath);
  });

  it("keeps the old complete document when rename is interrupted", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-status-"));
    temporaryDirectories.push(directory);
    const statusPath = path.join(directory, "pipeline-status.json");
    let renameCount = 0;
    const renameFile = vi.fn(async (temporaryPath: string, targetPath: string) => {
      renameCount += 1;
      if (renameCount === 2) {
        throw new Error("simulated stop around rename");
      }
      await import("node:fs/promises").then(({ rename }) => rename(temporaryPath, targetPath));
    });
    const writer = new AtomicPipelineStatusWriter(statusPath, "run-morning", { renameFile });
    await writer.write({
      period: "morning", outcome: "completed:no-data",
      startedAt: "2026-08-05T00:00:00.000Z", completedAt: "2026-08-05T00:01:00.000Z",
      targetDate: "2026-08-05", counts: { windowedReadingCount: 0 },
    });
    const oldDocument = await readFile(statusPath, "utf8");

    await expect(writer.write({
      period: "morning", outcome: "completed:transferred",
      startedAt: "2026-08-05T01:00:00.000Z", completedAt: "2026-08-05T01:01:00.000Z",
      targetDate: "2026-08-05", counts: { windowedReadingCount: 1 },
    })).rejects.toThrow("simulated stop around rename");
    await expect(readFile(statusPath, "utf8")).resolves.toBe(oldDocument);
  });

  it("shows the period lost update that the shared lease prevents", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-status-"));
    temporaryDirectories.push(directory);
    const statusPath = path.join(directory, "pipeline-status.json");
    const eveningWriter = new AtomicPipelineStatusWriter(statusPath, "run-evening");
    let interleaved = false;
    const morningRename = async (temporaryPath: string, targetPath: string) => {
      if (!interleaved) {
        interleaved = true;
        const morningDocument = await readFile(temporaryPath, "utf8");
        await eveningWriter.write({
          period: "evening", outcome: "completed:transferred",
          startedAt: "2026-08-05T20:00:00.000Z", completedAt: "2026-08-05T20:01:00.000Z",
          targetDate: "2026-08-05", counts: { windowedReadingCount: 1 },
        });
        await writeFile(temporaryPath, morningDocument, "utf8");
      }
      await import("node:fs/promises").then(({ rename }) => rename(temporaryPath, targetPath));
    };
    const morningWriter = new AtomicPipelineStatusWriter(statusPath, "run-morning", { renameFile: morningRename });

    await morningWriter.write({
      period: "morning", outcome: "completed:no-data",
      startedAt: "2026-08-05T07:00:00.000Z", completedAt: "2026-08-05T07:01:00.000Z",
      targetDate: "2026-08-05", counts: { windowedReadingCount: 0 },
    });

    const document = JSON.parse(await readFile(statusPath, "utf8"));
    expect(document.periods.morning.lastTerminal.outcome).toBe("completed:no-data");
    expect(document.periods.evening.lastTerminal).toBeUndefined();
  });

  describe("health evaluator (design §8.2)", () => {
    it("flags terminal-failure and v3-not-transferred together when a weight write is refused", async () => {
      const directory = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-status-"));
      temporaryDirectories.push(directory);
      const statusPath = path.join(directory, "pipeline-status.json");

      await new AtomicPipelineStatusWriter(statusPath, "run-morning").write({
        period: "morning",
        outcome: "failed:transfer",
        startedAt: "2026-08-05T00:00:00.000Z",
        completedAt: "2026-08-05T00:01:00.000Z",
        targetDate: "2026-08-05",
        counts: { windowedReadingCount: 1 },
        diagnostic: "no cells updated",
        v3: { input: "ready", windowedWeightCount: 1, transfer: { state: "not-written", transferredCellCount: 0 } },
      });

      const document = JSON.parse(await readFile(statusPath, "utf8"));
      expect(document.periods.morning.health).toEqual({
        state: "alert",
        causes: expect.arrayContaining(["terminal-failure", "v3-not-transferred"]),
      });
      expect(document.periods.morning.health.causes).toHaveLength(2);
    });

    it("does not flag v3-not-transferred when the window has no weight at all", async () => {
      const directory = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-status-"));
      temporaryDirectories.push(directory);
      const statusPath = path.join(directory, "pipeline-status.json");
      const writer = new AtomicPipelineStatusWriter(statusPath, "run-morning");

      for (let index = 0; index < 4; index += 1) {
        await writer.write({
          period: "morning",
          outcome: "completed:no-data",
          startedAt: `2026-08-0${index + 1}T00:00:00.000Z`,
          completedAt: `2026-08-0${index + 1}T00:01:00.000Z`,
          targetDate: `2026-08-0${index + 1}`,
          counts: { windowedReadingCount: 0 },
          v3: { input: "ready", windowedWeightCount: 0, transfer: { state: "not-attempted" } },
        });
      }

      const document = JSON.parse(await readFile(statusPath, "utf8"));
      expect(document.periods.morning.health).toEqual({
        state: "alert",
        causes: ["consecutive-no-data"],
      });
    });

    it("returns to normal once a weight write is confirmed with updated cells", async () => {
      const directory = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-status-"));
      temporaryDirectories.push(directory);
      const statusPath = path.join(directory, "pipeline-status.json");
      const writer = new AtomicPipelineStatusWriter(statusPath, "run-morning");

      await writer.write({
        period: "morning",
        outcome: "failed:transfer",
        startedAt: "2026-08-05T00:00:00.000Z",
        completedAt: "2026-08-05T00:01:00.000Z",
        targetDate: "2026-08-05",
        counts: { windowedReadingCount: 1 },
        v3: { input: "ready", windowedWeightCount: 1, transfer: { state: "unknown" } },
      });
      await writer.write({
        period: "morning",
        outcome: "completed:transferred",
        startedAt: "2026-08-06T00:00:00.000Z",
        completedAt: "2026-08-06T00:01:00.000Z",
        targetDate: "2026-08-06",
        counts: { windowedReadingCount: 1 },
        v3: { input: "ready", windowedWeightCount: 1, transfer: { state: "written", transferredCellCount: 5 } },
      });

      const document = JSON.parse(await readFile(statusPath, "utf8"));
      expect(document.periods.morning.health).toEqual({ state: "normal", causes: [] });
    });

    it("flags v1-stale on a failing run that leaves lastDoneAt untouched", async () => {
      const directory = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-status-"));
      temporaryDirectories.push(directory);
      const statusPath = path.join(directory, "pipeline-status.json");
      const writer = new AtomicPipelineStatusWriter(statusPath, "run-morning");

      await writer.write({
        period: "morning",
        outcome: "completed:transferred",
        startedAt: "2026-08-01T00:00:00.000Z",
        completedAt: "2026-08-01T00:01:00.000Z",
        targetDate: "2026-08-01",
        counts: { windowedReadingCount: 1 },
        v3: { input: "ready", windowedWeightCount: 1, transfer: { state: "written", transferredCellCount: 1 } },
      });
      await writer.write({
        period: "morning",
        outcome: "failed:input-missing",
        startedAt: "2026-08-04T00:00:00.000Z",
        completedAt: "2026-08-04T00:01:00.000Z",
        targetDate: "2026-08-04",
        counts: {},
        v3: { input: "unavailable", transfer: { state: "not-attempted" } },
      });

      const document = JSON.parse(await readFile(statusPath, "utf8"));
      expect(document.periods.morning.lastDoneAt).toBe("2026-08-01T00:01:00.000Z");
      expect(document.periods.morning.health).toEqual({
        state: "alert",
        causes: expect.arrayContaining(["terminal-failure", "v1-stale"]),
      });
      expect(document.periods.morning.health.causes).toHaveLength(2);
    });
  });
});
