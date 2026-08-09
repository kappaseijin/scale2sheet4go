import {
  ConfigError,
  defaultSettingsPath,
  expandHomePath,
} from "../config/settings.js";
import { readSettings } from "../installation/settings-read.js";

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
    ?? settings?.["scale-exporter-output-dir"];
  if (!outputDir) {
    throw new ConfigError(
      "The scale-exporter source requires scale-exporter-output-dir in " +
        `${defaultSettingsPath} (or SCALE_EXPORTER_OUTPUT_DIR), pointing at your scale_exporter JSONL output folder.`,
    );
  }
  const timeZone = nonBlank(environment.TIME_ZONE)
    ?? settings?.["time-zone"]
    ?? DEFAULT_TIME_ZONE;

  return { outputDir: expandHomePath(outputDir), timeZone };
}

function nonBlank(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}
