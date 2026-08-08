import { describe, expect, it } from "vitest";

import {
  DangerousPrefixError,
  resolveInstallationPaths,
} from "../../src/installation/paths.js";

describe("resolveInstallationPaths", () => {
  it("resolves the binary under prefix and everything else under home", () => {
    const paths = resolveInstallationPaths({
      home: "/Users/example",
      prefix: "/Users/example/.local",
    });

    expect(paths.binDir).toBe("/Users/example/.local/bin");
    expect(paths.binaryPath).toBe("/Users/example/.local/bin/scale2sheet");
    expect(paths.configDir).toBe("/Users/example/.config/scale2sheet");
    expect(paths.settingsPath).toBe("/Users/example/.config/scale2sheet/settings.json");
    expect(paths.manifestPath).toBe("/Users/example/.config/scale2sheet/install-manifest.json");
    expect(paths.activeRunPath).toBe("/Users/example/.config/scale2sheet/active-run.json");
    expect(paths.pipelineStatusPath).toBe("/Users/example/.config/scale2sheet/pipeline-status.json");
    expect(paths.launchAgentsDir).toBe("/Users/example/Library/LaunchAgents");
    expect(paths.morningPlistPath).toBe(
      "/Users/example/Library/LaunchAgents/jp.seijin.kappa.scale-pipeline.morning.plist",
    );
    expect(paths.eveningPlistPath).toBe(
      "/Users/example/Library/LaunchAgents/jp.seijin.kappa.scale-pipeline.evening.plist",
    );
    expect(paths.logDir).toBe("/Users/example/Library/Logs/scale-pipeline");
    expect(paths.morningLogPath).toBe("/Users/example/Library/Logs/scale-pipeline/morning.log");
    expect(paths.morningErrLogPath).toBe("/Users/example/Library/Logs/scale-pipeline/morning.err.log");
    expect(paths.eveningLogPath).toBe("/Users/example/Library/Logs/scale-pipeline/evening.log");
    expect(paths.eveningErrLogPath).toBe("/Users/example/Library/Logs/scale-pipeline/evening.err.log");
  });

  it("does not let --prefix move config, log, or plist paths (design §配置)", () => {
    const withDefaultPrefix = resolveInstallationPaths({
      home: "/Users/example",
      prefix: "/Users/example/.local",
    });
    const withCustomPrefix = resolveInstallationPaths({
      home: "/Users/example",
      prefix: "/opt/scale2sheet",
    });

    expect(withCustomPrefix.configDir).toBe(withDefaultPrefix.configDir);
    expect(withCustomPrefix.logDir).toBe(withDefaultPrefix.logDir);
    expect(withCustomPrefix.launchAgentsDir).toBe(withDefaultPrefix.launchAgentsDir);
    expect(withCustomPrefix.binaryPath).toBe("/opt/scale2sheet/bin/scale2sheet");
  });

  it("normalizes a relative or trailing-slash prefix to an absolute, clean path", () => {
    const paths = resolveInstallationPaths({
      home: "/Users/example",
      prefix: "/Users/example/.local/",
    });
    expect(paths.prefix).toBe("/Users/example/.local");

    const dotted = resolveInstallationPaths({
      home: "/Users/example",
      prefix: "/Users/example/sub/../.local",
    });
    expect(dotted.prefix).toBe("/Users/example/.local");
  });

  it("expands a leading ~ against home", () => {
    const paths = resolveInstallationPaths({
      home: "/Users/example",
      prefix: "~/.local",
    });
    expect(paths.prefix).toBe("/Users/example/.local");
  });

  it.each([
    "/",
    "/usr",
    "/bin",
    "/sbin",
    "/etc",
    "/System",
    "/Library",
    "/Users/example",
  ])("rejects the dangerous prefix %s", (dangerousPrefix) => {
    expect(() => resolveInstallationPaths({ home: "/Users/example", prefix: dangerousPrefix }))
      .toThrow(DangerousPrefixError);
  });

  it("accepts $HOME/.local even though $HOME itself is rejected (boundary)", () => {
    expect(() =>
      resolveInstallationPaths({ home: "/Users/example", prefix: "/Users/example/.local" }),
    ).not.toThrow();
  });

  it("accepts an ordinary temporary directory prefix", () => {
    expect(() =>
      resolveInstallationPaths({ home: "/Users/example", prefix: "/private/tmp/scale2sheet-test" }),
    ).not.toThrow();
  });

  it("rejects a dangerous prefix given with a trailing slash or relative segments", () => {
    expect(() => resolveInstallationPaths({ home: "/Users/example", prefix: "/usr/" }))
      .toThrow(DangerousPrefixError);
    expect(() => resolveInstallationPaths({ home: "/Users/example", prefix: "/usr/../usr" }))
      .toThrow(DangerousPrefixError);
  });
});
