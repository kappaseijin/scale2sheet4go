import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ConfigError } from "../../src/config/settings.js";
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

  it("uses existing settings over environment absence", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-pipeline-settings-"));
    directories.push(configDir);
    const settingsPath = path.join(configDir, "settings.json");
    await writeFile(settingsPath, '{"scale-exporter-output-dir":"/tmp/from-settings","time-zone":"UTC"}');

    expect(resolvePipelineSettings({ settingsPath, environment: {} })).toEqual({
      outputDir: "/tmp/from-settings",
      timeZone: "UTC",
    });
  });

  it("throws a ConfigError naming scale-exporter-output-dir and the settings file when neither env nor settings has it (#51)", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-pipeline-settings-"));
    directories.push(configDir);
    const settingsPath = path.join(configDir, "settings.json");
    await writeFile(settingsPath, '{"time-zone":"UTC"}');

    expect(() => resolvePipelineSettings({ settingsPath, environment: {} })).toThrow(ConfigError);
    expect(() => resolvePipelineSettings({ settingsPath, environment: {} })).toThrow(
      /scale-exporter-output-dir/,
    );
    expect(() => resolvePipelineSettings({ settingsPath, environment: {} })).toThrow(/settings\.json/);
  });

  it("no longer falls back to the dead ~/Documents/scale_exporter default (#51)", async () => {
    const configDir = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-pipeline-settings-"));
    directories.push(configDir);
    const settingsPath = path.join(configDir, "settings.json");

    expect(() => resolvePipelineSettings({ settingsPath, environment: {} })).toThrow(ConfigError);
  });
});
