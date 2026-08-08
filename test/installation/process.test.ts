import { describe, expect, it } from "vitest";

import { LaunchctlAdapter, type ProcessRunner } from "../../src/installation/process.js";

function fakeRunner(
  responses: Record<string, { readonly exitCode: number; readonly timedOut?: boolean; readonly stderr?: string }>,
): { readonly runner: ProcessRunner; readonly calls: string[][] } {
  const calls: string[][] = [];
  const runner: ProcessRunner = async (command, args) => {
    calls.push([command, ...args]);
    const key = args.join(" ");
    const response = responses[key] ?? { exitCode: 1, stderr: `no fixture for: ${key}` };
    return {
      exitCode: response.exitCode,
      stdout: "",
      stderr: response.stderr ?? "",
      timedOut: response.timedOut ?? false,
    };
  };
  return { runner, calls };
}

describe("LaunchctlAdapter.isRegistered", () => {
  it("reports registered on exit code 0, regardless of stdout content", async () => {
    const { runner } = fakeRunner({ "print gui/501/jp.example.label": { exitCode: 0 } });
    const adapter = new LaunchctlAdapter(runner);

    await expect(adapter.isRegistered("gui/501", "jp.example.label")).resolves.toBe(true);
  });

  it("reports unregistered on any non-zero exit code, regardless of stdout content", async () => {
    const { runner } = fakeRunner({ "print gui/501/jp.example.label": { exitCode: 113 } });
    const adapter = new LaunchctlAdapter(runner);

    await expect(adapter.isRegistered("gui/501", "jp.example.label")).resolves.toBe(false);
  });

  it("N-7: does not change its answer when the output text contradicts the exit code", async () => {
    /**
     * Exit code says registered (0) but the text says otherwise, and vice versa.
     * Any implementation that parses stdout for the answer gets both of these
     * backwards; only an exit-code-only implementation gets both right.
     */
    const exitZeroButTextSaysNotLoaded = new LaunchctlAdapter(async () => ({
      exitCode: 0,
      stdout: "state = not running\nlast exit code = 78 (not loaded)",
      stderr: "",
      timedOut: false,
    }));
    const exitNonZeroButTextSaysRunning = new LaunchctlAdapter(async () => ({
      exitCode: 1,
      stdout: JSON.stringify({ state: "running", status: "registered" }),
      stderr: "",
      timedOut: false,
    }));

    await expect(exitZeroButTextSaysNotLoaded.isRegistered("gui/501", "jp.example.label")).resolves.toBe(true);
    await expect(exitNonZeroButTextSaysRunning.isRegistered("gui/501", "jp.example.label")).resolves.toBe(false);
  });
});

describe("LaunchctlAdapter.bootout", () => {
  it("skips when the label is not registered, without invoking bootout", async () => {
    const { runner, calls } = fakeRunner({ "print gui/501/jp.example.label": { exitCode: 1 } });
    const adapter = new LaunchctlAdapter(runner);

    await expect(adapter.bootout("gui/501", "jp.example.label")).resolves.toEqual({
      outcome: "skipped",
      message: "not loaded",
    });
    expect(calls).toEqual([["launchctl", "print", "gui/501/jp.example.label"]]);
  });

  it("reports done when a registered label is booted out successfully", async () => {
    const { runner } = fakeRunner({
      "print gui/501/jp.example.label": { exitCode: 0 },
      "bootout gui/501/jp.example.label": { exitCode: 0 },
    });
    const adapter = new LaunchctlAdapter(runner);

    await expect(adapter.bootout("gui/501", "jp.example.label")).resolves.toEqual({
      outcome: "done",
      message: "",
    });
  });

  it("reports failed with the launchctl message when bootout exits non-zero", async () => {
    const { runner } = fakeRunner({
      "print gui/501/jp.example.label": { exitCode: 0 },
      "bootout gui/501/jp.example.label": { exitCode: 1, stderr: "Operation not permitted" },
    });
    const adapter = new LaunchctlAdapter(runner);

    await expect(adapter.bootout("gui/501", "jp.example.label")).resolves.toEqual({
      outcome: "failed",
      message: "Operation not permitted",
    });
  });

  it("classifies a timeout as failed rather than hanging the caller", async () => {
    const { runner } = fakeRunner({ "print gui/501/jp.example.label": { exitCode: 0 } });
    const timingOutRunner: ProcessRunner = async (cmd, args) => {
      if (args[0] === "bootout") {
        return { exitCode: 1, stdout: "", stderr: "", timedOut: true };
      }
      return runner(cmd, args);
    };
    const adapter = new LaunchctlAdapter(timingOutRunner);

    await expect(adapter.bootout("gui/501", "jp.example.label")).resolves.toEqual({
      outcome: "failed",
      message: "timeout",
    });
  });
});

describe("LaunchctlAdapter.bootstrap", () => {
  it("reports done on exit code 0", async () => {
    const { runner } = fakeRunner({ "bootstrap gui/501 /tmp/example.plist": { exitCode: 0 } });
    const adapter = new LaunchctlAdapter(runner);

    await expect(adapter.bootstrap("gui/501", "/tmp/example.plist")).resolves.toEqual({
      outcome: "done",
      message: "",
    });
  });

  it("reports failed with the launchctl message on non-zero exit", async () => {
    const { runner } = fakeRunner({
      "bootstrap gui/501 /tmp/example.plist": { exitCode: 1, stderr: "Input/output error" },
    });
    const adapter = new LaunchctlAdapter(runner);

    await expect(adapter.bootstrap("gui/501", "/tmp/example.plist")).resolves.toEqual({
      outcome: "failed",
      message: "Input/output error",
    });
  });

  it("classifies a timeout as failed", async () => {
    const timingOutRunner: ProcessRunner = async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "",
      timedOut: true,
    });
    const adapter = new LaunchctlAdapter(timingOutRunner);

    await expect(adapter.bootstrap("gui/501", "/tmp/example.plist")).resolves.toEqual({
      outcome: "failed",
      message: "timeout",
    });
  });
});
