import { access, constants, mkdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Command } from "commander";
import { DateTime } from "luxon";

import { expandHomePath, loadGoogleFitCredentials } from "../config/settings.js";
import {
  ProcessExecutableBinaryCopySource,
  type BinaryCopySource,
} from "../installation/binary-copy-source.js";
import {
  applyOperations,
  defaultExecutorDeps,
  describeOperation,
  type ApplyOperationsResult,
  type ExecutorDeps,
} from "../installation/executor.js";
import {
  readManifest,
  writeManifest,
  type InstallManifest,
} from "../installation/manifest.js";
import { runDoctor, type DoctorDeps, type DoctorReport } from "../installation/doctor.js";
import type { InstallationOperation } from "../installation/model.js";
import { DangerousPrefixError, resolveInstallationPaths } from "../installation/paths.js";
import { MissingAuthFilesError, planInstall, planUninstall } from "../installation/planner.js";
import { LaunchctlAdapter } from "../installation/process.js";
import { readSettings } from "../installation/settings-read.js";
import { GoogleSheetsReadAdapter, type SheetsReadPort } from "../installation/sheets-read.js";
import { acquireRunLease, readActiveRunReceipt, RunLeaseError, type RunLeaseHandle } from "../scheduler/run-lease.js";
import { readPipelineStatusDocument } from "../pipeline/status.js";
import { APP_VERSION } from "../version.js";

export interface InstallCliOptions {
  readonly prefix: string;
  readonly launchd: boolean;
  readonly dryRun: boolean;
  readonly force: boolean;
}

export interface UninstallCliOptions {
  readonly prefix: string;
  readonly dryRun: boolean;
}

export interface InstallationCliDeps {
  readonly home: string;
  readonly binaryCopySource: BinaryCopySource;
  readonly executorDeps: ExecutorDeps;
  readonly acquireLease: typeof acquireRunLease;
  readonly logger: Pick<Console, "log" | "error">;
}

/** Read-only command wiring is injected independently from install/uninstall's write-capable dependencies. */
export interface DoctorCliDeps {
  readonly logger: Pick<Console, "log" | "error">;
  readonly createDoctorDeps: () => DoctorDeps;
  readonly runDoctor: (deps: DoctorDeps) => Promise<DoctorReport>;
}

/** Command wiring is injectable so doctor cannot become an install/uninstall side effect. */
export interface InstallationCommandDeps {
  readonly doctor: DoctorCliDeps;
  readonly runInstallCommand: typeof runInstallCommand;
  readonly runUninstallCommand: typeof runUninstallCommand;
}

export function defaultInstallationCliDeps(): InstallationCliDeps {
  return {
    home: os.homedir(),
    binaryCopySource: new ProcessExecutableBinaryCopySource(),
    executorDeps: defaultExecutorDeps,
    acquireLease: acquireRunLease,
    logger: console,
  };
}

/** Production wiring for the explicit, read-only `doctor` command. */
export function defaultDoctorCliDeps(): DoctorCliDeps {
  const home = os.homedir();
  const paths = resolveInstallationPaths({ home, prefix: "~/.local" });
  return {
    logger: console,
    createDoctorDeps: () => ({
      paths,
      execPath: process.execPath,
      appVersion: APP_VERSION,
      now: () => DateTime.now(),
      readManifest,
      readSettings,
      environment: {
        GOOGLE_FIT_CLIENT_ID: process.env.GOOGLE_FIT_CLIENT_ID,
        GOOGLE_FIT_CLIENT_SECRET: process.env.GOOGLE_FIT_CLIENT_SECRET,
      },
      readGoogleFitCredentials: loadGoogleFitCredentials,
      process: new LaunchctlAdapter(),
      sheets: createDefaultSheetsReadPort(paths.settingsPath),
      statFile: statReadableFile,
      readTextFile,
      readActiveRunReceipt,
      readPipelineStatus: readPipelineStatusDocument,
    }),
    runDoctor,
  };
}

function defaultInstallationCommandDeps(): InstallationCommandDeps {
  return {
    doctor: defaultDoctorCliDeps(),
    runInstallCommand,
    runUninstallCommand,
  };
}

/** Lazily resolves the settings only if doctor reaches the Sheets read checks. */
function createDefaultSheetsReadPort(settingsPath: string): SheetsReadPort {
  let adapter: GoogleSheetsReadAdapter | undefined;
  const requireAdapter = (): GoogleSheetsReadAdapter => {
    if (adapter) {
      return adapter;
    }
    const settings = readSettings(settingsPath);
    const spreadsheetId = settings?.["sheet-id"];
    const applicationCredentialsPath = settings?.["sheets-credentials"];
    const sheetName = settings?.["sheet-name"];
    if (!spreadsheetId || !applicationCredentialsPath || !sheetName) {
      throw new Error("Google Sheets settings are incomplete");
    }
    adapter = new GoogleSheetsReadAdapter({ applicationCredentialsPath, spreadsheetId, sheetName });
    return adapter;
  };
  return {
    authenticate: () => requireAdapter().authenticate(),
    readHeaderRow: () => requireAdapter().readHeaderRow(),
    findTodayRow: (dateColumnIndex, today) => requireAdapter().findTodayRow(dateColumnIndex, today),
  };
}

async function statReadableFile(filePath: string): Promise<{ readonly executable: boolean; readonly readable: boolean } | undefined> {
  try {
    const details = await stat(filePath);
    await access(filePath, constants.R_OK);
    return { executable: (details.mode & 0o111) !== 0, readable: true };
  } catch {
    return undefined;
  }
}

async function readTextFile(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export async function runDoctorCommand(deps: DoctorCliDeps = defaultDoctorCliDeps()): Promise<number> {
  const report = await deps.runDoctor(deps.createDoctorDeps());
  for (const check of report.checks) {
    const line = `[${check.status}] ${check.id}${check.stage ? ` (${check.stage})` : ""}: ${check.message}`;
    if (check.status === "FAIL") {
      deps.logger.error(line);
    } else {
      deps.logger.log(line);
    }
  }
  return report.status === "FAIL" ? 1 : 0;
}

/**
 * design §計画 step 5: resolve the auth files a source needs, then only
 * `stat` them (never read contents). `sheets-credentials` is required for
 * every source because the pipeline always transfers to Spreadsheet;
 * `google-fit-token-path` is required only when `source` is `google-fit`.
 */
async function resolveMissingAuthFiles(
  settingsPath: string,
  configDir: string,
): Promise<readonly string[]> {
  const settings = readSettings(settingsPath);
  if (!settings) {
    return [];
  }

  const required = [
    expandHomePath(
      settings["sheets-credentials"] ?? path.join(configDir, "google-sheets-service-account.json"),
    ),
  ];
  if ((settings.source ?? "scale-exporter") === "google-fit") {
    required.push(
      expandHomePath(settings["google-fit-token-path"] ?? path.join(configDir, "google-fit-token.json")),
    );
  }

  const missing: string[] = [];
  for (const file of required) {
    const exists = await stat(file).then(() => true, () => false);
    if (!exists) {
      missing.push(file);
    }
  }
  return missing;
}

function printPlan(logger: InstallationCliDeps["logger"], operations: readonly InstallationOperation[]): void {
  for (const operation of operations) {
    logger.log(`[planned] ${describeOperation(operation)}`);
  }
}

/** design §エラーと部分適用: Completed/Failed/Pending/Retry summary on partial application. */
function printFailureSummary(
  logger: InstallationCliDeps["logger"],
  result: ApplyOperationsResult,
  retryCommand: string,
): void {
  const completed = result.results
    .filter((entry) => entry.status === "done" || entry.status === "skipped")
    .map((entry) => describeOperation(entry.operation));

  logger.error("Completed:");
  for (const step of completed) {
    logger.error(`  ${step}`);
  }
  logger.error("Failed:");
  logger.error(`  ${result.failed}`);
  logger.error("Pending:");
  for (const step of result.pending) {
    logger.error(`  ${step}`);
  }
  logger.error("Retry:");
  logger.error(`  ${retryCommand}`);
}

function freshInstallingManifest(
  paths: ReturnType<typeof resolveInstallationPaths>,
  options: InstallCliOptions,
): InstallManifest {
  return {
    "schema-version": 1,
    state: "installing",
    version: APP_VERSION,
    prefix: paths.prefix,
    "binary-path": paths.binaryPath,
    "config-dir": paths.configDir,
    "log-dir": paths.logDir,
    ...(options.launchd
      ? {
          launchd: {
            enabled: true,
            domain: `gui/${process.getuid?.() ?? 0}`,
            labels: [],
            "plist-paths": [],
          },
        }
      : {}),
    "applied-steps": [],
    "created-paths": [],
    "updated-at": new Date().toISOString(),
  };
}

/** design INSTALLATION_DESIGN.md §インストールフロー. */
export async function runInstallCommand(
  options: InstallCliOptions,
  deps: InstallationCliDeps = defaultInstallationCliDeps(),
): Promise<number> {
  let binarySource: string;
  try {
    binarySource = await deps.binaryCopySource.resolve();
  } catch (error) {
    deps.logger.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  let paths: ReturnType<typeof resolveInstallationPaths>;
  try {
    paths = resolveInstallationPaths({ home: deps.home, prefix: options.prefix });
  } catch (error) {
    if (error instanceof DangerousPrefixError) {
      deps.logger.error(error.message);
      return 2;
    }
    throw error;
  }

  const currentManifest = await readManifest(paths.manifestPath);
  const settingsExists = readSettings(paths.settingsPath) !== undefined;
  const missingAuthFiles = settingsExists
    ? await resolveMissingAuthFiles(paths.settingsPath, paths.configDir)
    : [];

  let operations: readonly InstallationOperation[];
  try {
    operations = planInstall({
      home: paths.home,
      options: { prefix: paths.prefix, launchd: options.launchd, dryRun: options.dryRun, force: options.force },
      currentManifest,
      settingsExists,
      missingAuthFiles,
      binarySource,
    });
  } catch (error) {
    if (error instanceof MissingAuthFilesError) {
      deps.logger.error(`failed:missing-auth-files ${error.missingFiles.join(", ")}`);
      return 1;
    }
    throw error;
  }

  if (options.dryRun) {
    printPlan(deps.logger, operations);
    return 0;
  }

  let lease: RunLeaseHandle | undefined;
  try {
    if (options.launchd) {
      try {
        lease = await deps.acquireLease({
          kind: "maintenance",
          origin: "maintenance",
          configDir: paths.configDir,
        });
      } catch (error) {
        deps.logger.error(error instanceof Error ? error.message : String(error));
        return 1;
      }
    }

    if (!currentManifest) {
      // design §適用 step 1/3: the config dir must exist before the manifest
      // that lives inside it can be written. The plan's own
      // ensure-directory operation (§4.1's AC-10 idempotency) then finds it
      // already present and records "skipped", which is correct — this
      // command is what created it, and that fact lives in the manifest's
      // own history, not in applied-steps for a step already done here.
      await mkdir(paths.configDir, { recursive: true, mode: 0o700 });
      await writeManifest(paths.manifestPath, freshInstallingManifest(paths, options));
    } else if (currentManifest.state !== "installing") {
      await writeManifest(paths.manifestPath, {
        ...currentManifest,
        state: "installing",
        "updated-at": new Date().toISOString(),
      });
    }

    const executorDeps: ExecutorDeps = {
      ...deps.executorDeps,
      // The lease covering this whole command was already acquired above
      // (or --launchd was not requested); the plan's own checkpoint op has
      // nothing further to do.
      acquireMaintenanceLease: async () => {},
    };

    const result = await applyOperations({
      operations,
      manifestPath: paths.manifestPath,
      deps: executorDeps,
    });

    if (result.failed) {
      printFailureSummary(
        deps.logger,
        result,
        `scale2sheet install --prefix ${paths.prefix}${options.launchd ? " --launchd" : ""}`,
      );
      return 1;
    }

    const afterApply = await readManifest(paths.manifestPath);
    if (afterApply) {
      await writeManifest(paths.manifestPath, {
        ...afterApply,
        state: "installed",
        version: APP_VERSION,
        "updated-at": new Date().toISOString(),
      });
    }

    deps.logger.log(`installed ${paths.binaryPath}`);
    return 0;
  } finally {
    await lease?.release();
  }
}

/** design INSTALLATION_DESIGN.md §アンインストールフロー §既定. `--purge`/`--wipe`/`--archive`/`--yes` are Slice 5. */
export async function runUninstallCommand(
  options: UninstallCliOptions,
  deps: InstallationCliDeps = defaultInstallationCliDeps(),
): Promise<number> {
  const paths = resolveInstallationPaths({ home: deps.home, prefix: options.prefix });
  const currentManifest = await readManifest(paths.manifestPath);

  if (!currentManifest) {
    deps.logger.log("nothing to do");
    return 0;
  }

  if (currentManifest.prefix !== paths.prefix) {
    deps.logger.error(
      `warning: manifest prefix ${currentManifest.prefix} differs from --prefix ${paths.prefix}; using the manifest's recorded prefix`,
    );
  }

  const operations = planUninstall({ currentManifest });

  if (options.dryRun) {
    printPlan(deps.logger, operations);
    return 0;
  }

  const manifestPath = path.join(currentManifest["config-dir"], "install-manifest.json");

  let lease: RunLeaseHandle | undefined;
  try {
    try {
      lease = await deps.acquireLease({
        kind: "maintenance",
        origin: "maintenance",
        configDir: currentManifest["config-dir"],
      });
    } catch (error) {
      deps.logger.error(error instanceof Error ? error.message : String(error));
      return 1;
    }

    if (currentManifest.state !== "uninstalling") {
      await writeManifest(manifestPath, {
        ...currentManifest,
        state: "uninstalling",
        "updated-at": new Date().toISOString(),
      });
    }

    const result = await applyOperations({
      operations,
      manifestPath,
      deps: deps.executorDeps,
    });

    if (result.failed) {
      printFailureSummary(deps.logger, result, "scale2sheet uninstall");
      return 1;
    }

    deps.logger.log(`uninstalled ${currentManifest["binary-path"]}`);
    // design §アンインストールフロー §既定 手順11: the completion screen lists
    // the absolute paths of what was left behind.
    deps.logger.log("settings, auth files, and logs remain at:");
    deps.logger.log(`  ${currentManifest["config-dir"]}`);
    deps.logger.log(`  ${currentManifest["log-dir"]}`);
    // design §共通run lease: the empty lock file and runtime directory under
    // /tmp are left for macOS's own cleanup rather than unlinked here
    // (unlinking risks a race with a lease still being acquired elsewhere).
    // They hold no secrets.
    deps.logger.log("a runtime artifact with no secrets remains under /tmp; macOS cleans it up on its own.");
    // design §アンインストールフロー §既定: the installed binary is gone, so
    // further local data purge needs a rebuild from a checkout (or a
    // re-fetched standalone binary). Shown, not executed.
    deps.logger.log("to purge local settings, auth files, and logs later, from a checkout:");
    deps.logger.log("  npm run build:bun && ./dist/scale2sheet uninstall --purge");
    deps.logger.log("this does not revoke external permissions (Google API keys, Spreadsheet sharing); revoke those separately in their consoles.");
    return 0;
  } finally {
    await lease?.release();
  }
}

export function registerInstallationCommands(
  program: Command,
  commandDeps: InstallationCommandDeps = defaultInstallationCommandDeps(),
): void {
  program
    .command("install")
    .description("Install the compiled scale2sheet binary and optionally register launchd.")
    .option("--prefix <dir>", "installation root; the binary goes to <dir>/bin/scale2sheet", "~/.local")
    .option("--launchd", "generate and register the two morning/evening LaunchAgents", false)
    .option("--dry-run", "show the planned operations without any side effects", false)
    .option("--force", "stop an active run and re-register even if one is in progress", false)
    .action(async (options: { prefix: string; launchd: boolean; dryRun: boolean; force: boolean }) => {
      process.exitCode = await commandDeps.runInstallCommand(options);
    });

  program
    .command("uninstall")
    .description("Remove the installed binary and launchd registration. Leaves settings, auth, and logs.")
    .option("--prefix <dir>", "installation root used to detect a prefix mismatch", "~/.local")
    .option("--dry-run", "show what would be removed without any side effects", false)
    .action(async (options: { prefix: string; dryRun: boolean }) => {
      process.exitCode = await commandDeps.runUninstallCommand(options);
    });

  program
    .command("doctor")
    .description("Read-only diagnosis of installation, launchd, pipeline status, and Sheets access.")
    .action(async () => {
      process.exitCode = await runDoctorCommand(commandDeps.doctor);
    });
}

export { RunLeaseError };
