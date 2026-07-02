import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConfigError, loadConfig } from "../../src/config/index.js";

describe("loadConfig with settings.json", () => {
  let configDir: string;
  let settingsPath: string;

  beforeEach(async () => {
    configDir = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-config-"));
    settingsPath = path.join(configDir, "settings.json");
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  it("auto-generates a default settings file when missing", async () => {
    const config = loadConfig({}, { settingsPath });

    expect(existsSync(settingsPath)).toBe(true);
    const written = JSON.parse(await readFile(settingsPath, "utf8"));
    expect(written["source"]).toBe("scale-exporter");
    expect(written["time-zone"]).toBe("Asia/Tokyo");
    expect(config.defaultSource).toBe("scale-exporter");
    expect(config.timeZone).toBe("Asia/Tokyo");
  });

  it("reads settings values and expands home paths", async () => {
    await writeFile(
      settingsPath,
      JSON.stringify({
        "time-zone": "UTC",
        source: "apple-health",
        "sheet-id": "sheet-from-settings",
        "sheets-credentials": "~/sa.json",
        "scale-exporter-output-dir": "~/exports",
        "morning-cron": "0 6 * * *",
      }),
    );

    const config = loadConfig({}, { settingsPath });

    expect(config.timeZone).toBe("UTC");
    expect(config.defaultSource).toBe("apple-health");
    expect(config.scaleExporter.outputDir).toBe(
      path.join(os.homedir(), "exports"),
    );
    expect(config.scheduler.morningCron).toBe("0 6 * * *");
    expect(config.googleSheets?.spreadsheetId).toBe("sheet-from-settings");
    expect(config.googleSheets?.applicationCredentialsPath).toBe(
      path.join(os.homedir(), "sa.json"),
    );
  });

  it("lets environment variables override settings, treating blanks as unset", async () => {
    await writeFile(
      settingsPath,
      JSON.stringify({
        "time-zone": "UTC",
        "sheet-name": "settings-name",
        "sheets-credentials": "/tmp/sa.json",
      }),
    );

    const config = loadConfig(
      { TIME_ZONE: "Asia/Tokyo", GOOGLE_SHEET_NAME: "   " },
      { settingsPath },
    );

    expect(config.timeZone).toBe("Asia/Tokyo");
    // 空白のみの環境変数は未設定扱いで settings の値が生きる
    expect(config.googleSheets?.sheetName).toBe("settings-name");
  });

  it("throws ConfigError for malformed settings JSON", async () => {
    await writeFile(settingsPath, "{ not json");

    expect(() => loadConfig({}, { settingsPath })).toThrow(ConfigError);
  });

  it("falls back to google-fit-credentials.json for client credentials", async () => {
    await writeFile(settingsPath, JSON.stringify({}));
    await writeFile(
      path.join(configDir, "google-fit-credentials.json"),
      JSON.stringify({
        client_id: "cid-from-file",
        client_secret: "secret-from-file",
        redirect_uri: "http://localhost:9999/cb",
      }),
    );

    const config = loadConfig({}, { settingsPath });

    expect(config.googleFit?.clientId).toBe("cid-from-file");
    expect(config.googleFit?.clientSecret).toBe("secret-from-file");
    expect(config.googleFit?.redirectUri).toBe("http://localhost:9999/cb");
  });

  it("prefers environment credentials over the credentials file", async () => {
    await writeFile(settingsPath, JSON.stringify({}));
    await writeFile(
      path.join(configDir, "google-fit-credentials.json"),
      JSON.stringify({ client_id: "file-id", client_secret: "file-secret" }),
    );

    const config = loadConfig(
      { GOOGLE_FIT_CLIENT_ID: "env-id", GOOGLE_FIT_CLIENT_SECRET: "env-secret" },
      { settingsPath },
    );

    expect(config.googleFit?.clientId).toBe("env-id");
    expect(config.googleFit?.clientSecret).toBe("env-secret");
  });

  it("expands the google fit token path", async () => {
    await writeFile(
      settingsPath,
      JSON.stringify({ "google-fit-token-path": "~/token.json" }),
    );

    const config = loadConfig(
      { GOOGLE_FIT_CLIENT_ID: "id", GOOGLE_FIT_CLIENT_SECRET: "secret" },
      { settingsPath },
    );

    expect(config.googleFit?.tokenPath).toBe(
      path.join(os.homedir(), "token.json"),
    );
  });

  it("disables the settings layer when settingsPath is null", () => {
    const config = loadConfig({}, { settingsPath: null });

    expect(config.defaultSource).toBe("scale-exporter");
    expect(config.timeZone).toBe("Asia/Tokyo");
    expect(existsSync(settingsPath)).toBe(false);
  });
});
