import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolvePipelineSettings } from "../../src/pipeline/settings.js";

describe("resolvePipelineSettings", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("prefers environment output directory without creating a settings file", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-pipeline-settings-"));
    directories.push(configDir);
    const settingsPath = path.join(configDir, "settings.json");

    expect(
      resolvePipelineSettings({
        settingsPath,
        environment: { SCALE_EXPORTER_OUTPUT_DIR: "/tmp/from-env" },
      }),
    ).toEqual({ outputDir: "/tmp/from-env", timeZone: "Asia/Tokyo" });
  });

  it("uses existing settings before the built-in defaults", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-pipeline-settings-"));
    directories.push(configDir);
    const settingsPath = path.join(configDir, "settings.json");
    await writeFile(settingsPath, '{"scale-exporter-output-dir":"/tmp/from-settings","time-zone":"UTC"}');

    expect(resolvePipelineSettings({ settingsPath, environment: {} })).toEqual({
      outputDir: "/tmp/from-settings",
      timeZone: "UTC",
    });
  });
});
