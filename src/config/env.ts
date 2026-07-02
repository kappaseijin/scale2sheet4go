import "dotenv/config";

import path from "node:path";

import { z } from "zod";

import {
  ConfigError,
  defaultSettingsPath,
  expandHomePath,
  loadGoogleFitCredentials,
  loadOrCreateSettings,
  type DefaultSource,
  type SettingsFile,
} from "./settings.js";

export { ConfigError, expandHomePath } from "./settings.js";
export type { DefaultSource } from "./settings.js";

export const defaultGoogleSheetId =
  "163Lc0YeN5ZnGeXdYqx6T_JGSMa91kpvfpoODjF7q8C0";
export const defaultGoogleSheetName = "体温・血圧";

const optionalString = z
  .string()
  .trim()
  .transform((value) => (value.length === 0 ? undefined : value))
  .optional();

const defaultedString = (defaultValue: string) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.trim().length === 0
        ? undefined
        : value,
    z.string().trim().min(1).default(defaultValue),
  );

const positiveIntegerFromString = z
  .string()
  .trim()
  .regex(/^\d+$/)
  .transform((value) => Number.parseInt(value, 10))
  .pipe(z.number().int().positive());

export const envSchema = z.object({
  TIME_ZONE: z.string().trim().min(1).default("Asia/Tokyo"),
  GOOGLE_SHEET_ID: defaultedString(defaultGoogleSheetId),
  GOOGLE_SHEET_NAME: defaultedString(defaultGoogleSheetName),
  GOOGLE_APPLICATION_CREDENTIALS: optionalString,
  GOOGLE_FIT_CLIENT_ID: optionalString,
  GOOGLE_FIT_CLIENT_SECRET: optionalString,
  GOOGLE_FIT_REDIRECT_URI: z
    .string()
    .trim()
    .url()
    .default("http://localhost:3000/oauth2callback"),
  GOOGLE_FIT_TOKEN_PATH: z
    .string()
    .trim()
    .min(1)
    .default("~/.config/scale2sheet/google-fit-token.json"),
  GOOGLE_FIT_LOOKBACK_DAYS: positiveIntegerFromString.default(14),
  APPLE_HEALTH_EXPORT_XML: optionalString,
  SCALE_EXPORTER_OUTPUT_DIR: defaultedString("~/Documents/scale_exporter"),
  MORNING_CRON: z.string().trim().min(1).default("0 7 * * *"),
  EVENING_CRON: z.string().trim().min(1).default("0 21 * * *"),
});

export type EnvConfig = z.infer<typeof envSchema>;

export interface GoogleFitAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly tokenPath: string;
  readonly lookbackDays: number;
}

export interface GoogleSheetsAuthConfig {
  readonly applicationCredentialsPath: string;
  readonly spreadsheetId: string;
  readonly sheetName: string;
}

export interface AppleHealthConfig {
  readonly exportXmlPath: string;
}

export interface ScaleExporterConfig {
  readonly outputDir: string;
}

export interface SchedulerConfig {
  readonly morningCron: string;
  readonly eveningCron: string;
}

export interface AppConfig {
  readonly timeZone: string;
  readonly defaultSource: DefaultSource;
  readonly googleFit?: GoogleFitAuthConfig;
  readonly googleSheets?: GoogleSheetsAuthConfig;
  readonly appleHealth?: AppleHealthConfig;
  readonly scaleExporter: ScaleExporterConfig;
  readonly scheduler: SchedulerConfig;
}

type MutableAppConfig = {
  -readonly [Key in keyof AppConfig]: AppConfig[Key];
};

export interface LoadConfigOptions {
  /**
   * settings.json のパス。省略時は ~/.config/scale2sheet/settings.json
   * （なければ自動生成）。null で設定ファイル層を無効化（テスト用）。
   */
  readonly settingsPath?: string | null;
}

// settings.json のキー → 環境変数名の対応（環境変数が優先）
function settingsAsEnvOverlay(settings: SettingsFile): Record<string, string> {
  const overlay: Record<string, string> = {};
  const mapping: ReadonlyArray<[keyof SettingsFile, string]> = [
    ["time-zone", "TIME_ZONE"],
    ["sheet-id", "GOOGLE_SHEET_ID"],
    ["sheet-name", "GOOGLE_SHEET_NAME"],
    ["sheets-credentials", "GOOGLE_APPLICATION_CREDENTIALS"],
    ["scale-exporter-output-dir", "SCALE_EXPORTER_OUTPUT_DIR"],
    ["apple-health-export-xml", "APPLE_HEALTH_EXPORT_XML"],
    ["google-fit-token-path", "GOOGLE_FIT_TOKEN_PATH"],
    ["google-fit-lookback-days", "GOOGLE_FIT_LOOKBACK_DAYS"],
    ["morning-cron", "MORNING_CRON"],
    ["evening-cron", "EVENING_CRON"],
  ];

  for (const [settingsKey, envKey] of mapping) {
    const value = settings[settingsKey];
    if (value !== undefined) {
      overlay[envKey] = String(value);
    }
  }

  return overlay;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: LoadConfigOptions = {},
): AppConfig {
  const settingsPath =
    options.settingsPath === undefined
      ? defaultSettingsPath
      : options.settingsPath;
  const settings: SettingsFile =
    settingsPath === null ? {} : loadOrCreateSettings(settingsPath);
  const configDir =
    settingsPath === null
      ? null
      : path.dirname(expandHomePath(settingsPath));

  // 優先順位: 環境変数（空文字は未設定扱い） > settings.json > 既定値
  const merged: Record<string, string> = settingsAsEnvOverlay(settings);
  for (const key of Object.keys(envSchema.shape)) {
    const value = env[key];
    if (typeof value === "string" && value.trim().length > 0) {
      merged[key] = value;
    }
  }

  const parsed = envSchema.parse(merged);
  const config: MutableAppConfig = {
    timeZone: parsed.TIME_ZONE,
    defaultSource: settings.source ?? "scale-exporter",
    scaleExporter: {
      outputDir: expandHomePath(parsed.SCALE_EXPORTER_OUTPUT_DIR),
    },
    scheduler: {
      morningCron: parsed.MORNING_CRON,
      eveningCron: parsed.EVENING_CRON,
    },
  };

  let clientId = parsed.GOOGLE_FIT_CLIENT_ID;
  let clientSecret = parsed.GOOGLE_FIT_CLIENT_SECRET;
  let redirectUri = parsed.GOOGLE_FIT_REDIRECT_URI;
  if ((!clientId || !clientSecret) && configDir !== null) {
    const credentials = loadGoogleFitCredentials(configDir);
    if (credentials) {
      clientId = credentials.clientId;
      clientSecret = credentials.clientSecret;
      redirectUri = credentials.redirectUri ?? redirectUri;
    }
  }
  if (clientId && clientSecret) {
    config.googleFit = {
      clientId,
      clientSecret,
      redirectUri,
      tokenPath: expandHomePath(parsed.GOOGLE_FIT_TOKEN_PATH),
      lookbackDays: parsed.GOOGLE_FIT_LOOKBACK_DAYS,
    };
  }

  if (parsed.GOOGLE_APPLICATION_CREDENTIALS && parsed.GOOGLE_SHEET_ID) {
    config.googleSheets = {
      applicationCredentialsPath: expandHomePath(
        parsed.GOOGLE_APPLICATION_CREDENTIALS,
      ),
      spreadsheetId: parsed.GOOGLE_SHEET_ID,
      sheetName: parsed.GOOGLE_SHEET_NAME,
    };
  }

  if (parsed.APPLE_HEALTH_EXPORT_XML) {
    config.appleHealth = {
      exportXmlPath: expandHomePath(parsed.APPLE_HEALTH_EXPORT_XML),
    };
  }

  return config;
}

export function requireGoogleFitConfig(
  config: AppConfig,
): GoogleFitAuthConfig {
  if (!config.googleFit) {
    throw new ConfigError(
      "Google Fit requires client credentials: set GOOGLE_FIT_CLIENT_ID / GOOGLE_FIT_CLIENT_SECRET, or create ~/.config/scale2sheet/google-fit-credentials.json.",
    );
  }

  return config.googleFit;
}

export function requireGoogleSheetsConfig(
  config: AppConfig,
): GoogleSheetsAuthConfig {
  if (!config.googleSheets) {
    throw new ConfigError(
      "Google Sheets requires credentials: set sheets-credentials in settings.json or GOOGLE_APPLICATION_CREDENTIALS.",
    );
  }

  return config.googleSheets;
}

export function requireAppleHealthConfig(config: AppConfig): AppleHealthConfig {
  if (!config.appleHealth) {
    throw new ConfigError(
      "Apple Health requires apple-health-export-xml in settings.json or APPLE_HEALTH_EXPORT_XML.",
    );
  }

  return config.appleHealth;
}
