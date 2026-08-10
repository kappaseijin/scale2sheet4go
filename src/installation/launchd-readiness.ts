export type LaunchdReadinessIssue =
  | { readonly code: "settings-missing"; readonly path: string }
  | { readonly code: "settings-invalid"; readonly detail: string }
  | { readonly code: "sheets-config-missing"; readonly detail: string }
  | { readonly code: "source-config-missing"; readonly source: string; readonly detail: string }
  | { readonly code: "auth-file-missing"; readonly path: string };

export type LaunchdReadiness =
  | { readonly status: "not-requested" }
  | { readonly status: "ready" }
  | { readonly status: "blocked"; readonly issues: readonly LaunchdReadinessIssue[] };

export interface EvaluateLaunchdReadinessInput {
  readonly settingsPath: string;
  readonly configDir: string;
}

async function exists(filePath: string): Promise<boolean> {
  return stat(filePath).then(() => true, () => false);
}

/**
 * Resolves only values a launchd plist can reproduce. In particular, the
 * empty environment deliberately prevents an interactive install shell from
 * satisfying a setting that launchd will not inherit.
 */
export async function evaluateLaunchdReadiness(
  input: EvaluateLaunchdReadinessInput,
): Promise<LaunchdReadiness> {
  let settings;
  try {
    settings = readSettings(input.settingsPath);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { status: "blocked", issues: [{ code: "settings-invalid", detail }] };
  }
  if (!settings) {
    return {
      status: "blocked",
      issues: [{ code: "settings-missing", path: input.settingsPath }],
    };
  }

  let config;
  try {
    config = loadConfig({}, { settingsPath: input.settingsPath });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { status: "blocked", issues: [{ code: "settings-invalid", detail }] };
  }

  const issues: LaunchdReadinessIssue[] = [];
  try {
    requireGoogleSheetsConfig(config);
  } catch (error) {
    issues.push({
      code: "sheets-config-missing",
      detail: error instanceof ConfigError ? error.message : String(error),
    });
  }

  try {
    requireSourceConfig(config, config.defaultSource);
  } catch (error) {
    issues.push({
      code: "source-config-missing",
      source: config.defaultSource,
      detail: error instanceof ConfigError ? error.message : String(error),
    });
  }

  if (config.googleSheets && !(await exists(config.googleSheets.applicationCredentialsPath))) {
    issues.push({ code: "auth-file-missing", path: config.googleSheets.applicationCredentialsPath });
  }
  if (config.defaultSource === "google-fit" && config.googleFit && !(await exists(config.googleFit.tokenPath))) {
    issues.push({ code: "auth-file-missing", path: config.googleFit.tokenPath });
  }

  return issues.length === 0 ? { status: "ready" } : { status: "blocked", issues };
}
import { stat } from "node:fs/promises";

import { ConfigError } from "../config/settings.js";
import { loadConfig, requireGoogleSheetsConfig } from "../config/env.js";
import { requireSourceConfig } from "../service/measurements.js";
import { readSettings } from "./settings-read.js";
