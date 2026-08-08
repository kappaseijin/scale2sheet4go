import { mkdtemp, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { applyOperations, defaultExecutorDeps } from "../../src/installation/executor.js";
import {
  FixedPathBinaryCopySource,
  NotACompiledBinaryError,
  ProcessExecutableBinaryCopySource,
} from "../../src/installation/binary-copy-source.js";
import { writeManifest, type InstallManifest } from "../../src/installation/manifest.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "scale2sheet-binary-copy-"));
  temporaryDirectories.push(dir);
  return dir;
}

function baseManifest(overrides: Partial<InstallManifest> = {}): InstallManifest {
  return {
    "schema-version": 1,
    state: "installing",
    version: "0.1.0",
    prefix: "/x",
    "binary-path": "/x/bin/scale2sheet",
    "config-dir": "/x/config",
    "log-dir": "/x/log",
    "applied-steps": [],
    "created-paths": [],
    "updated-at": "2026-08-07T00:00:00.000Z",
    ...overrides,
  };
}

describe("FixedPathBinaryCopySource", () => {
  it("resolves to the fixture's absolute path unconditionally", async () => {
    const source = new FixedPathBinaryCopySource("/tmp/fixture/scale2sheet");
    await expect(source.resolve()).resolves.toBe("/tmp/fixture/scale2sheet");
  });
});

describe("ProcessExecutableBinaryCopySource", () => {
  it("rejects a non-Bun process (e.g. running under node or tsx in dev)", async () => {
    const source = new ProcessExecutableBinaryCopySource({ bunVersion: undefined, execPath: "/usr/local/bin/node" });
    await expect(source.resolve()).rejects.toThrow(NotACompiledBinaryError);
  });

  it("rejects the bare bun CLI (bun run, not a compiled standalone binary)", async () => {
    const source = new ProcessExecutableBinaryCopySource({ bunVersion: "1.1.0", execPath: "/opt/homebrew/bin/bun" });
    await expect(source.resolve()).rejects.toThrow(NotACompiledBinaryError);
  });

  it("resolves process.execPath for a compiled standalone Bun binary", async () => {
    const source = new ProcessExecutableBinaryCopySource({
      bunVersion: "1.1.0",
      execPath: "/Users/example/.local/bin/scale2sheet",
    });
    await expect(source.resolve()).resolves.toBe("/Users/example/.local/bin/scale2sheet");
  });
});

describe("executor replace-binary: atomic replacement (design §バイナリのatomic replacement)", () => {
  it("replaces the target's content and does not leave a temp file behind", async () => {
    const dir = await makeTempDir();
    const manifestPath = path.join(dir, "install-manifest.json");
    await writeManifest(manifestPath, baseManifest());
    const sourcePath = path.join(dir, "source-binary");
    await writeFile(sourcePath, "binary content v2", "utf8");
    const targetPath = path.join(dir, "scale2sheet");
    await writeFile(targetPath, "binary content v1", "utf8");

    await applyOperations({
      operations: [{ kind: "replace-binary", source: sourcePath, target: targetPath }],
      manifestPath,
      deps: defaultExecutorDeps,
    });

    await expect(readFile(targetPath, "utf8")).resolves.toBe("binary content v2");
    const entries = await readdir(dir);
    expect(entries.some((entry) => entry.startsWith(".scale2sheet.tmp-"))).toBe(false);
  });

  it("sets mode 0755 on the replaced binary", async () => {
    const dir = await makeTempDir();
    const manifestPath = path.join(dir, "install-manifest.json");
    await writeManifest(manifestPath, baseManifest());
    const sourcePath = path.join(dir, "source-binary");
    await writeFile(sourcePath, "binary content", "utf8");
    const targetPath = path.join(dir, "scale2sheet");

    await applyOperations({
      operations: [{ kind: "replace-binary", source: sourcePath, target: targetPath }],
      manifestPath,
      deps: defaultExecutorDeps,
    });

    expect((await stat(targetPath)).mode & 0o777).toBe(0o755);
  });

  it("N-3: an in-progress reader keeps the old inode's content after replacement (rename, not overwrite)", async () => {
    const dir = await makeTempDir();
    const targetPath = path.join(dir, "scale2sheet");
    await writeFile(targetPath, "old content", "utf8");
    const oldHandle = await open(targetPath, "r");
    const oldInode = (await oldHandle.stat()).ino;

    const manifestPath = path.join(dir, "install-manifest.json");
    await writeManifest(manifestPath, baseManifest());
    const sourcePath = path.join(dir, "source-binary");
    await writeFile(sourcePath, "new content", "utf8");

    await applyOperations({
      operations: [{ kind: "replace-binary", source: sourcePath, target: targetPath }],
      manifestPath,
      deps: defaultExecutorDeps,
    });

    /** The already-open handle held the pre-replacement inode; it must still read the old content. */
    expect((await oldHandle.stat()).ino).toBe(oldInode);
    const buffer = Buffer.alloc(64);
    const { bytesRead } = await oldHandle.read(buffer, 0, 64, 0);
    expect(buffer.subarray(0, bytesRead).toString("utf8")).toBe("old content");
    await oldHandle.close();

    await expect(readFile(targetPath, "utf8")).resolves.toBe("new content");
  });

  it("N-3 (negative control): a direct in-place overwrite corrupts what an in-progress reader sees", async () => {
    /** Documents the failure atomic replacement prevents. Does not exercise executor.ts. */
    const dir = await makeTempDir();
    const targetPath = path.join(dir, "scale2sheet");
    await writeFile(targetPath, "old content", "utf8");
    const oldHandle = await open(targetPath, "r");
    const oldInode = (await oldHandle.stat()).ino;

    /** cp-equivalent: truncate-and-rewrite the same path in place instead of temp-file-then-rename. */
    await writeFile(targetPath, "new content", { flag: "w" });

    expect((await oldHandle.stat()).ino).toBe(oldInode);
    const buffer = Buffer.alloc(64);
    const { bytesRead } = await oldHandle.read(buffer, 0, 64, 0);
    /** The "old" handle now sees the new bytes too: direct overwrite gives no isolation to an in-progress reader. */
    expect(buffer.subarray(0, bytesRead).toString("utf8")).toBe("new content");
    await oldHandle.close();
  });

  it("deletes only the temporary file when the copy step fails, leaving the target untouched", async () => {
    const dir = await makeTempDir();
    const manifestPath = path.join(dir, "install-manifest.json");
    await writeManifest(manifestPath, baseManifest());
    const targetPath = path.join(dir, "scale2sheet");
    await writeFile(targetPath, "old content", "utf8");
    const missingSourcePath = path.join(dir, "does-not-exist");

    const result = await applyOperations({
      operations: [{ kind: "replace-binary", source: missingSourcePath, target: targetPath }],
      manifestPath,
      deps: defaultExecutorDeps,
    });

    expect(result.results[0]?.status).toBe("failed");
    await expect(readFile(targetPath, "utf8")).resolves.toBe("old content");
    const entries = await readdir(dir);
    expect(entries.some((entry) => entry.startsWith(".scale2sheet.tmp-"))).toBe(false);
  });

  it("deletes the temp file (not the target) when a later step fails after the copy succeeded", async () => {
    /** Copy and chmod succeed (temp file exists in the target's directory); rename onto an
     * existing directory fails with EISDIR, exercising cleanup after the temp file is real. */
    const dir = await makeTempDir();
    const manifestPath = path.join(dir, "install-manifest.json");
    await writeManifest(manifestPath, baseManifest());
    const sourcePath = path.join(dir, "source-binary");
    await writeFile(sourcePath, "binary content", "utf8");
    const targetPath = path.join(dir, "scale2sheet");
    const { mkdir: mkdirFn } = await import("node:fs/promises");
    await mkdirFn(targetPath);

    const result = await applyOperations({
      operations: [{ kind: "replace-binary", source: sourcePath, target: targetPath }],
      manifestPath,
      deps: defaultExecutorDeps,
    });

    expect(result.results[0]?.status).toBe("failed");
    await expect(stat(targetPath).then((s) => s.isDirectory())).resolves.toBe(true);
    const entries = await readdir(dir);
    expect(entries.some((entry) => entry.startsWith(".scale2sheet.tmp-"))).toBe(false);
  });
});
