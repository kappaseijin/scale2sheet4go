import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  IllegalManifestTransitionError,
  ManifestSchemaError,
  readManifest,
  writeManifest,
  type InstallManifest,
} from "../../src/installation/manifest.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-manifest-"));
  temporaryDirectories.push(dir);
  return dir;
}

const validManifest: InstallManifest = {
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
  "created-paths": ["/Users/example/.config/scale2sheet"],
  "updated-at": "2026-07-29T09:10:44+09:00",
};

/** Seeds a manifest file directly, bypassing writeManifest's transition check, to model "already on disk". */
async function seedManifest(manifestPath: string, manifest: unknown): Promise<void> {
  await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
}

describe("manifest schema", () => {
  it("round-trips the design's example JSON structure", async () => {
    const dir = await makeTempDir();
    const manifestPath = path.join(dir, "install-manifest.json");

    await seedManifest(manifestPath, validManifest);
    const read = await readManifest(manifestPath);

    expect(read).toEqual(validManifest);
  });

  it("returns undefined when no manifest file exists", async () => {
    const dir = await makeTempDir();
    await expect(readManifest(path.join(dir, "install-manifest.json"))).resolves.toBeUndefined();
  });

  it.each(["installing", "installed", "uninstalling"] as const)(
    "accepts the %s state",
    async (state) => {
      const dir = await makeTempDir();
      const manifestPath = path.join(dir, "install-manifest.json");
      const manifest: InstallManifest = { ...validManifest, state, launchd: undefined };

      await seedManifest(manifestPath, manifest);
      await expect(readManifest(manifestPath)).resolves.toMatchObject({ state });
    },
  );

  it("rejects an unrecognized state value", async () => {
    const dir = await makeTempDir();
    const manifestPath = path.join(dir, "install-manifest.json");
    await writeFile(
      manifestPath,
      JSON.stringify({ ...validManifest, state: "broken" }),
      "utf8",
    );

    await expect(readManifest(manifestPath)).rejects.toThrow(ManifestSchemaError);
  });

  it("rejects an unknown schema-version rather than guessing a migration", async () => {
    const dir = await makeTempDir();
    const manifestPath = path.join(dir, "install-manifest.json");
    await writeFile(
      manifestPath,
      JSON.stringify({ ...validManifest, "schema-version": 2 }),
      "utf8",
    );

    await expect(readManifest(manifestPath)).rejects.toThrow(ManifestSchemaError);
  });

  it("rejects a document missing required fields", async () => {
    const dir = await makeTempDir();
    const manifestPath = path.join(dir, "install-manifest.json");
    const { "applied-steps": _omitted, ...incomplete } = validManifest;
    await writeFile(manifestPath, JSON.stringify(incomplete), "utf8");

    await expect(readManifest(manifestPath)).rejects.toThrow(ManifestSchemaError);
  });

  it("does not silently coerce malformed JSON into an empty manifest", async () => {
    const dir = await makeTempDir();
    const manifestPath = path.join(dir, "install-manifest.json");
    await writeFile(manifestPath, "not json", "utf8");

    await expect(readManifest(manifestPath)).rejects.toThrow(ManifestSchemaError);
  });
});

const installingManifest: InstallManifest = {
  ...validManifest,
  state: "installing",
  "applied-steps": [],
  "created-paths": [],
  launchd: undefined,
};

describe("manifest atomic write", () => {
  it("writes with mode 0600", async () => {
    const dir = await makeTempDir();
    const manifestPath = path.join(dir, "install-manifest.json");

    await writeManifest(manifestPath, installingManifest);

    expect((await stat(manifestPath)).mode & 0o777).toBe(0o600);
  });

  it("replaces via rename, leaving no temporary file behind", async () => {
    const dir = await makeTempDir();
    const manifestPath = path.join(dir, "install-manifest.json");

    await writeManifest(manifestPath, installingManifest);
    await writeManifest(manifestPath, { ...installingManifest, state: "installed" });

    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(dir);
    expect(entries).toEqual(["install-manifest.json"]);
  });

  it("keeps the old complete manifest when rename is interrupted", async () => {
    const dir = await makeTempDir();
    const manifestPath = path.join(dir, "install-manifest.json");
    await writeManifest(manifestPath, installingManifest);
    const before = await readFile(manifestPath, "utf8");

    const renameFile = vi.fn(async () => {
      throw new Error("simulated stop around rename");
    });

    await expect(
      writeManifest(
        manifestPath,
        { ...installingManifest, "applied-steps": ["ensure-settings"] },
        { renameFile },
      ),
    ).rejects.toThrow("simulated stop around rename");
    await expect(readFile(manifestPath, "utf8")).resolves.toBe(before);
  });

  it("never leaves a document with an unrecognized state or version on disk", async () => {
    const dir = await makeTempDir();
    const manifestPath = path.join(dir, "install-manifest.json");

    await expect(
      writeManifest(manifestPath, { ...installingManifest, state: "broken" as unknown as "installed" }),
    ).rejects.toThrow(ManifestSchemaError);
    await expect(readManifest(manifestPath)).resolves.toBeUndefined();
  });
});

describe("manifest state machine (resume contract)", () => {
  it("does not skip installing: nothing -> installed is rejected", async () => {
    const dir = await makeTempDir();
    const manifestPath = path.join(dir, "install-manifest.json");

    await expect(writeManifest(manifestPath, { ...installingManifest, state: "installed" }))
      .rejects.toThrow(IllegalManifestTransitionError);
    await expect(readManifest(manifestPath)).resolves.toBeUndefined();
  });

  it("does not skip installing: installed -> installed directly is rejected", async () => {
    const dir = await makeTempDir();
    const manifestPath = path.join(dir, "install-manifest.json");
    await seedManifest(manifestPath, { ...validManifest, launchd: undefined });

    await expect(writeManifest(manifestPath, { ...validManifest, launchd: undefined }))
      .rejects.toThrow(IllegalManifestTransitionError);
  });

  it("does not resurrect a completed install once uninstalling has begun (uninstalling -> installed)", async () => {
    const dir = await makeTempDir();
    const manifestPath = path.join(dir, "install-manifest.json");
    await writeManifest(manifestPath, installingManifest);
    await writeManifest(manifestPath, { ...installingManifest, state: "installed" });
    await writeManifest(manifestPath, { ...installingManifest, state: "uninstalling" });

    await expect(writeManifest(manifestPath, { ...installingManifest, state: "installed" }))
      .rejects.toThrow(IllegalManifestTransitionError);
  });

  it("resumes an interrupted install: applied-steps accumulate across writes instead of resetting", async () => {
    const dir = await makeTempDir();
    const manifestPath = path.join(dir, "install-manifest.json");

    await writeManifest(manifestPath, installingManifest);
    await writeManifest(manifestPath, {
      ...installingManifest,
      "applied-steps": ["ensure-settings"],
      "created-paths": ["/Users/example/.config/scale2sheet"],
    });
    /** Simulated restart: a fresh read sees exactly the partial progress, not a reset. */
    const resumed = await readManifest(manifestPath);
    expect(resumed).toMatchObject({
      state: "installing",
      "applied-steps": ["ensure-settings"],
      "created-paths": ["/Users/example/.config/scale2sheet"],
    });

    await writeManifest(manifestPath, {
      ...installingManifest,
      state: "installed",
      "applied-steps": ["ensure-settings", "ensure-bin-directory", "replace-binary"],
      "created-paths": ["/Users/example/.config/scale2sheet"],
    });
    await expect(readManifest(manifestPath)).resolves.toMatchObject({
      state: "installed",
      "applied-steps": ["ensure-settings", "ensure-bin-directory", "replace-binary"],
    });
  });

  it("allows a reinstall to begin from an already-installed manifest", async () => {
    const dir = await makeTempDir();
    const manifestPath = path.join(dir, "install-manifest.json");
    await writeManifest(manifestPath, installingManifest);
    await writeManifest(manifestPath, { ...installingManifest, state: "installed" });

    await expect(writeManifest(manifestPath, { ...installingManifest, state: "installing" }))
      .resolves.toBeUndefined();
  });
});
