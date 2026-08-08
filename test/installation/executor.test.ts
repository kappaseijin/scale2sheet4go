import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { applyOperations, defaultExecutorDeps, type ExecutorDeps } from "../../src/installation/executor.js";
import { readManifest, writeManifest, type InstallManifest } from "../../src/installation/manifest.js";
import type { InstallationOperation } from "../../src/installation/model.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-executor-"));
  temporaryDirectories.push(dir);
  return dir;
}

function baseManifest(overrides: Partial<InstallManifest> = {}): InstallManifest {
  return {
    "schema-version": 1,
    state: "installing",
    version: "0.1.0",
    prefix: "/Users/example/.local",
    "binary-path": "/Users/example/.local/bin/scale2sheet",
    "config-dir": "/Users/example/.config/scale2sheet",
    "log-dir": "/Users/example/Library/Logs/scale-pipeline",
    "applied-steps": [],
    "created-paths": [],
    "updated-at": "2026-08-07T00:00:00.000Z",
    ...overrides,
  };
}

function fakeDeps(overrides: Partial<ExecutorDeps> = {}): ExecutorDeps {
  return {
    ensureDirectory: async () => ({ created: true }),
    ensureSettings: async () => {},
    replaceBinary: async () => {},
    writePlist: async () => {},
    acquireMaintenanceLease: async () => {},
    removeFile: async () => {},
    removeTree: async () => ({ removed: true }),
    bootout: async () => ({ outcome: "done", message: "" }),
    bootstrap: async () => ({ outcome: "done", message: "" }),
    logger: { log: () => {} },
    ...overrides,
  };
}

describe("applyOperations: sequencing and classification", () => {
  it("records done for every operation in a fully successful plan", async () => {
    const dir = await makeTempDir();
    const manifestPath = path.join(dir, "install-manifest.json");
    await writeManifest(manifestPath, baseManifest());

    const operations: InstallationOperation[] = [
      { kind: "ensure-directory", path: "/x/config", mode: 0o700 },
      { kind: "ensure-settings", path: "/x/config/settings.json" },
      { kind: "replace-binary", source: "/tmp/src", target: "/x/bin/scale2sheet" },
    ];

    const result = await applyOperations({ operations, manifestPath, deps: fakeDeps() });

    expect(result.results.map((r) => r.status)).toEqual(["done", "done", "done"]);
    expect(result.failed).toBeUndefined();
    expect(result.pending).toEqual([]);
  });

  it("stops at the first failure and lists the rest as pending, with no automatic rollback", async () => {
    const dir = await makeTempDir();
    const manifestPath = path.join(dir, "install-manifest.json");
    await writeManifest(manifestPath, baseManifest());

    const operations: InstallationOperation[] = [
      { kind: "ensure-directory", path: "/x/config", mode: 0o700 },
      { kind: "replace-binary", source: "/tmp/src", target: "/x/bin/scale2sheet" },
      { kind: "bootout", domain: "gui/501", label: "jp.example.morning" },
      { kind: "bootstrap", domain: "gui/501", plistPath: "/x/morning.plist" },
    ];

    const result = await applyOperations({
      operations,
      manifestPath,
      deps: fakeDeps({
        replaceBinary: async () => {
          throw new Error("disk full");
        },
      }),
    });

    expect(result.results.map((r) => r.status)).toEqual(["done", "failed"]);
    expect(result.results[1]?.message).toContain("disk full");
    expect(result.failed).toBe("replace-binary /x/bin/scale2sheet");
    expect(result.pending).toEqual([
      "bootout jp.example.morning",
      "bootstrap /x/morning.plist",
    ]);
  });

  it("records skipped when a bootout adapter reports the label was never registered", async () => {
    const dir = await makeTempDir();
    const manifestPath = path.join(dir, "install-manifest.json");
    await writeManifest(manifestPath, baseManifest());

    const operations: InstallationOperation[] = [
      { kind: "bootout", domain: "gui/501", label: "jp.example.morning" },
    ];

    const result = await applyOperations({
      operations,
      manifestPath,
      deps: fakeDeps({ bootout: async () => ({ outcome: "skipped", message: "not loaded" }) }),
    });

    expect(result.results).toEqual([
      { operation: operations[0], status: "skipped", message: "not loaded" },
    ]);
  });

  it("formats each line as [<status>] <kind> <target>[: <message>] (design §エラーと部分適用)", async () => {
    const dir = await makeTempDir();
    const manifestPath = path.join(dir, "install-manifest.json");
    await writeManifest(manifestPath, baseManifest());
    const lines: string[] = [];

    await applyOperations({
      operations: [
        { kind: "replace-binary", source: "/tmp/src", target: "/x/bin/scale2sheet" },
        { kind: "bootout", domain: "gui/501", label: "jp.example.morning" },
      ],
      manifestPath,
      deps: fakeDeps({
        bootout: async () => ({ outcome: "skipped", message: "not loaded" }),
        logger: { log: (line: string) => lines.push(line) },
      }),
    });

    expect(lines).toEqual([
      "[done] replace-binary /x/bin/scale2sheet",
      "[skipped] bootout jp.example.morning: not loaded",
    ]);
  });

  it("updates the manifest's applied-steps after each operation, in order (resume contract)", async () => {
    const dir = await makeTempDir();
    const manifestPath = path.join(dir, "install-manifest.json");
    await writeManifest(manifestPath, baseManifest());

    await applyOperations({
      operations: [
        { kind: "ensure-directory", path: "/x/config", mode: 0o700 },
        { kind: "replace-binary", source: "/tmp/src", target: "/x/bin/scale2sheet" },
      ],
      manifestPath,
      deps: fakeDeps(),
    });

    const manifest = await readManifest(manifestPath);
    expect(manifest?.["applied-steps"]).toEqual([
      "ensure-directory /x/config",
      "replace-binary /x/bin/scale2sheet",
    ]);
  });

  it("records only newly created directories into created-paths, never pre-existing ones", async () => {
    const dir = await makeTempDir();
    const manifestPath = path.join(dir, "install-manifest.json");
    await writeManifest(manifestPath, baseManifest());

    await applyOperations({
      operations: [
        { kind: "ensure-directory", path: "/x/new-dir", mode: 0o700 },
        { kind: "ensure-directory", path: "/x/existing-dir", mode: 0o700 },
      ],
      manifestPath,
      deps: fakeDeps({
        ensureDirectory: async (targetPath) => ({ created: targetPath === "/x/new-dir" }),
      }),
    });

    const manifest = await readManifest(manifestPath);
    expect(manifest?.["created-paths"]).toEqual(["/x/new-dir"]);
  });

  it("preserves progress already recorded before a mid-run interruption (resume from installing)", async () => {
    const dir = await makeTempDir();
    const manifestPath = path.join(dir, "install-manifest.json");
    await writeManifest(manifestPath, baseManifest({ "applied-steps": ["ensure-directory /x/config"] }));

    await applyOperations({
      operations: [{ kind: "replace-binary", source: "/tmp/src", target: "/x/bin/scale2sheet" }],
      manifestPath,
      deps: fakeDeps(),
    });

    const manifest = await readManifest(manifestPath);
    expect(manifest?.["applied-steps"]).toEqual([
      "ensure-directory /x/config",
      "replace-binary /x/bin/scale2sheet",
    ]);
  });

  it("does not implement archive-paths in Slice 3 (purge/wipe is Slice 5)", async () => {
    const dir = await makeTempDir();
    const manifestPath = path.join(dir, "install-manifest.json");
    await writeManifest(manifestPath, baseManifest());

    const result = await applyOperations({
      operations: [{ kind: "archive-paths", target: "/x/archive", paths: ["/x/a"] }],
      manifestPath,
      deps: fakeDeps(),
    });

    expect(result.results[0]?.status).toBe("failed");
  });

  it("continues past a remove-file that deletes the manifest itself (uninstall's own contract)", async () => {
    // design §アンインストールフロー §既定 step 8-9: the manifest is removed as
    // one of the plan's own operations, then the binary is removed as the
    // final step. recordStep must not try to re-read (and fail on) a
    // manifest that this same plan just deleted.
    const dir = await makeTempDir();
    const manifestPath = path.join(dir, "install-manifest.json");
    await writeManifest(manifestPath, baseManifest());
    await writeManifest(manifestPath, baseManifest({ state: "installed" }));
    await writeManifest(manifestPath, baseManifest({ state: "uninstalling" }));

    const removedPaths: string[] = [];
    const result = await applyOperations({
      operations: [
        { kind: "remove-file", path: manifestPath },
        { kind: "remove-file", path: "/x/bin/scale2sheet" },
      ],
      manifestPath,
      deps: fakeDeps({
        // Mirrors defaultExecutorDeps.removeFile: actually deletes the file
        // on disk, so removing manifestPath itself really makes it unreadable.
        removeFile: async (targetPath) => {
          removedPaths.push(targetPath);
          if (targetPath === manifestPath) {
            await rm(manifestPath, { force: true });
          }
        },
      }),
    });

    expect(result.results.map((r) => r.status)).toEqual(["done", "done"]);
    expect(result.failed).toBeUndefined();
    expect(removedPaths).toEqual([manifestPath, "/x/bin/scale2sheet"]);
  });

  it("B-1 (reviewer, PR #139): remove-tree leaves a non-empty directory in place instead of deleting user data", async () => {
    // design §アンインストールフロー §既定 step 7: "created-paths に記録された
    // 空のディレクトリのうち、config 以外を削除する" — only EMPTY directories.
    // The log dir is in created-paths (install created it) but after real
    // pipeline runs it holds the user's log files, which default uninstall
    // must leave behind.
    const dir = await makeTempDir();
    const logDir = path.join(dir, "logs");
    await mkdir(logDir, { recursive: true });
    await writeFile(path.join(logDir, "morning.log"), "some log content\n");

    const result = await defaultExecutorDeps.removeTree(logDir);

    expect(result.removed).toBe(false);
    await expect(stat(path.join(logDir, "morning.log"))).resolves.toBeDefined();
  });

  it("B-1: remove-tree removes an empty directory", async () => {
    const dir = await makeTempDir();
    const emptyDir = path.join(dir, "bin");
    await mkdir(emptyDir, { recursive: true });

    const result = await defaultExecutorDeps.removeTree(emptyDir);

    expect(result.removed).toBe(true);
    await expect(stat(emptyDir)).rejects.toThrow();
  });

  it("B-1: remove-tree treats an already-missing directory as nothing to remove, not a failure", async () => {
    const dir = await makeTempDir();
    const missingDir = path.join(dir, "never-existed");

    const result = await defaultExecutorDeps.removeTree(missingDir);

    expect(result.removed).toBe(false);
  });

  it("B-1: applyOperations reports a non-empty remove-tree as skipped, not done, with an explanatory message", async () => {
    const dir = await makeTempDir();
    const manifestPath = path.join(dir, "install-manifest.json");
    await writeManifest(manifestPath, baseManifest());

    const result = await applyOperations({
      operations: [{ kind: "remove-tree", path: "/x/logs" }],
      manifestPath,
      deps: fakeDeps({ removeTree: async () => ({ removed: false }) }),
    });

    expect(result.results[0]).toEqual({
      operation: { kind: "remove-tree", path: "/x/logs" },
      status: "skipped",
      message: "not empty, left in place",
    });
  });
});
