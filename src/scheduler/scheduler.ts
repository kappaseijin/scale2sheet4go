import cron from "node-cron";

import type { AppConfig } from "../config/index.js";
import type { MeasurementPeriod } from "../domain/index.js";
import type { MeasurementSourceOption } from "../sources/index.js";
import { syncMeasurements } from "../service/index.js";

export interface StartSchedulerOptions {
  readonly config: AppConfig;
  readonly source: MeasurementSourceOption;
  readonly logger?: Pick<Console, "log" | "error">;
}

export function startScheduler({
  config,
  source,
  logger = console,
}: StartSchedulerOptions): void {
  const run = (period: MeasurementPeriod) => {
    void syncMeasurements({ config, source, period })
      .then((row) => {
        if (!row) {
          logger.log(`No ${period} spreadsheet row updated.`);
          return;
        }

        logger.log(
          `Updated ${period} row: ${row.date} ${row.time} (${row.source})`,
        );
      })
      .catch((error: unknown) => {
        logger.error(error);
      });
  };

  cron.schedule(config.scheduler.morningCron, () => run("morning"), {
    timezone: config.timeZone,
  });
  cron.schedule(config.scheduler.eveningCron, () => run("evening"), {
    timezone: config.timeZone,
  });

  logger.log(
    `Scheduler started for ${source}: morning="${config.scheduler.morningCron}", evening="${config.scheduler.eveningCron}", timezone="${config.timeZone}"`,
  );
}
