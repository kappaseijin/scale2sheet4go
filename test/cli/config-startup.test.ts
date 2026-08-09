import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class FakeConfigError extends Error {}
  return {
    acquireRunLease: vi.fn(),
    loadConfig: vi.fn(),
    requireGoogleSheetsConfig: vi.fn(),
    runPipeline: vi.fn(),
    resolvePipelineSettings: vi.fn(),
    syncMeasurements: vi.fn(),
    requireSourceConfig: vi.fn(),
    startScheduler: vi.fn(),
    statusWriter: vi.fn(),
    notifier: vi.fn(),
    FakeConfigError,
  };
});
vi.mock("../../src/config/index.js", () => ({
  ConfigError: mocks.FakeConfigError,
  loadConfig: mocks.loadConfig,
  requireGoogleFitConfig: vi.fn(),
  requireGoogleSheetsConfig: mocks.requireGoogleSheetsConfig,
}));

vi.mock("../../src/scheduler/index.js", () => ({
  acquireRunLease: mocks.acquireRunLease,
  startScheduler: mocks.startScheduler,
}));

vi.mock("../../src/auth/index.js", () => ({ runGoogleFitAuthFlow: vi.fn() }));
vi.mock("../../src/service/index.js", () => ({
  buildLatestMeasurementSet: vi.fn(),
  requireSourceConfig: mocks.requireSourceConfig,
  syncMeasurements: mocks.syncMeasurements,
  transferLatestMeasurementSet: vi.fn(),
}));
vi.mock("../../src/pipeline/pipeline.js", () => ({ runPipeline: mocks.runPipeline }));
vi.mock("../../src/pipeline/settings.js", () => ({ resolvePipelineSettings: mocks.resolvePipelineSettings }));
vi.mock("../../src/pipeline/status.js", () => ({
  AtomicPipelineStatusWriter: mocks.statusWriter,
}));
vi.mock("../../src/pipeline/notifier.js", () => ({ MacOsNotifier: mocks.notifier }));

import { runCli } from "../../src/cli/index.js";

describe("Google Sheets config is required at startup (#47/#51 follow-up)", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("run: fails before reading any measurements when sheets config is missing, even on a no-data window", async () => {
    const config = {
      timeZone: "Asia/Tokyo",
      defaultSource: "scale-exporter" as const,
      scaleExporter: { outputDir: "/tmp/exports" },
      scheduler: { morningCron: "0 7 * * *", eveningCron: "0 21 * * *" },
    };
    mocks.loadConfig.mockReturnValue(config);
    mocks.requireGoogleSheetsConfig.mockImplementation(() => {
      throw new mocks.FakeConfigError("sheets config missing");
    });

    await runCli(["node", "scale2sheet", "run", "--period", "morning"]);

    expect(process.exitCode).toBe(1);
    expect(mocks.syncMeasurements).not.toHaveBeenCalled();
    process.exitCode = 0;
  });

  it("pipeline: fails before acquiring a run lease when sheets config is missing, even on a no-data window", async () => {
    mocks.loadConfig.mockReturnValue({ timeZone: "Asia/Tokyo" });
    mocks.resolvePipelineSettings.mockReturnValue({
      outputDir: "/tmp/exports",
      timeZone: "Asia/Tokyo",
    });
    mocks.requireGoogleSheetsConfig.mockImplementation(() => {
      throw new mocks.FakeConfigError("sheets config missing");
    });

    await runCli(["node", "scale2sheet", "pipeline", "--period", "morning"]);

    expect(process.exitCode).toBe(1);
    expect(mocks.acquireRunLease).not.toHaveBeenCalled();
    expect(mocks.runPipeline).not.toHaveBeenCalled();
    process.exitCode = 0;
  });

  it("serve: fails before acquiring the serve lease when sheets config is missing", async () => {
    mocks.loadConfig.mockReturnValue({
      timeZone: "Asia/Tokyo",
      defaultSource: "scale-exporter" as const,
      scaleExporter: { outputDir: "/tmp/exports" },
      scheduler: { morningCron: "0 7 * * *", eveningCron: "0 21 * * *" },
    });
    mocks.requireGoogleSheetsConfig.mockImplementation(() => {
      throw new mocks.FakeConfigError("sheets config missing");
    });

    await runCli(["node", "scale2sheet", "serve"]);

    expect(process.exitCode).toBe(1);
    expect(mocks.acquireRunLease).not.toHaveBeenCalled();
    expect(mocks.startScheduler).not.toHaveBeenCalled();
    process.exitCode = 0;
  });

  it.each(["scale-exporter", "google-fit", "apple-health"] as const)(
    "serve: validates the %s source's own config specifically, not always the default source",
    async (source) => {
      const config = {
        timeZone: "Asia/Tokyo",
        defaultSource: "scale-exporter" as const,
        scaleExporter: { outputDir: "/tmp/exports" },
        scheduler: { morningCron: "0 7 * * *", eveningCron: "0 21 * * *" },
      };
      mocks.loadConfig.mockReturnValue(config);
      mocks.requireSourceConfig.mockImplementation(() => {
        throw new mocks.FakeConfigError(`${source} config missing`);
      });

      await runCli(["node", "scale2sheet", "serve", "--source", source]);

      // Argument-matching, not just call-count: a mutation that always
      // forwards the default source (or any fixed source) regardless of
      // --source would still be "called", but with the wrong argument.
      expect(mocks.requireSourceConfig).toHaveBeenCalledWith(config, source);
      expect(process.exitCode).toBe(1);
      expect(mocks.acquireRunLease).not.toHaveBeenCalled();
      expect(mocks.startScheduler).not.toHaveBeenCalled();
      process.exitCode = 0;
    },
  );

  it.each(["scale-exporter", "google-fit", "apple-health"] as const)(
    "run: validates the %s source's own config specifically, not always the default source",
    async (source) => {
      const config = {
        timeZone: "Asia/Tokyo",
        defaultSource: "scale-exporter" as const,
        scaleExporter: { outputDir: "/tmp/exports" },
        scheduler: { morningCron: "0 7 * * *", eveningCron: "0 21 * * *" },
      };
      mocks.loadConfig.mockReturnValue(config);
      mocks.requireSourceConfig.mockImplementation(() => {
        throw new mocks.FakeConfigError(`${source} config missing`);
      });

      await runCli(["node", "scale2sheet", "run", "--period", "morning", "--source", source]);

      expect(mocks.requireSourceConfig).toHaveBeenCalledWith(config, source);
      expect(process.exitCode).toBe(1);
      expect(mocks.syncMeasurements).not.toHaveBeenCalled();
      process.exitCode = 0;
    },
  );
});
