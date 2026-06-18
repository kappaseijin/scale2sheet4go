import "dotenv/config";

import { z } from "zod";

const optionalString = z
  .string()
  .trim()
  .transform((value) => (value.length === 0 ? undefined : value))
  .optional();

const positiveIntegerFromString = z
  .string()
  .trim()
  .regex(/^\d+$/)
  .transform((value) => Number.parseInt(value, 10))
  .pipe(z.number().int().positive());

export const envSchema = z.object({
  TIME_ZONE: z.string().trim().min(1).default("Asia/Tokyo"),
  GOOGLE_SHEET_ID: optionalString,
  GOOGLE_SHEET_NAME: z.string().trim().min(1).default("Measurements"),
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
    .default(".scale2sheet/google-fit-token.json"),
  GOOGLE_FIT_LOOKBACK_DAYS: positiveIntegerFromString.default(14),
  APPLE_HEALTH_EXPORT_XML: optionalString,
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

export interface SchedulerConfig {
  readonly morningCron: string;
  readonly eveningCron: string;
}

export interface AppConfig {
  readonly timeZone: string;
  readonly googleFit?: GoogleFitAuthConfig;
  readonly googleSheets?: GoogleSheetsAuthConfig;
  readonly appleHealth?: AppleHealthConfig;
  readonly scheduler: SchedulerConfig;
}

type MutableAppConfig = {
  -readonly [Key in keyof AppConfig]: AppConfig[Key];
};

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);
  const config: MutableAppConfig = {
    timeZone: parsed.TIME_ZONE,
    scheduler: {
      morningCron: parsed.MORNING_CRON,
      eveningCron: parsed.EVENING_CRON,
    },
  };

  if (parsed.GOOGLE_FIT_CLIENT_ID && parsed.GOOGLE_FIT_CLIENT_SECRET) {
    config.googleFit = {
      clientId: parsed.GOOGLE_FIT_CLIENT_ID,
      clientSecret: parsed.GOOGLE_FIT_CLIENT_SECRET,
      redirectUri: parsed.GOOGLE_FIT_REDIRECT_URI,
      tokenPath: parsed.GOOGLE_FIT_TOKEN_PATH,
      lookbackDays: parsed.GOOGLE_FIT_LOOKBACK_DAYS,
    };
  }

  if (parsed.GOOGLE_APPLICATION_CREDENTIALS && parsed.GOOGLE_SHEET_ID) {
    config.googleSheets = {
      applicationCredentialsPath: parsed.GOOGLE_APPLICATION_CREDENTIALS,
      spreadsheetId: parsed.GOOGLE_SHEET_ID,
      sheetName: parsed.GOOGLE_SHEET_NAME,
    };
  }

  if (parsed.APPLE_HEALTH_EXPORT_XML) {
    config.appleHealth = {
      exportXmlPath: parsed.APPLE_HEALTH_EXPORT_XML,
    };
  }

  return config;
}

export function requireGoogleFitConfig(
  config: AppConfig,
): GoogleFitAuthConfig {
  if (!config.googleFit) {
    throw new ConfigError(
      "Google Fit requires GOOGLE_FIT_CLIENT_ID and GOOGLE_FIT_CLIENT_SECRET.",
    );
  }

  return config.googleFit;
}

export function requireGoogleSheetsConfig(
  config: AppConfig,
): GoogleSheetsAuthConfig {
  if (!config.googleSheets) {
    throw new ConfigError(
      "Google Sheets requires GOOGLE_APPLICATION_CREDENTIALS and GOOGLE_SHEET_ID.",
    );
  }

  return config.googleSheets;
}

export function requireAppleHealthConfig(config: AppConfig): AppleHealthConfig {
  if (!config.appleHealth) {
    throw new ConfigError(
      "Apple Health requires APPLE_HEALTH_EXPORT_XML to point to export.xml.",
    );
  }

  return config.appleHealth;
}
