import { Command, InvalidArgumentError } from "commander";

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
    .requiredOption(
      "--source <source>",
      "data source: google-fit or apple-health",
      parseSource,
    )
    .action(async (options: RunCommandOptions) => {
      const config = loadConfig();
      const row = await syncMeasurements({
        config,
        period: options.period,
        source: options.source,
      });

      console.log(JSON.stringify(row));
    });

  program
    .command("serve")
    .description("Run morning/evening sync on MORNING_CRON and EVENING_CRON.")
    .option(
      "--source <source>",
      "data source: google-fit or apple-health",
      parseSource,
      "google-fit",
    )
    .action((options: ServeCommandOptions) => {
      const config = loadConfig();
      startScheduler({ config, source: options.source });
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
  readonly source: MeasurementSourceOption;
}

interface ServeCommandOptions {
  readonly source: MeasurementSourceOption;
}

function parsePeriod(value: string): MeasurementPeriod {
  if (value === "morning" || value === "evening") {
    return value;
  }

  throw new InvalidArgumentError("period must be morning or evening");
}

function parseSource(value: string): MeasurementSourceOption {
  if (value === "google-fit" || value === "apple-health") {
    return value;
  }

  throw new InvalidArgumentError("source must be google-fit or apple-health");
}
