import { existsSync, readFileSync } from "node:fs";

import {
  ConfigError,
  parseSettingsFile,
  type SettingsFile,
} from "../config/settings.js";

/** Reads and validates an existing settings file without creating it. */
export function readSettings(settingsPath: string): SettingsFile | undefined {
  if (!existsSync(settingsPath)) {
    return undefined;
  }

  let json: unknown;
  try {
    json = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch (error) {
    throw new ConfigError(
      `invalid settings file: ${settingsPath}: ${(error as Error).message}`,
    );
  }

  return parseSettingsFile(json, settingsPath);
}
