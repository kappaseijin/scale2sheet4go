import { afterEach, describe, expect, it, vi } from "vitest";

import { GoogleSheetsOperationTimeoutError } from "../../src/sheets/index.js";

const mocks = vi.hoisted(() => ({
  schedule: vi.fn(),
  syncMeasurements: vi.fn(),
}));

vi.mock("node-cron", () => ({
  default: { schedule: mocks.schedule },
}));
vi.mock("../../src/service/index.js", () => ({
  syncMeasurements: mocks.syncMeasurements,
}));

import { startScheduler } from "../../src/scheduler/index.js";

afterEach(() => {
  vi.clearAllMocks();
});

describe("startScheduler", () => {
  it("P-10: logs one Sheets timeout and keeps the scheduler alive", async () => {
    const callbacks: Array<() => void> = [];
    const tasks: Array<{ stop: ReturnType<typeof vi.fn> }> = [];
    mocks.schedule.mockImplementation((_expression: string, callback: () => void) => {
      callbacks.push(callback);
      const task = { stop: vi.fn() };
      tasks.push(task);
      return task;
    });
    const timeout = new GoogleSheetsOperationTimeoutError(
      "date-column-read",
      30_000,
      "not-attempted",
    );
    mocks.syncMeasurements.mockRejectedValue(timeout);
    const logger = { log: vi.fn(), error: vi.fn() };
    const config = {
      timeZone: "Asia/Tokyo",
      scheduler: { morningCron: "0 7 * * *", eveningCron: "0 21 * * *" },
    };

    startScheduler({ config: config as never, source: "scale-exporter", logger });
    callbacks[0]!();

    await vi.waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith(timeout);
    });

    expect(mocks.syncMeasurements).toHaveBeenCalledWith({
      config,
      source: "scale-exporter",
      period: "morning",
    });
    expect(tasks).toHaveLength(2);
    expect(tasks.flatMap((task) => task.stop.mock.calls)).toEqual([]);
  });
});
