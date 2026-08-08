import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  syncMeasurements: vi.fn(),
}));

vi.mock("../../src/config/index.js", () => ({
  ConfigError: class ConfigError extends Error {},
  loadConfig: mocks.loadConfig,
  requireGoogleFitConfig: vi.fn(),
}));
vi.mock("../../src/service/index.js", () => ({
  syncMeasurements: mocks.syncMeasurements,
  buildLatestMeasurementSet: vi.fn(),
  transferLatestMeasurementSet: vi.fn(),
}));
vi.mock("../../src/auth/index.js", () => ({ runGoogleFitAuthFlow: vi.fn() }));

import { runCli } from "../../src/cli/index.js";

describe("run command exit codes (#79: argument errors distinct from input failures)", () => {
  afterEach(() => {
    process.exitCode = undefined;
    vi.clearAllMocks();
  });

  it("exits 2 when --period is omitted", async () => {
    await runCli(["node", "scale2sheet", "run"]);

    expect(process.exitCode).toBe(2);
    expect(mocks.syncMeasurements).not.toHaveBeenCalled();
  });

  it("exits 2 when --period is an invalid value", async () => {
    await runCli(["node", "scale2sheet", "run", "--period", "not-a-period"]);

    expect(process.exitCode).toBe(2);
    expect(mocks.syncMeasurements).not.toHaveBeenCalled();
  });

  it("does not set exit code 2 for a valid --period, distinguishing argument errors from input/transfer failures", async () => {
    mocks.loadConfig.mockReturnValue({
      timeZone: "Asia/Tokyo",
      defaultSource: "scale-exporter",
    });
    mocks.syncMeasurements.mockRejectedValue(new Error("Google Sheets API unavailable"));

    await expect(runCli(["node", "scale2sheet", "run", "--period", "morning"])).rejects.toThrow(
      "Google Sheets API unavailable",
    );

    // The failure must propagate (not be swallowed into some other exit
    // path) so Node's own uncaught-exception handling produces exit 1 at
    // the real entry point (src/index.ts has no wrapping try/catch around
    // runCli()). It must NOT be exit 2 — that would make argument errors
    // and input/transfer failures indistinguishable again, defeating #79.
    expect(process.exitCode).not.toBe(2);
  });

  it("exits 0, not 2, for run --help (a successful exit, not an argument error)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await runCli(["node", "scale2sheet", "run", "--help"]);
    } finally {
      logSpy.mockRestore();
    }

    expect(process.exitCode).toBe(0);
    expect(mocks.syncMeasurements).not.toHaveBeenCalled();
  });

  it("succeeds normally for a valid --period (no exit code override)", async () => {
    mocks.loadConfig.mockReturnValue({
      timeZone: "Asia/Tokyo",
      defaultSource: "scale-exporter",
    });
    mocks.syncMeasurements.mockResolvedValue(undefined);

    await runCli(["node", "scale2sheet", "run", "--period", "evening"]);

    expect(process.exitCode).not.toBe(2);
  });
});
