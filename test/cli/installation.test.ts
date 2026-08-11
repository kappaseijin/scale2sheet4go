import { mkdir, mkdtemp, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Command } from "commander";
import { afterEach, describe, expect, it } from "vitest";

import {
  defaultInstallationCliDeps,
  registerInstallationCommands,
  runInstallCommand,
  runUninstallCommand,
  type InstallationCliDeps,
} from "../../src/cli/installation.js";
import { defaultExecutorDeps, type ExecutorDeps } from "../../src/installation/executor.js";
import { readManifest, writeManifest } from "../../src/installation/manifest.js";
import { acquireRunLease } from "../../src/scheduler/run-lease.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempHome(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-cli-installation-"));
  temporaryDirectories.push(dir);
  return dir;
}

/** Fake launchctl/replace-binary deps so tests never touch real OS state. */
function fakeExecutorDeps(overrides: Partial<ExecutorDeps> = {}): ExecutorDeps {
  return {
    ...defaultExecutorDeps,
    bootout: async () => ({ outcome: "skipped", message: "not loaded" }),
    bootstrap: async () => ({ outcome: "done", message: "" }),
    ...overrides,
  };
}

async function makeDeps(home: string, overrides: Partial<InstallationCliDeps> = {}): Promise<InstallationCliDeps> {
  const binaryFixture = path.join(home, "fixture-binary");
  await writeFile(binaryFixture, "#!/bin/sh\necho fixture\n");
  return {
    home,
    binaryCopySource: { resolve: async () => binaryFixture },
    executorDeps: fakeExecutorDeps(),
    acquireLease: acquireRunLease,
    logger: { log: () => {}, error: () => {} },
    ...overrides,
  };
}

describe("CLI: install/uninstall registration (Task 7, design §外部インターフェース)", () => {
  it("exposes doctor but not Slice 5 purge options (S-9)", () => {
    const program = new Command();
    registerInstallationCommands(program);

    const names = program.commands.map((command) => command.name());
    expect(names).toContain("install");
    expect(names).toContain("uninstall");
    expect(names).toContain("doctor");

    const uninstall = program.commands.find((command) => command.name() === "uninstall");
    const optionFlags = uninstall?.options.map((option) => option.long) ?? [];
    expect(optionFlags).not.toContain("--purge");
    expect(optionFlags).not.toContain("--wipe");
    expect(optionFlags).not.toContain("--archive");
    expect(optionFlags).not.toContain("--yes");
  });

  it("registers install with --prefix, --launchd, --dry-run, --force", () => {
    const program = new Command();
    registerInstallationCommands(program);

    const install = program.commands.find((command) => command.name() === "install");
    const optionFlags = install?.options.map((option) => option.long) ?? [];
    expect(optionFlags).toEqual(expect.arrayContaining(["--prefix", "--launchd", "--dry-run", "--force"]));
  });
});

describe("runInstallCommand (design §インストールフロー)", () => {
  it("rejects an empty HOME before printing or applying a launchd plan", async () => {
    const home = await makeTempHome();
    const lines: string[] = [];
    let leaseCalls = 0;
    const deps = await makeDeps(home, {
      acquireLease: async () => {
        leaseCalls += 1;
        throw new Error("lease must not be acquired");
      },
      logger: { log: (line: string) => lines.push(line), error: (line: string) => lines.push(line) },
    });

    const exitCode = await runInstallCommand(
      { prefix: "~/.local", launchd: true, dryRun: true, force: true },
      deps,
    );

    expect(exitCode).toBe(1);
    expect(lines.some((line) => line.startsWith("[planned]"))).toBe(false);
    expect(lines).toContain("failed:launchd-not-ready");
    expect(leaseCalls).toBe(0);
    await expect(stat(path.join(home, ".config", "scale2sheet"))).rejects.toThrow();
  });

  it("dry-run plans without creating any file (design §計画: 生成しない)", async () => {
    const home = await makeTempHome();
    const lines: string[] = [];
    const deps = await makeDeps(home, { logger: { log: (line: string) => lines.push(line), error: () => {} } });

    const exitCode = await runInstallCommand(
      { prefix: "~/.local", launchd: false, dryRun: true, force: false },
      deps,
    );

    expect(exitCode).toBe(0);
    expect(lines.some((line) => line.startsWith("[planned]"))).toBe(true);
    await expect(stat(path.join(home, ".config", "scale2sheet"))).rejects.toThrow();
    await expect(stat(path.join(home, ".local", "bin", "scale2sheet"))).rejects.toThrow();
  });

  it("installs the binary and writes an installed manifest (no --launchd)", async () => {
    const home = await makeTempHome();
    const deps = await makeDeps(home);

    const exitCode = await runInstallCommand(
      { prefix: "~/.local", launchd: false, dryRun: false, force: false },
      deps,
    );

    expect(exitCode).toBe(0);
    const binaryPath = path.join(home, ".local", "bin", "scale2sheet");
    await expect(stat(binaryPath)).resolves.toBeDefined();

    const manifestPath = path.join(home, ".config", "scale2sheet", "install-manifest.json");
    const manifest = await readManifest(manifestPath);
    expect(manifest?.state).toBe("installed");
    expect(manifest?.["binary-path"]).toBe(binaryPath);
  });

  it("fails before touching the binary when a required auth file is missing (AC-04)", async () => {
    const home = await makeTempHome();
    await mkdir(path.join(home, ".config", "scale2sheet"), { recursive: true });
    await writeFile(
      path.join(home, ".config", "scale2sheet", "settings.json"),
      JSON.stringify({ source: "scale-exporter", "sheets-credentials": path.join(home, "missing-credentials.json") }),
    );
    const errors: string[] = [];
    const deps = await makeDeps(home, { logger: { log: () => {}, error: (line: string) => errors.push(line) } });

    const exitCode = await runInstallCommand(
      { prefix: "~/.local", launchd: false, dryRun: false, force: false },
      deps,
    );

    expect(exitCode).toBe(1);
    expect(errors.some((line) => line.includes("missing-credentials.json"))).toBe(true);
    await expect(stat(path.join(home, ".local", "bin", "scale2sheet"))).rejects.toThrow();
  });

  it("leaves an existing registration untouched when launchd readiness becomes blocked", async () => {
    const home = await makeTempHome();
    let bootoutCalls = 0;
    let bootstrapCalls = 0;
    const deps = await makeDeps(home, {
      executorDeps: fakeExecutorDeps({
        bootout: async () => {
          bootoutCalls += 1;
          return { outcome: "done", message: "" };
        },
        bootstrap: async () => {
          bootstrapCalls += 1;
          return { outcome: "done", message: "" };
        },
      }),
    });
    await runInstallCommand({ prefix: "~/.local", launchd: false, dryRun: false, force: false }, deps);
    const manifestPath = path.join(home, ".config", "scale2sheet", "install-manifest.json");
    const before = await readFile(manifestPath, "utf8");
    await unlink(path.join(home, ".config", "scale2sheet", "settings.json"));

    const exitCode = await runInstallCommand(
      { prefix: "~/.local", launchd: true, dryRun: false, force: true },
      deps,
    );

    expect(exitCode).toBe(1);
    expect(await readFile(manifestPath, "utf8")).toBe(before);
    expect(bootoutCalls).toBe(0);
    expect(bootstrapCalls).toBe(0);
  });
});

describe("runUninstallCommand (design §アンインストールフロー §既定)", () => {
  it("reports nothing to do when there is no manifest (AC-14)", async () => {
    const home = await makeTempHome();
    const lines: string[] = [];
    const deps = await makeDeps(home, { logger: { log: (line: string) => lines.push(line), error: () => {} } });

    const exitCode = await runUninstallCommand({ prefix: "~/.local", dryRun: false }, deps);

    expect(exitCode).toBe(0);
    expect(lines).toEqual(["nothing to do"]);
  });

  it("dry-run leaves the installed tree untouched (AC-19-adjacent, uninstall side)", async () => {
    const home = await makeTempHome();
    const deps = await makeDeps(home);
    await runInstallCommand({ prefix: "~/.local", launchd: false, dryRun: false, force: false }, deps);

    const binaryPath = path.join(home, ".local", "bin", "scale2sheet");
    const before = await readFile(binaryPath, "utf8");

    const lines: string[] = [];
    const exitCode = await runUninstallCommand(
      { prefix: "~/.local", dryRun: true },
      { ...deps, logger: { log: (line: string) => lines.push(line), error: () => {} } },
    );

    expect(exitCode).toBe(0);
    expect(lines.some((line) => line.startsWith("[planned]"))).toBe(true);
    await expect(readFile(binaryPath, "utf8")).resolves.toBe(before);
    await expect(stat(path.join(home, ".config", "scale2sheet", "install-manifest.json"))).resolves.toBeDefined();
  });

  it("removes the binary and the manifest itself without aborting mid-plan (regression: manifest self-removal)", async () => {
    const home = await makeTempHome();
    const deps = await makeDeps(home);
    await runInstallCommand({ prefix: "~/.local", launchd: false, dryRun: false, force: false }, deps);

    const binaryPath = path.join(home, ".local", "bin", "scale2sheet");
    const manifestPath = path.join(home, ".config", "scale2sheet", "install-manifest.json");

    const exitCode = await runUninstallCommand({ prefix: "~/.local", dryRun: false }, deps);

    expect(exitCode).toBe(0);
    await expect(stat(binaryPath)).rejects.toThrow();
    await expect(stat(manifestPath)).rejects.toThrow();
  });

  it("B-2 (reviewer, PR #139): completion output names the absolute paths left behind", async () => {
    const home = await makeTempHome();
    const lines: string[] = [];
    const deps = await makeDeps(home, { logger: { log: (line: string) => lines.push(line), error: () => {} } });
    await runInstallCommand({ prefix: "~/.local", launchd: false, dryRun: false, force: false }, deps);
    lines.length = 0;

    const exitCode = await runUninstallCommand({ prefix: "~/.local", dryRun: false }, deps);

    expect(exitCode).toBe(0);
    const configDir = path.join(home, ".config", "scale2sheet");
    const logDir = path.join(home, "Library", "Logs", "scale-pipeline");
    expect(lines.some((line) => line.includes(configDir))).toBe(true);
    expect(lines.some((line) => line.includes(logDir))).toBe(true);
  });

  it("B-2 (reviewer, PR #139): completion output mentions the leftover /tmp runtime artifact and that it holds no secrets", async () => {
    const home = await makeTempHome();
    const lines: string[] = [];
    const deps = await makeDeps(home, { logger: { log: (line: string) => lines.push(line), error: () => {} } });
    await runInstallCommand({ prefix: "~/.local", launchd: false, dryRun: false, force: false }, deps);
    lines.length = 0;

    const exitCode = await runUninstallCommand({ prefix: "~/.local", dryRun: false }, deps);

    expect(exitCode).toBe(0);
    expect(lines.some((line) => line.includes("/tmp"))).toBe(true);
  });

  it("B-2 (reviewer, PR #139): completion output shows the manual rebuild+purge command without running it", async () => {
    const home = await makeTempHome();
    const lines: string[] = [];
    const deps = await makeDeps(home, { logger: { log: (line: string) => lines.push(line), error: () => {} } });
    await runInstallCommand({ prefix: "~/.local", launchd: false, dryRun: false, force: false }, deps);
    lines.length = 0;

    const exitCode = await runUninstallCommand({ prefix: "~/.local", dryRun: false }, deps);

    expect(exitCode).toBe(0);
    expect(lines.some((line) => line.includes("npm run build:bun") && line.includes("uninstall --purge"))).toBe(true);
  });

  it("reports the complete uninstall operation and completion output through the CLI", async () => {
    const home = await makeTempHome();
    const configDir = path.join(home, ".config", "scale2sheet");
    const binaryPath = path.join(home, ".local", "bin", "scale2sheet");
    const plistPath = path.join(home, "Library", "LaunchAgents", "jp.seijin.scale2sheet.morning.plist");
    const manifestPath = path.join(configDir, "install-manifest.json");
    await mkdir(configDir, { recursive: true });
    const manifest = {
      "schema-version": 1,
      state: "installed",
      version: "0.1.0",
      prefix: path.join(home, ".local"),
      "binary-path": binaryPath,
      "config-dir": configDir,
      "log-dir": path.join(home, "Library", "Logs", "scale-pipeline"),
      launchd: {
        enabled: true,
        domain: "gui/501",
        labels: ["jp.seijin.scale2sheet.morning"],
        "plist-paths": [plistPath],
      },
      "applied-steps": [],
      "created-paths": [],
      "updated-at": "2026-08-11T10:00:00.000Z",
    } as const;
    await writeManifest(manifestPath, { ...manifest, state: "installing" });
    await writeManifest(manifestPath, manifest);
    const lines: string[] = [];
    const deps = await makeDeps(home, {
      logger: { log: (line: string) => lines.push(line), error: () => {} },
      executorDeps: fakeExecutorDeps({
        bootout: async () => ({ outcome: "done", message: "" }),
        logger: { log: (line: string) => lines.push(line) },
      }),
    });

    const exitCode = await runUninstallCommand({ prefix: "~/.local", dryRun: false }, deps);

    expect(exitCode).toBe(0);
    expect(lines).toEqual(expect.arrayContaining([
      "[done] bootout jp.seijin.scale2sheet.morning",
      `[done] remove-file ${plistPath}`,
        `[done] remove-file ${manifestPath}`,
        `[done] remove-file ${binaryPath}`,
        `uninstalled ${binaryPath}`,
        `  ${configDir}`,
      `  ${path.join(home, "Library", "Logs", "scale-pipeline")}`,
      "a runtime artifact with no secrets remains under /tmp; macOS cleans it up on its own.",
      "  npm run build:bun && ./dist/scale2sheet uninstall --purge",
    ]));
  });
});
