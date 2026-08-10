import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { evaluateLaunchdReadiness } from "../../src/installation/launchd-readiness.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("evaluateLaunchdReadiness", () => {
  it("blocks launchd registration when settings.json has not been created", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-launchd-readiness-"));
    temporaryDirectories.push(home);
    const settingsPath = path.join(home, ".config", "scale2sheet", "settings.json");

    await expect(evaluateLaunchdReadiness({ settingsPath, configDir: path.dirname(settingsPath) })).resolves.toEqual({
      status: "blocked",
      issues: [{ code: "settings-missing", path: settingsPath }],
    });
  });

  it("does not accept interactive shell settings that launchd will not inherit", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-launchd-readiness-"));
    temporaryDirectories.push(home);
    const configDir = path.join(home, ".config", "scale2sheet");
    const settingsPath = path.join(configDir, "settings.json");
    const credentialsPath = path.join(home, "sheets.json");
    await mkdir(configDir, { recursive: true });
    await writeFile(credentialsPath, "{}\n");
    await writeFile(
      settingsPath,
      JSON.stringify({
        source: "scale-exporter",
        "sheets-credentials": credentialsPath,
        "scale-exporter-output-dir": path.join(home, "published"),
      }),
    );
    const previousSheetId = process.env.GOOGLE_SHEET_ID;
    process.env.GOOGLE_SHEET_ID = "interactive-shell-only";

    try {
      const result = await evaluateLaunchdReadiness({ settingsPath, configDir });
      expect(result.status).toBe("blocked");
      expect(result.status === "blocked" && result.issues).toContainEqual(
        expect.objectContaining({ code: "sheets-config-missing" }),
      );
    } finally {
      if (previousSheetId === undefined) {
        delete process.env.GOOGLE_SHEET_ID;
      } else {
        process.env.GOOGLE_SHEET_ID = previousSheetId;
      }
    }
  });

  it("accepts complete static settings even when the runtime input does not exist", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-launchd-readiness-"));
    temporaryDirectories.push(home);
    const configDir = path.join(home, ".config", "scale2sheet");
    const settingsPath = path.join(configDir, "settings.json");
    const credentialsPath = path.join(home, "sheets.json");
    await mkdir(configDir, { recursive: true });
    await writeFile(credentialsPath, "{}\n");
    await writeFile(
      settingsPath,
      JSON.stringify({
        source: "scale-exporter",
        "sheet-id": "spreadsheet-id",
        "sheets-credentials": credentialsPath,
        "scale-exporter-output-dir": path.join(home, "not-published-yet"),
      }),
    );

    await expect(evaluateLaunchdReadiness({ settingsPath, configDir })).resolves.toEqual({ status: "ready" });
  });
});
