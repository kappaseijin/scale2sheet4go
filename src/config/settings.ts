import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { z } from "zod";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function expandHomePath(value: string): string {
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

export const defaultSources = [
  "scale-exporter",
  "google-fit",
  "apple-health",
] as const;

export type DefaultSource = (typeof defaultSources)[number];

export const defaultSettingsPath = "~/.config/scale2sheet/settings.json";

// scale_exporter の settings.json と同じ kebab-case キーを使う
const settingsFileSchema = z
  .object({
    "time-zone": z.string().trim().min(1).optional(),
    source: z.enum(defaultSources).optional(),
    "sheet-id": z.string().trim().min(1).optional(),
    "sheet-name": z.string().trim().min(1).optional(),
    "sheets-credentials": z.string().trim().min(1).optional(),
    "scale-exporter-output-dir": z.string().trim().min(1).optional(),
    "apple-health-export-xml": z.string().trim().min(1).optional(),
    "google-fit-token-path": z.string().trim().min(1).optional(),
    "google-fit-lookback-days": z.number().int().positive().optional(),
    "morning-cron": z.string().trim().min(1).optional(),
    "evening-cron": z.string().trim().min(1).optional(),
  })
  .passthrough();

export type SettingsFile = z.infer<typeof settingsFileSchema>;

export function parseSettingsFile(value: unknown, settingsPath: string): SettingsFile {
  const parsed = settingsFileSchema.safeParse(value);
  if (!parsed.success) {
    throw new ConfigError(
      `invalid settings file: ${settingsPath}: ${parsed.error.message}`,
    );
  }

  return parsed.data;
}

export function defaultSettingsContent(configDir: string): SettingsFile {
  return {
    "time-zone": "Asia/Tokyo",
    source: "scale-exporter",
    "sheet-name": "体温・血圧",
    "sheets-credentials": path.join(
      configDir,
      "google-sheets-service-account.json",
    ),
    "scale-exporter-output-dir": "~/Documents/scale_exporter",
    "google-fit-token-path": path.join(configDir, "google-fit-token.json"),
    "morning-cron": "0 7 * * *",
    "evening-cron": "0 21 * * *",
  };
}

export function loadOrCreateSettings(
  settingsPath: string = defaultSettingsPath,
): SettingsFile {
  const resolvedPath = expandHomePath(settingsPath);
  const configDir = path.dirname(resolvedPath);

  if (!existsSync(resolvedPath)) {
    const defaults = defaultSettingsContent(configDir);
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      resolvedPath,
      `${JSON.stringify(defaults, null, 2)}\n`,
      "utf8",
    );
    return defaults;
  }

  let json: unknown;
  try {
    json = JSON.parse(readFileSync(resolvedPath, "utf8"));
  } catch (error) {
    throw new ConfigError(
      `invalid settings file: ${resolvedPath}: ${(error as Error).message}`,
    );
  }

  return parseSettingsFile(json, resolvedPath);
}

// scale_exporter の google-fit-credentials.json と同形式（snake_case キー）
const googleFitCredentialsSchema = z
  .object({
    client_id: z.string().trim().min(1),
    client_secret: z.string().trim().min(1),
    redirect_uri: z.string().trim().url().optional(),
  })
  .passthrough();

export interface GoogleFitCredentialsFile {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri?: string;
}

export function loadGoogleFitCredentials(
  configDir: string,
): GoogleFitCredentialsFile | undefined {
  const credentialsPath = path.join(configDir, "google-fit-credentials.json");
  if (!existsSync(credentialsPath)) {
    return undefined;
  }

  let json: unknown;
  try {
    json = JSON.parse(readFileSync(credentialsPath, "utf8"));
  } catch (error) {
    throw new ConfigError(
      `invalid credentials file: ${credentialsPath}: ${(error as Error).message}`,
    );
  }

  const parsed = googleFitCredentialsSchema.safeParse(json);
  if (!parsed.success) {
    throw new ConfigError(
      `invalid credentials file: ${credentialsPath}: ${parsed.error.message}`,
    );
  }

  return {
    clientId: parsed.data.client_id,
    clientSecret: parsed.data.client_secret,
    ...(parsed.data.redirect_uri
      ? { redirectUri: parsed.data.redirect_uri }
      : {}),
  };
}
