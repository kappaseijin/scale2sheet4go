import {
  defaultSettingsPath,
  expandHomePath,
} from "../config/settings.js";
import { readSettings } from "../installation/settings-read.js";

const DEFAULT_OUTPUT_DIR = "~/Documents/scale_exporter";
const DEFAULT_TIME_ZONE = "Asia/Tokyo";

export interface ResolvePipelineSettingsOptions {
  readonly settingsPath?: string;
  readonly environment?: NodeJS.ProcessEnv;
}

export interface PipelineSettings {
  readonly outputDir: string;
  readonly timeZone: string;
}

/** Resolves existing configuration without creating a settings file. */
export function resolvePipelineSettings(
  options: ResolvePipelineSettingsOptions = {},
): PipelineSettings {
  const settingsPath = expandHomePath(options.settingsPath ?? defaultSettingsPath);
  const settings = readSettings(settingsPath);
  const environment = options.environment ?? process.env;
  const outputDir = nonBlank(environment.SCALE_EXPORTER_OUTPUT_DIR)
    ?? settings?.["scale-exporter-output-dir"]
    ?? DEFAULT_OUTPUT_DIR;
  const timeZone = nonBlank(environment.TIME_ZONE)
    ?? settings?.["time-zone"]
    ?? DEFAULT_TIME_ZONE;

  return { outputDir: expandHomePath(outputDir), timeZone };
}

function nonBlank(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}
