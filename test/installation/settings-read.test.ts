import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConfigError } from "../../src/config/index.js";
import { readSettings } from "../../src/installation/settings-read.js";
import { APP_VERSION } from "../../src/version.js";

describe("runtime safety foundation", () => {
  let directory: string;
  let settingsPath: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-settings-read-"));
    settingsPath = path.join(directory, "settings.json");
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("exports the application version shared by CLI and manifest", () => {
    expect(APP_VERSION).toBe("0.1.0");
  });

  it("does not create a missing settings file", () => {
    expect(readSettings(settingsPath)).toBeUndefined();
    expect(existsSync(settingsPath)).toBe(false);
  });

  it("parses an existing settings file", async () => {
    await writeFile(settingsPath, '{"source":"apple-health"}\n');

    expect(readSettings(settingsPath)).toEqual({ source: "apple-health" });
  });

  it("rejects malformed and schema-invalid settings without changing the file", async () => {
    await writeFile(settingsPath, "{ not json");
    expect(() => readSettings(settingsPath)).toThrow(ConfigError);
    expect(existsSync(settingsPath)).toBe(true);

    await writeFile(settingsPath, '{"source":"unknown"}');
    expect(() => readSettings(settingsPath)).toThrow(ConfigError);
  });
});
