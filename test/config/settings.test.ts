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
        "sheet-id": "sheet-from-settings",
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

  it("reads Google Fit OAuth client credentials from settings.json (#110)", async () => {
    await writeFile(
      settingsPath,
      JSON.stringify({
        "google-fit-client-id": "cid-from-settings",
        "google-fit-client-secret": "secret-from-settings",
        "google-fit-redirect-uri": "http://localhost:8888/settings-callback",
      }),
    );

    const config = loadConfig({}, { settingsPath });

    expect(config.googleFit?.clientId).toBe("cid-from-settings");
    expect(config.googleFit?.clientSecret).toBe("secret-from-settings");
    expect(config.googleFit?.redirectUri).toBe("http://localhost:8888/settings-callback");
  });

  it("prefers environment credentials over settings.json for Google Fit OAuth (#110)", async () => {
    await writeFile(
      settingsPath,
      JSON.stringify({
        "google-fit-client-id": "cid-from-settings",
        "google-fit-client-secret": "secret-from-settings",
      }),
    );

    const config = loadConfig(
      { GOOGLE_FIT_CLIENT_ID: "cid-from-env", GOOGLE_FIT_CLIENT_SECRET: "secret-from-env" },
      { settingsPath },
    );

    expect(config.googleFit?.clientId).toBe("cid-from-env");
    expect(config.googleFit?.clientSecret).toBe("secret-from-env");
  });

  it("prefers settings.json over the google-fit-credentials.json fallback file (#110)", async () => {
    await writeFile(
      settingsPath,
      JSON.stringify({
        "google-fit-client-id": "cid-from-settings",
        "google-fit-client-secret": "secret-from-settings",
      }),
    );
    await writeFile(
      path.join(configDir, "google-fit-credentials.json"),
      JSON.stringify({ client_id: "cid-from-file", client_secret: "secret-from-file" }),
    );

    const config = loadConfig({}, { settingsPath });

    expect(config.googleFit?.clientId).toBe("cid-from-settings");
    expect(config.googleFit?.clientSecret).toBe("secret-from-settings");
  });

  it("disables the settings layer when settingsPath is null", () => {
    const config = loadConfig({}, { settingsPath: null });

    expect(config.defaultSource).toBe("scale-exporter");
    expect(config.timeZone).toBe("Asia/Tokyo");
    expect(existsSync(settingsPath)).toBe(false);
  });

  it("auto-generated settings.json no longer bundles the dead scale-exporter-output-dir default (#51)", async () => {
    loadConfig({}, { settingsPath });

    const written = JSON.parse(await readFile(settingsPath, "utf8"));
    expect(written).not.toHaveProperty("scale-exporter-output-dir");
    expect(written).not.toHaveProperty("sheet-id");
  });
});

describe("loadConfig without a built-in sheet-id or scale-exporter-output-dir default (#47, #51)", () => {
  let configDir: string;
  let settingsPath: string;

  beforeEach(async () => {
    configDir = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-config-"));
    settingsPath = path.join(configDir, "settings.json");
  });

  afterEach(async () => {
    await rm(configDir, { recursive: true, force: true });
  });

  it("leaves googleSheets unset when sheet-id is missing, even with credentials configured", async () => {
    await writeFile(
      settingsPath,
      JSON.stringify({ "sheets-credentials": "/tmp/sa.json" }),
    );

    const config = loadConfig({}, { settingsPath });

    expect(config.googleSheets).toBeUndefined();
  });

  it("requireGoogleSheetsConfig names both required keys and the settings file (#47)", async () => {
    await writeFile(settingsPath, JSON.stringify({}));
    const config = loadConfig({}, { settingsPath });

    const { requireGoogleSheetsConfig } = await import("../../src/config/index.js");
    expect(() => requireGoogleSheetsConfig(config)).toThrow(/sheet-id/);
    expect(() => requireGoogleSheetsConfig(config)).toThrow(/sheets-credentials/);
    expect(() => requireGoogleSheetsConfig(config)).toThrow(/settings\.json/);
  });

  it("populates googleSheets once both sheet-id and sheets-credentials are present", async () => {
    await writeFile(
      settingsPath,
      JSON.stringify({ "sheet-id": "abc123", "sheets-credentials": "/tmp/sa.json" }),
    );

    const config = loadConfig({}, { settingsPath });

    expect(config.googleSheets?.spreadsheetId).toBe("abc123");
  });

  it("leaves scaleExporter unset when scale-exporter-output-dir is missing (#51)", async () => {
    const config = loadConfig({}, { settingsPath });

    expect(config.scaleExporter).toBeUndefined();
  });

  it("requireScaleExporterConfig names the required key and the settings file (#51)", async () => {
    const config = loadConfig({}, { settingsPath });

    const { requireScaleExporterConfig } = await import("../../src/config/index.js");
    expect(() => requireScaleExporterConfig(config)).toThrow(/scale-exporter-output-dir/);
    expect(() => requireScaleExporterConfig(config)).toThrow(/settings\.json/);
  });

  it("populates scaleExporter once scale-exporter-output-dir is present", async () => {
    await writeFile(
      settingsPath,
      JSON.stringify({ "scale-exporter-output-dir": "/tmp/exports" }),
    );

    const config = loadConfig({}, { settingsPath });

    expect(config.scaleExporter?.outputDir).toBe("/tmp/exports");
  });
});
