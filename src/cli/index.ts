import { Command, InvalidArgumentError } from "commander";
import { DateTime } from "luxon";
import os from "node:os";
import path from "node:path";

import {
  ConfigError,
  loadConfig,
  requireGoogleSheetsConfig,
  requireGoogleFitConfig,
} from "../config/index.js";
import { runGoogleFitAuthFlow } from "../auth/index.js";
import type { MeasurementPeriod } from "../domain/index.js";
import type { MeasurementSourceOption } from "../sources/index.js";
import { readStableInputSnapshot } from "../pipeline/input-snapshot.js";
import { MacOsNotifier } from "../pipeline/notifier.js";
import { resolvePipelineSettings } from "../pipeline/settings.js";
import { runPipeline } from "../pipeline/pipeline.js";
import { AtomicPipelineStatusWriter } from "../pipeline/status.js";
import { acquireRunLease, startScheduler } from "../scheduler/index.js";
import {
  buildLatestMeasurementSet,
  syncMeasurements,
  transferLatestMeasurementSet,
} from "../service/index.js";
import { APP_VERSION } from "../version.js";

export async function runCli(argv: readonly string[] = process.argv): Promise<void> {
  const program = new Command();

  program
    .name("scale2sheet")
    .description("Sync body measurements to Google Sheets.")
    .version(APP_VERSION);

  program
    .command("auth")
    .description("Run the installed app OAuth flow for Google Fit.")
    .action(async () => {
      const config = loadConfig();
      await runGoogleFitAuthFlow(requireGoogleFitConfig(config));
    });

  program
    .command("pipeline")
    .description("Read a stable scale-exporter snapshot and transfer it.")
    .requiredOption("--period <period>", "measurement period: morning or evening")
    .action(async (options: { readonly period: string }) => {
      const period = parsePipelinePeriod(options.period);
      if (!period) {
        console.error("failed:invalid-arguments");
        process.exitCode = 2;
        return;
      }

      const pipelineSettings = resolvePipelineSettings();
      const referenceTime = new Date();
      const targetDate = DateTime.fromJSDate(referenceTime, {
        zone: pipelineSettings.timeZone,
      }).toFormat("yyyy-MM-dd");
      const config = loadConfig();
      const notifier = new MacOsNotifier(process.env.SCALE2SHEET_OSASCRIPT_PATH ?? "/usr/bin/osascript");
      const lease = await acquireRunLease({ kind: "pipeline", period });
      const statusWriter = new AtomicPipelineStatusWriter(
        path.join(os.homedir(), ".config", "scale2sheet", "pipeline-status.json"),
        lease.ownerToken,
      );
      try {
        const result = await runPipeline({
          period,
          timeZone: pipelineSettings.timeZone,
          referenceTime,
          targetDate,
          notifier,
          statusWriter,
          readInput: () =>
            readStableInputSnapshot({
              outputDir: pipelineSettings.outputDir,
              targetDate,
              delay: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
            }),
          transfer: async (readings) => {
            const latestSet = buildLatestMeasurementSet({
              readings,
              period,
              capturedAt: referenceTime.toISOString(),
            });
            const { outcome } = await transferLatestMeasurementSet({
              latestSet,
              sheetsConfig: requireGoogleSheetsConfig(config),
              timeZone: pipelineSettings.timeZone,
            });
            return outcome;
          },
        });
        console.log(result.outcome);
        process.exitCode = result.exitCode;
      } finally {
        await lease.release();
      }
    });

  program
    .command("run")
    .description("Append the latest measurements for one morning/evening period.")
    .requiredOption(
      "--period <period>",
      "measurement period: morning or evening",
      parsePeriod,
    )
    .option(
      "--source <source>",
      "data source: scale-exporter, google-fit or apple-health (default: settings.json の source)",
      parseSource,
    )
    .option(
      "--date <date>",
      "target date in YYYY-MM-DD format, using TIME_ZONE",
      parseDateOption,
    )
    .action(async (options: RunCommandOptions) => {
      const config = loadConfig();
      const referenceTime = options.date
        ? referenceTimeForDate(options.date, config.timeZone)
        : undefined;
      const row = await syncMeasurements({
        config,
        period: options.period,
        source: options.source ?? config.defaultSource,
        ...(referenceTime ? { referenceTime } : {}),
      });

      console.log(row ? JSON.stringify(row) : "No spreadsheet row updated.");
    });

  program
    .command("serve")
    .description("Run morning/evening sync on MORNING_CRON and EVENING_CRON.")
    .option(
      "--source <source>",
      "data source: scale-exporter, google-fit or apple-health (default: settings.json の source)",
      parseSource,
    )
    .action(async (options: ServeCommandOptions) => {
      const config = loadConfig();
      const lease = await acquireRunLease({ kind: "serve" });
      startScheduler({
        config,
        source: options.source ?? config.defaultSource,
        lease,
      });
    });

  try {
    await program.parseAsync([...argv]);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }

    throw error;
  }
}

interface RunCommandOptions {
  readonly period: MeasurementPeriod;
  readonly source?: MeasurementSourceOption;
  readonly date?: string;
}

interface ServeCommandOptions {
  readonly source?: MeasurementSourceOption;
}

function parsePeriod(value: string): MeasurementPeriod {
  if (value === "morning" || value === "evening") {
    return value;
  }

  throw new InvalidArgumentError("period must be morning or evening");
}

function parsePipelinePeriod(value: string): MeasurementPeriod | undefined {
  return value === "morning" || value === "evening" ? value : undefined;
}

function parseSource(value: string): MeasurementSourceOption {
  if (
    value === "scale-exporter" ||
    value === "google-fit" ||
    value === "apple-health"
  ) {
    return value;
  }

  throw new InvalidArgumentError(
    "source must be scale-exporter, google-fit or apple-health",
  );
}

export function parseDateOption(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new InvalidArgumentError("date must be YYYY-MM-DD");
  }

  const parsed = DateTime.fromFormat(value, "yyyy-MM-dd", { zone: "UTC" });
  if (!parsed.isValid || parsed.toFormat("yyyy-MM-dd") !== value) {
    throw new InvalidArgumentError("date must be a valid YYYY-MM-DD date");
  }

  return value;
}

export function referenceTimeForDate(value: string, timeZone: string): Date {
  const referenceTime = DateTime.fromFormat(value, "yyyy-MM-dd", {
    zone: timeZone,
  }).endOf("day");

  if (!referenceTime.isValid) {
    throw new InvalidArgumentError("date must be a valid YYYY-MM-DD date");
  }

  return referenceTime.toJSDate();
}
