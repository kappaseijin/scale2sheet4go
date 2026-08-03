import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acquireRunLease: vi.fn(),
  loadConfig: vi.fn(),
  startScheduler: vi.fn(),
}));

vi.mock("../../src/config/index.js", () => ({
  ConfigError: class ConfigError extends Error {},
  loadConfig: mocks.loadConfig,
  requireGoogleFitConfig: vi.fn(),
}));

vi.mock("../../src/scheduler/index.js", () => ({
  acquireRunLease: mocks.acquireRunLease,
  startScheduler: mocks.startScheduler,
}));

vi.mock("../../src/auth/index.js", () => ({ runGoogleFitAuthFlow: vi.fn() }));
vi.mock("../../src/service/index.js", () => ({ syncMeasurements: vi.fn() }));

import { runCli } from "../../src/cli/index.js";

describe("serve command", () => {
  it("acquires the shared serve lease before scheduling", async () => {
    const lease = { release: vi.fn(), startStopPolling: vi.fn() };
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
});
