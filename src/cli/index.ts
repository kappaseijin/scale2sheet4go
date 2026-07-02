import { Command, InvalidArgumentError } from "commander";
import { DateTime } from "luxon";

import {
  ConfigError,
  loadConfig,
  requireGoogleFitConfig,
} from "../config/index.js";
import { runGoogleFitAuthFlow } from "../auth/index.js";
import type { MeasurementPeriod } from "../domain/index.js";
import type { MeasurementSourceOption } from "../sources/index.js";
import { startScheduler } from "../scheduler/index.js";
import { syncMeasurements } from "../service/index.js";

export async function runCli(argv: readonly string[] = process.argv): Promise<void> {
  const program = new Command();

  program
    .name("scale2sheet")
    .description("Sync body measurements to Google Sheets.")
    .version("0.1.0");

  program
    .command("auth")
    .description("Run the installed app OAuth flow for Google Fit.")
    .action(async () => {
      const config = loadConfig();
      await runGoogleFitAuthFlow(requireGoogleFitConfig(config));
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
    .action((options: ServeCommandOptions) => {
      const config = loadConfig();
      startScheduler({ config, source: options.source ?? config.defaultSource });
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
