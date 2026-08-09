import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acquireRunLease: vi.fn(),
  loadConfig: vi.fn(),
  runPipeline: vi.fn(),
  resolvePipelineSettings: vi.fn(),
  startScheduler: vi.fn(),
  statusWriter: vi.fn(),
  notifier: vi.fn(),
  readStableInputSnapshot: vi.fn(),
}));

vi.mock("../../src/config/index.js", () => ({
  ConfigError: class ConfigError extends Error {},
  loadConfig: mocks.loadConfig,
  requireGoogleFitConfig: vi.fn(),
  requireGoogleSheetsConfig: vi.fn().mockReturnValue({
    applicationCredentialsPath: "/tmp/credentials.json",
    spreadsheetId: "test-sheet",
    sheetName: "sheet",
  }),
}));

vi.mock("../../src/scheduler/index.js", () => ({
  acquireRunLease: mocks.acquireRunLease,
  startScheduler: mocks.startScheduler,
}));

vi.mock("../../src/auth/index.js", () => ({ runGoogleFitAuthFlow: vi.fn() }));
vi.mock("../../src/service/index.js", () => ({
  syncMeasurements: vi.fn(),
  requireSourceConfig: vi.fn(),
}));
vi.mock("../../src/pipeline/pipeline.js", () => ({ runPipeline: mocks.runPipeline }));
vi.mock("../../src/pipeline/settings.js", () => ({ resolvePipelineSettings: mocks.resolvePipelineSettings }));
vi.mock("../../src/pipeline/status.js", () => ({
  AtomicPipelineStatusWriter: mocks.statusWriter,
}));
vi.mock("../../src/pipeline/notifier.js", () => ({ MacOsNotifier: mocks.notifier }));
vi.mock("../../src/pipeline/input-snapshot.js", () => ({ readStableInputSnapshot: mocks.readStableInputSnapshot }));

import { runCli } from "../../src/cli/index.js";

describe("serve command", () => {
  it("acquires the shared serve lease before scheduling", async () => {
    const lease = { ownerToken: "pipeline-run-token", release: vi.fn(), startStopPolling: vi.fn() };
    const config = {
      timeZone: "Asia/Tokyo",
      defaultSource: "scale-exporter" as const,
      scaleExporter: { outputDir: "/tmp/exports" },
      scheduler: { morningCron: "0 7 * * *", eveningCron: "0 21 * * *" },
    };
    mocks.loadConfig.mockReturnValue(config);
    mocks.acquireRunLease.mockResolvedValue(lease);

    await runCli(["node", "scale2sheet", "serve"]);

    expect(mocks.acquireRunLease).toHaveBeenCalledWith({ kind: "serve" });
    expect(mocks.startScheduler).toHaveBeenCalledWith(
      expect.objectContaining({ config, source: "scale-exporter", lease }),
    );
  });

  it("wires status and notification ports into a pipeline run", async () => {
    const lease = { ownerToken: "pipeline-run-token", release: vi.fn(), startStopPolling: vi.fn() };
    const statusWriter = { write: vi.fn() };
    const notifier = { notify: vi.fn() };
    mocks.loadConfig.mockReturnValue({ timeZone: "Asia/Tokyo" });
    mocks.resolvePipelineSettings.mockReturnValue({
      outputDir: "/tmp/exports",
      timeZone: "Asia/Tokyo",
    });
    mocks.acquireRunLease.mockResolvedValue(lease);
    mocks.statusWriter.mockImplementation(function StatusWriter() {
      return statusWriter;
    });
    mocks.notifier.mockImplementation(function Notifier() {
      return notifier;
    });
    mocks.runPipeline.mockResolvedValue({ exitCode: 0, outcome: "completed:no-data" });

    await runCli(["node", "scale2sheet", "pipeline", "--period", "morning"]);

    expect(mocks.statusWriter).toHaveBeenCalledWith(
      expect.stringMatching(/pipeline-status\.json$/),
      lease.ownerToken,
    );
    expect(mocks.notifier).toHaveBeenCalledWith("/usr/bin/osascript");
    expect(mocks.runPipeline).toHaveBeenCalledWith(
      expect.objectContaining({ notifier, period: "morning", statusWriter }),
    );
    expect(lease.release).toHaveBeenCalledOnce();
  });

  it("uses an explicit pipeline target date for both input selection and status", async () => {
    const lease = { ownerToken: "pipeline-run-token", release: vi.fn(), startStopPolling: vi.fn() };
    mocks.loadConfig.mockReturnValue({ timeZone: "Asia/Tokyo" });
    mocks.resolvePipelineSettings.mockReturnValue({ outputDir: "/tmp/exports", timeZone: "Asia/Tokyo" });
    mocks.acquireRunLease.mockResolvedValue(lease);
    mocks.statusWriter.mockImplementation(function StatusWriter() { return { write: vi.fn() }; });
    mocks.notifier.mockImplementation(function Notifier() { return { notify: vi.fn() }; });
    mocks.readStableInputSnapshot.mockResolvedValue({ matchedFileCount: 0, readLineCount: 0, readings: [] });
    mocks.runPipeline.mockImplementation(async (options: { readInput: () => Promise<unknown> }) => {
      await options.readInput();
      return { exitCode: 0, outcome: "completed:no-data" };
    });

    await runCli(["node", "scale2sheet", "pipeline", "--period", "morning", "--date", "2026-08-09"]);

    expect(mocks.runPipeline).toHaveBeenCalledWith(
      expect.objectContaining({ targetDate: "2026-08-09" }),
    );
    expect(mocks.readStableInputSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ targetDate: "2026-08-09" }),
    );
  });
});
