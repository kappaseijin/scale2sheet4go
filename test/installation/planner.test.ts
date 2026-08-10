import { afterEach, describe, expect, it, vi } from "vitest";

const MUTATING_FS_FUNCTIONS = ["mkdir", "writeFile", "rename", "rm", "unlink", "chmod", "copyFile"] as const;

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const mocked = { ...actual };
  for (const name of MUTATING_FS_FUNCTIONS) {
    mocked[name] = vi.fn(actual[name]) as never;
  }
  return mocked;
});

const fsPromises = await import("node:fs/promises");

import { DangerousPrefixError } from "../../src/installation/paths.js";
import {
  LaunchdNotReadyError,
  MissingAuthFilesError,
  planInstall,
  planUninstall,
} from "../../src/installation/planner.js";
import type { InstallManifest } from "../../src/installation/manifest.js";
import type { InstallOptions } from "../../src/installation/model.js";

const defaultInstallOptions: InstallOptions = {
  prefix: "/Users/example/.local",
  launchd: false,
  dryRun: false,
  force: false,
};

const installedManifest: InstallManifest = {
  "schema-version": 1,
  state: "installed",
  version: "0.1.0",
  prefix: "/Users/example/.local",
  "binary-path": "/Users/example/.local/bin/scale2sheet",
  "config-dir": "/Users/example/.config/scale2sheet",
  "log-dir": "/Users/example/Library/Logs/scale-pipeline",
  launchd: {
    enabled: true,
    domain: "gui/501",
    labels: [
      "jp.seijin.kappa.scale-pipeline.morning",
      "jp.seijin.kappa.scale-pipeline.evening",
    ],
    "plist-paths": [
      "/Users/example/Library/LaunchAgents/jp.seijin.kappa.scale-pipeline.morning.plist",
      "/Users/example/Library/LaunchAgents/jp.seijin.kappa.scale-pipeline.evening.plist",
    ],
  },
  "applied-steps": ["ensure-settings", "ensure-bin-directory", "replace-binary"],
  "created-paths": [
    "/Users/example/.config/scale2sheet",
    "/Users/example/.local/bin",
    "/Users/example/Library/Logs/scale-pipeline",
  ],
  "updated-at": "2026-07-29T09:10:44+09:00",
};

/** Every mutating fs/promises entry point, asserted to have made no calls during planning. */
function expectNoFsMutations(): void {
  for (const name of MUTATING_FS_FUNCTIONS) {
    expect(fsPromises[name]).not.toHaveBeenCalled();
  }
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("planInstall: side-effect-free planning", () => {
  it("calls no fs mutation while planning a fresh install", () => {

    planInstall({
      home: "/Users/example",
      options: defaultInstallOptions,
      currentManifest: undefined,
      settingsExists: false,
      missingAuthFiles: [],
      binarySource: "/Users/example/checkout/dist/scale2sheet",
    });

    expectNoFsMutations();
  });

  it("plans config, settings, bin, log, and binary replacement for a fresh install without --launchd", () => {
    const operations = planInstall({
      home: "/Users/example",
      options: defaultInstallOptions,
      currentManifest: undefined,
      settingsExists: false,
      missingAuthFiles: [],
      binarySource: "/Users/example/checkout/dist/scale2sheet",
    });

    expect(operations).toEqual([
      { kind: "ensure-directory", path: "/Users/example/.config/scale2sheet", mode: 0o700 },
      { kind: "ensure-settings", path: "/Users/example/.config/scale2sheet/settings.json" },
      { kind: "ensure-directory", path: "/Users/example/.local/bin", mode: 0o755 },
      { kind: "ensure-directory", path: "/Users/example/Library/Logs/scale-pipeline", mode: 0o700 },
      {
        kind: "replace-binary",
        source: "/Users/example/checkout/dist/scale2sheet",
        target: "/Users/example/.local/bin/scale2sheet",
      },
    ]);
  });

  it("makes zero plist/launchctl operations without --launchd (AC-05)", () => {
    const operations = planInstall({
      home: "/Users/example",
      options: defaultInstallOptions,
      currentManifest: undefined,
      settingsExists: false,
      missingAuthFiles: [],
      binarySource: "/Users/example/checkout/dist/scale2sheet",
    });

    expect(operations.some((op) => op.kind === "write-plist" || op.kind === "bootout" || op.kind === "bootstrap"))
      .toBe(false);
  });

  it("adds a maintenance lease and both label registrations with --launchd", () => {
    const operations = planInstall({
      home: "/Users/example",
      options: { ...defaultInstallOptions, launchd: true },
      currentManifest: undefined,
      settingsExists: true,
      missingAuthFiles: [],
      launchdReadiness: { status: "ready" },
      binarySource: "/Users/example/checkout/dist/scale2sheet",
    });

    expect(operations.filter((op) => op.kind === "acquire-maintenance-lease")).toHaveLength(1);
    expect(operations.filter((op) => op.kind === "bootout")).toHaveLength(2);
    expect(operations.filter((op) => op.kind === "write-plist")).toHaveLength(2);
    expect(operations.filter((op) => op.kind === "bootstrap")).toHaveLength(2);
    /** design §launchdフロー再登録: bootout, then write-plist, then bootstrap, per label. */
    const kinds = operations.map((op) => op.kind);
    const morningBootout = kinds.indexOf("bootout");
    const morningPlist = kinds.indexOf("write-plist");
    const morningBootstrap = kinds.indexOf("bootstrap");
    expect(morningBootout).toBeLessThan(morningPlist);
    expect(morningPlist).toBeLessThan(morningBootstrap);
  });

  it("omits ensure-settings when settings.json already exists", () => {
    const operations = planInstall({
      home: "/Users/example",
      options: defaultInstallOptions,
      currentManifest: undefined,
      settingsExists: true,
      missingAuthFiles: [],
      binarySource: "/Users/example/checkout/dist/scale2sheet",
    });

    expect(operations.some((op) => op.kind === "ensure-settings")).toBe(false);
  });

  it("fails fast on missing auth files before planning any binary or launchd mutation (AC-04)", () => {
    expect(() =>
      planInstall({
        home: "/Users/example",
        options: { ...defaultInstallOptions, launchd: true },
        currentManifest: undefined,
        settingsExists: true,
        missingAuthFiles: ["/Users/example/.config/scale2sheet/google-fit-credentials.json"],
        binarySource: "/Users/example/checkout/dist/scale2sheet",
      })
    ).toThrow(MissingAuthFilesError);
  });

  it("rejects a blocked launchd readiness before creating any operation", () => {
    expect(() =>
      planInstall({
        home: "/Users/example",
        options: { ...defaultInstallOptions, launchd: true },
        currentManifest: undefined,
        settingsExists: false,
        missingAuthFiles: [],
        launchdReadiness: {
          status: "blocked",
          issues: [{ code: "settings-missing", path: "/Users/example/.config/scale2sheet/settings.json" }],
        },
        binarySource: "/Users/example/checkout/dist/scale2sheet",
      }),
    ).toThrow(LaunchdNotReadyError);
  });

  it("rejects a dangerous prefix at the planning stage before any operation is built", () => {
    expect(() =>
      planInstall({
        home: "/Users/example",
        options: { ...defaultInstallOptions, prefix: "/usr" },
        currentManifest: undefined,
        settingsExists: true,
        missingAuthFiles: [],
        binarySource: "/Users/example/checkout/dist/scale2sheet",
      })
    ).toThrow(DangerousPrefixError);
  });

  it.each([
    ["nothing (fresh install)", undefined],
    ["installing (interrupted, resumed)", { ...installedManifest, state: "installing" as const, "applied-steps": ["ensure-settings"] }],
    ["installed (reinstall)", installedManifest],
  ] as const)("plans the identical idempotent sequence from manifest state: %s", (_label, manifest) => {
    const options = { ...defaultInstallOptions, launchd: true };
    const baseline = planInstall({
      home: "/Users/example",
      options,
      currentManifest: undefined,
      settingsExists: true,
      missingAuthFiles: [],
      binarySource: "/Users/example/checkout/dist/scale2sheet",
    });

    const resumed = planInstall({
      home: "/Users/example",
      options,
      currentManifest: manifest,
      settingsExists: true,
      missingAuthFiles: [],
      binarySource: "/Users/example/checkout/dist/scale2sheet",
    });

    expect(resumed).toEqual(baseline);
  });
});

describe("planUninstall: side-effect-free planning", () => {
  it("calls no fs mutation while planning an uninstall", () => {

    planUninstall({ currentManifest: installedManifest });

    expectNoFsMutations();
  });

  it("plans nothing when no manifest exists (AC-14: nothing to do)", () => {
    expect(planUninstall({ currentManifest: undefined })).toEqual([]);
  });

  it("plans bootout, plist removal, non-bin created-path cleanup, manifest removal, binary removal, then the now-empty bin dir", () => {
    // design §アンインストールフロー §既定 step 7 removes empty created-paths
    // and step 9 removes the binary last. The bin dir's own removal is
    // deliberately placed AFTER the binary removal (not with the other
    // created-paths in step 7): remove-tree only deletes empty directories
    // (B-1 fix), and the bin dir still holds the binary at step 7's point
    // in the plan, so removing it there would always be skipped as
    // non-empty — orphaning an empty ~/.local/bin after every uninstall.
    const operations = planUninstall({ currentManifest: installedManifest });

    expect(operations).toEqual([
      { kind: "bootout", domain: "gui/501", label: "jp.seijin.kappa.scale-pipeline.morning" },
      { kind: "bootout", domain: "gui/501", label: "jp.seijin.kappa.scale-pipeline.evening" },
      { kind: "remove-file", path: "/Users/example/Library/LaunchAgents/jp.seijin.kappa.scale-pipeline.morning.plist" },
      { kind: "remove-file", path: "/Users/example/Library/LaunchAgents/jp.seijin.kappa.scale-pipeline.evening.plist" },
      { kind: "remove-tree", path: "/Users/example/Library/Logs/scale-pipeline" },
      { kind: "remove-file", path: "/Users/example/.config/scale2sheet/install-manifest.json" },
      { kind: "remove-file", path: "/Users/example/.local/bin/scale2sheet" },
      { kind: "remove-tree", path: "/Users/example/.local/bin" },
    ]);
  });

  it("B-1 follow-on: plans the bin directory's removal after the binary itself is removed, so it is actually empty by then", () => {
    // Regression found while fixing B-1 (PR #139 review): remove-tree now
    // skips non-empty directories (to protect log files). If binDir's
    // remove-tree still ran before the binary file was removed, binDir
    // would always be non-empty at that point and get skipped forever,
    // silently leaving an orphaned empty ~/.local/bin behind after every
    // default uninstall.
    const operations = planUninstall({ currentManifest: installedManifest });
    const kinds = operations.map((op) => op.kind);

    const binaryRemoval = operations.findIndex(
      (op) => op.kind === "remove-file" && op.path === installedManifest["binary-path"],
    );
    const binDirRemoval = operations.findIndex(
      (op) => op.kind === "remove-tree" && op.path === "/Users/example/.local/bin",
    );

    expect(binaryRemoval).toBeGreaterThanOrEqual(0);
    expect(binDirRemoval).toBeGreaterThanOrEqual(0);
    expect(binDirRemoval).toBeGreaterThan(binaryRemoval);
    // The log dir's cleanup is unaffected by this reordering — it still
    // happens where it always did, independent of the binary.
    expect(kinds.filter((kind) => kind === "remove-tree")).toHaveLength(2);
  });

  it("never plans removal of the config directory itself (settings, auth, and logs must survive)", () => {
    const operations = planUninstall({ currentManifest: installedManifest });
    expect(operations.some((op) => "path" in op && op.path === installedManifest["config-dir"])).toBe(false);
  });

  it("uses the manifest's recorded binary-path rather than re-resolving from --prefix (AC-10)", () => {
    /** binary-path deliberately does not follow the prefix+"/bin/scale2sheet" convention, so a
     * planner that recomputed it from `prefix` instead of trusting the manifest would disagree. */
    const manifestWithDivergentBinaryPath: InstallManifest = {
      ...installedManifest,
      prefix: "/opt/scale2sheet",
      "binary-path": "/opt/scale2sheet-legacy/scale2sheet-bin",
    };

    const operations = planUninstall({ currentManifest: manifestWithDivergentBinaryPath });

    expect(operations.some((op) => op.kind === "remove-file" && op.path === "/opt/scale2sheet-legacy/scale2sheet-bin"))
      .toBe(true);
  });

  it("plans the identical sequence whether resuming a mid-uninstall or starting from installed", () => {
    const fromInstalled = planUninstall({ currentManifest: installedManifest });
    const resumedUninstall = planUninstall({
      currentManifest: { ...installedManifest, state: "uninstalling" },
    });

    expect(resumedUninstall).toEqual(fromInstalled);
  });

  it("plans no launchd operations when the manifest recorded launchd as disabled", () => {
    const withoutLaunchd: InstallManifest = { ...installedManifest, launchd: undefined };
    const operations = planUninstall({ currentManifest: withoutLaunchd });

    expect(operations.some((op) => op.kind === "bootout" || op.kind === "remove-file" && op.path.endsWith(".plist")))
      .toBe(false);
  });
});
