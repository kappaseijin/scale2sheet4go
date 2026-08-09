import { DateTime } from "luxon";

import type { GoogleFitCredentialsFile, SettingsFile } from "../config/settings.js";
import type { PipelineStatusDocumentV1 } from "../pipeline/status.js";
import type { ActiveRunReceiptInfo } from "../scheduler/run-lease.js";
import { buildSheetColumnMapping } from "../sheets/adapter.js";
import type { InstallManifest } from "./manifest.js";
import type { InstallationPaths } from "./paths.js";
import { LAUNCHD_LABEL_PREFIX } from "./paths.js";
import type { SheetsReadPort } from "./sheets-read.js";

export type DoctorStatus = "PASS" | "WARN" | "FAIL";

/** design §doctor §診断契約: the eight failure-stage codes, verbatim. */
export type DoctorFailureStage =
  | "KEY_MISSING"
  | "AUTH_FAILED"
  | "SHEET_NOT_SHARED"
  | "TODAY_ROW_MISSING"
  | "INSTALL_PATH_MISMATCH"
  | "BINARY_NOT_EXECUTABLE"
  | "BINARY_VERSION_MISMATCH"
  | "LAST_RUN_FAILED";

export interface DoctorCheckResult {
  readonly id: string;
  readonly status: DoctorStatus;
  readonly stage?: DoctorFailureStage;
  readonly message: string;
}

export interface DoctorReport {
  readonly status: DoctorStatus;
  readonly checks: readonly DoctorCheckResult[];
}

/**
 * design §モジュール境界: `doctor.ts` uses the same path resolver and
 * process adapter as `planner.ts`, but has no write-capable dependency —
 * `readManifest`/`readSettings` are read-only functions (not the
 * write-capable manifest.ts/settings.ts exports), `process` exposes only
 * `isRegistered`/`printRaw` (no bootout/bootstrap), and `sheets` is the
 * write-method-free `SheetsReadPort` from Task 1. This absence of any
 * write-capable dependency is the structural guarantee behind N-3
 * ("doctor が manifest の state を書き直す" cannot happen: there is nothing
 * injected that could).
 */
export interface DoctorDeps {
  readonly paths: InstallationPaths;
  /** `process.execPath` of the binary currently running as `doctor`. */
  readonly execPath: string;
  readonly appVersion: string;
  readonly now: () => DateTime;
  readonly readManifest: (manifestPath: string) => Promise<InstallManifest | undefined>;
  readonly readSettings: (settingsPath: string) => SettingsFile | undefined;
  /** Same precedence inputs as loadConfig: environment, settings, then credentials file fallback. */
  readonly environment: Pick<NodeJS.ProcessEnv, "GOOGLE_FIT_CLIENT_ID" | "GOOGLE_FIT_CLIENT_SECRET">;
  readonly readGoogleFitCredentials: (configDir: string) => GoogleFitCredentialsFile | undefined;
  readonly process: {
    readonly isRegistered: (domain: string, label: string) => Promise<boolean>;
    readonly printRaw: (domain: string, label: string) => Promise<{ readonly exitCode: number; readonly stdout: string }>;
  };
  readonly sheets: SheetsReadPort;
  readonly statFile: (
    filePath: string,
  ) => Promise<{ readonly executable: boolean; readonly readable: boolean } | undefined>;
  readonly readTextFile: (filePath: string) => Promise<string | undefined>;
  readonly readActiveRunReceipt: (configDir: string) => ActiveRunReceiptInfo | undefined;
  readonly readPipelineStatus: (statusPath: string) => Promise<PipelineStatusDocumentV1 | undefined>;
}

function pass(id: string, message: string): DoctorCheckResult {
  return { id, status: "PASS", message };
}
function warn(id: string, message: string): DoctorCheckResult {
  return { id, status: "WARN", message };
}
function fail(id: string, message: string, stage?: DoctorFailureStage): DoctorCheckResult {
  return { id, status: "FAIL", message, ...(stage ? { stage } : {}) };
}

/**
 * design INSTALLATION_DESIGN.md §doctor. Runs all 14 checks and aggregates
 * to the worst status found (FAIL > WARN > PASS). Never writes anything —
 * every dependency here is read-only by type. `install`/`uninstall` never
 * call this (design §doctor: "install は doctor を呼ばない", enforced by
 * doctor.ts having no caller in planner.ts/executor.ts, only in the CLI's
 * own `doctor` command wiring in Task 4).
 */
export async function runDoctor(deps: DoctorDeps): Promise<DoctorReport> {
  const checks: DoctorCheckResult[] = [];

  const manifest = await checkManifest(deps, checks);
  const settings = checkSettings(deps, checks);

  if (manifest) {
    await checkBinaryPlacement(deps, manifest, checks);
    await checkBinaryExecutable(deps, manifest, checks);
    checkBinaryVersion(deps, manifest, checks);
    await checkLaunchdRegistration(deps, checks);
    await checkLaunchdDiagnostic(deps, checks);
  }

  const executionRoute = await checkPlistSyntax(deps, checks);

  if (settings) {
    await checkSheetsKeyFile(deps, settings, checks);
    await checkSourceAuthFile(deps, settings, checks);
    await checkScaleExporterOutputDir(deps, settings, checks);
  }

  checkServeLiveness(deps, checks);
  await checkLastRun(deps, checks, executionRoute);

  if (settings) {
    await checkSheetsAuthAndRead(deps, checks);
  }

  const status = aggregate(checks);
  return { status, checks };
}

function aggregate(checks: readonly DoctorCheckResult[]): DoctorStatus {
  if (checks.some((check) => check.status === "FAIL")) {
    return "FAIL";
  }
  if (checks.some((check) => check.status === "WARN")) {
    return "WARN";
  }
  return "PASS";
}

/** 1. manifest の schema と state. */
async function checkManifest(
  deps: DoctorDeps,
  checks: DoctorCheckResult[],
): Promise<InstallManifest | undefined> {
  const manifest = await deps.readManifest(deps.paths.manifestPath);
  if (!manifest) {
    // design §doctor: "インストールしていない状態は WARN とする".
    checks.push(warn("manifest", "not installed: no install manifest found"));
    return undefined;
  }
  checks.push(pass("manifest", `manifest state: ${manifest.state}, version ${manifest.version}`));
  return manifest;
}

/** 2a. 実行中バイナリ / manifest の配置先整合性. */
async function checkBinaryPlacement(
  deps: DoctorDeps,
  manifest: InstallManifest,
  checks: DoctorCheckResult[],
): Promise<void> {
  if (deps.execPath !== manifest["binary-path"]) {
    checks.push(
      fail(
        "binary-placement",
        `running binary ${deps.execPath} does not match the manifest's recorded path ${manifest["binary-path"]}`,
        "INSTALL_PATH_MISMATCH",
      ),
    );
    return;
  }
  checks.push(pass("binary-placement", `running binary matches manifest: ${manifest["binary-path"]}`));
}

/** 2b. 実行権限. */
async function checkBinaryExecutable(
  deps: DoctorDeps,
  manifest: InstallManifest,
  checks: DoctorCheckResult[],
): Promise<void> {
  const stat = await deps.statFile(manifest["binary-path"]);
  if (!stat || !stat.executable) {
    checks.push(
      fail(
        "binary-executable",
        `${manifest["binary-path"]} is missing or not executable`,
        "BINARY_NOT_EXECUTABLE",
      ),
    );
    return;
  }
  checks.push(pass("binary-executable", `${manifest["binary-path"]} is executable`));
}

/** 2c. --version（manifest の version と一致するか）. */
function checkBinaryVersion(deps: DoctorDeps, manifest: InstallManifest, checks: DoctorCheckResult[]): void {
  if (deps.appVersion !== manifest.version) {
    checks.push(
      fail(
        "binary-version",
        `running version ${deps.appVersion} does not match manifest version ${manifest.version}`,
        "BINARY_VERSION_MISMATCH",
      ),
    );
    return;
  }
  checks.push(pass("binary-version", `version ${deps.appVersion} matches manifest`));
}

/** 3. settings.json の JSON と schema. */
function checkSettings(deps: DoctorDeps, checks: DoctorCheckResult[]): SettingsFile | undefined {
  let settings: SettingsFile | undefined;
  try {
    settings = deps.readSettings(deps.paths.settingsPath);
  } catch (error) {
    checks.push(fail("settings", error instanceof Error ? error.message : String(error)));
    return undefined;
  }
  if (!settings) {
    checks.push(warn("settings", "no settings.json found"));
    return undefined;
  }
  checks.push(pass("settings", "settings.json parses and validates"));
  return settings;
}

/** 4. Google Sheets 鍵ファイルの存在と読取可否. */
async function checkSheetsKeyFile(
  deps: DoctorDeps,
  settings: SettingsFile,
  checks: DoctorCheckResult[],
): Promise<void> {
  const credentialsPath = settings["sheets-credentials"];
  if (!credentialsPath) {
    checks.push(warn("sheets-key-file", "sheets-credentials is not configured"));
    return;
  }
  const stat = await deps.statFile(credentialsPath);
  if (!stat || !stat.readable) {
    checks.push(fail("sheets-key-file", `${credentialsPath} is missing or unreadable`, "KEY_MISSING"));
    return;
  }
  checks.push(pass("sheets-key-file", `${credentialsPath} exists and is readable`));
}

/** 5. source に必要な追加認証ファイル（google-fit のみ）. */
async function checkSourceAuthFile(
  deps: DoctorDeps,
  settings: SettingsFile,
  checks: DoctorCheckResult[],
): Promise<void> {
  if ((settings.source ?? "scale-exporter") !== "google-fit") {
    checks.push(pass("source-auth-file", "source is not google-fit; no extra auth file required"));
    return;
  }
  let clientId = nonEmpty(deps.environment.GOOGLE_FIT_CLIENT_ID) ?? settings["google-fit-client-id"];
  let clientSecret = nonEmpty(deps.environment.GOOGLE_FIT_CLIENT_SECRET) ?? settings["google-fit-client-secret"];
  if (!clientId || !clientSecret) {
    try {
      const credentials = deps.readGoogleFitCredentials(deps.paths.configDir);
      if (credentials) {
        clientId = credentials.clientId;
        clientSecret = credentials.clientSecret;
      }
    } catch (error) {
      checks.push(fail("source-auth-file", error instanceof Error ? error.message : String(error), "KEY_MISSING"));
      return;
    }
  }
  if (!clientId || !clientSecret) {
    checks.push(fail("source-auth-file", "google-fit client credentials are not configured", "KEY_MISSING"));
    return;
  }
  // GOOGLE_FIT_REDIRECT_URI has a zod default, so it cannot be absent at
  // startup. google-fit-token-path is not part of requireGoogleFitConfig's
  // startup gate either; neither belongs in this readiness verdict.
  checks.push(pass("source-auth-file", "google-fit client credentials are configured"));
}

function nonEmpty(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

/** 6. scale_exporter 出力ディレクトリの存在と読取可否. */
async function checkScaleExporterOutputDir(
  deps: DoctorDeps,
  settings: SettingsFile,
  checks: DoctorCheckResult[],
): Promise<void> {
  const outputDir = settings["scale-exporter-output-dir"];
  if (!outputDir) {
    checks.push(warn("scale-exporter-output-dir", "scale-exporter-output-dir is not configured"));
    return;
  }
  const stat = await deps.statFile(outputDir);
  if (!stat || !stat.readable) {
    checks.push(fail("scale-exporter-output-dir", `${outputDir} is missing or unreadable`));
    return;
  }
  checks.push(pass("scale-exporter-output-dir", `${outputDir} exists and is readable`));
}

type PipelineExecutionRoute = "legacy" | "installed";

/** 7. 二つの plist の構文と固定チェックアウトパスの不在. */
async function checkPlistSyntax(
  deps: DoctorDeps,
  checks: DoctorCheckResult[],
): Promise<PipelineExecutionRoute | undefined> {
  const problems: string[] = [];
  const routes = new Set<PipelineExecutionRoute>();
  const legacyPaths: string[] = [];
  let seenAny = false;
  for (const plistPath of [deps.paths.morningPlistPath, deps.paths.eveningPlistPath]) {
    const xml = await deps.readTextFile(plistPath);
    if (xml === undefined) {
      continue;
    }
    seenAny = true;
    if (!xml.includes("<plist") || !xml.includes("</plist>")) {
      problems.push(`${plistPath}: does not look like a well-formed plist`);
    }
    const route = executionRouteFromProgramArguments(xml);
    if (!route) {
      problems.push(`${plistPath}: cannot determine execution route from ProgramArguments`);
    } else {
      routes.add(route);
    }
    if (xml.includes("scripts/run-pipeline.sh")) {
      legacyPaths.push(plistPath);
    }
  }
  if (!seenAny) {
    checks.push(warn("plist-syntax", "no plist files found (not registered with launchd)"));
    return undefined;
  }
  if (routes.size > 1) {
    problems.push("morning and evening plists use different execution routes");
  }
  const route = routes.values().next().value as PipelineExecutionRoute | undefined;
  if (legacyPaths.length > 0 && route !== "legacy") {
    problems.push(`${legacyPaths.join(", ")}: references the retired scripts/run-pipeline.sh checkout path`);
  }
  if (problems.length > 0) {
    checks.push(fail("plist-syntax", problems.join("; ")));
    return undefined;
  }
  if (route === "legacy") {
    checks.push(
      warn(
        "plist-syntax",
        "legacy route uses scripts/run-pipeline.sh; this is expected before cutover and pipeline-status.json is not written on this route",
      ),
    );
    return route;
  }
  checks.push(pass("plist-syntax", "both plists are well-formed and reference no retired checkout path"));
  return route;
}

function executionRouteFromProgramArguments(xml: string): PipelineExecutionRoute | undefined {
  const array = xml.match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/)?.[1];
  if (!array) {
    return undefined;
  }
  const args = [...array.matchAll(/<string>(.*?)<\/string>/g)].map((match) => match[1] ?? "");
  if (args.some((arg) => arg.endsWith("/scripts/run-pipeline.sh"))) {
    return "legacy";
  }
  if (args[1] === "pipeline" && args.includes("--period")) {
    return "installed";
  }
  return undefined;
}

/** 8. 二つの launchd label の登録状態. */
async function checkLaunchdRegistration(deps: DoctorDeps, checks: DoctorCheckResult[]): Promise<void> {
  const domain = `gui/${process.getuid?.() ?? 0}`;
  const morningLabel = `${LAUNCHD_LABEL_PREFIX}.morning`;
  const eveningLabel = `${LAUNCHD_LABEL_PREFIX}.evening`;
  const [morning, evening] = await Promise.all([
    deps.process.isRegistered(domain, morningLabel),
    deps.process.isRegistered(domain, eveningLabel),
  ]);
  if (morning && evening) {
    checks.push(pass("launchd-registration", "both morning and evening labels are registered"));
    return;
  }
  const unregistered = [!morning ? "morning" : undefined, !evening ? "evening" : undefined]
    .filter((label): label is string => label !== undefined);
  checks.push(warn("launchd-registration", `not registered: ${unregistered.join(", ")}`));
}

/** 9. 登録有無、best-effort の raw 診断出力、stderr ログの存在. */
async function checkLaunchdDiagnostic(deps: DoctorDeps, checks: DoctorCheckResult[]): Promise<void> {
  const domain = `gui/${process.getuid?.() ?? 0}`;
  const morningRaw = await deps.process.printRaw(domain, `${LAUNCHD_LABEL_PREFIX}.morning`);
  const eveningRaw = await deps.process.printRaw(domain, `${LAUNCHD_LABEL_PREFIX}.evening`);
  const morningErrExists = (await deps.statFile(deps.paths.morningErrLogPath)) !== undefined;
  const eveningErrExists = (await deps.statFile(deps.paths.eveningErrLogPath)) !== undefined;

  if (!morningErrExists && !eveningErrExists) {
    checks.push(warn("launchd-diagnostic", "no stderr logs yet (launchd has not run either job)"));
    return;
  }
  checks.push(
    pass(
      "launchd-diagnostic",
      `morning: exit ${morningRaw.exitCode} "${morningRaw.stdout.trim()}"; evening: exit ${eveningRaw.exitCode} "${eveningRaw.stdout.trim()}"`,
    ),
  );
}

/** 10. run receipt による serve の稼働状態. */
function checkServeLiveness(deps: DoctorDeps, checks: DoctorCheckResult[]): void {
  const receipt = deps.readActiveRunReceipt(deps.paths.configDir);
  if (!receipt || receipt.kind !== "serve") {
    checks.push(pass("serve-liveness", "serve is not running"));
    return;
  }
  checks.push(pass("serve-liveness", `serve is running (pid ${receipt.pid}, started ${receipt.startedAt})`));
}

/** 11. pipeline-status.json の直近開始・完了・結果. */
async function checkLastRun(
  deps: DoctorDeps,
  checks: DoctorCheckResult[],
  executionRoute: PipelineExecutionRoute | undefined,
): Promise<void> {
  const document = await deps.readPipelineStatus(deps.paths.pipelineStatusPath);
  if (!document) {
    if (executionRoute === "legacy") {
      checks.push(pass("last-run", "pipeline-status.json is not written on this route (legacy run)"));
      return;
    }
    if (executionRoute === "installed") {
      checks.push(warn("last-run", "pipeline-status.json is missing: installed pipeline has not executed yet"));
      return;
    }
    checks.push(warn("last-run", "no pipeline-status.json yet (execution route is unobserved)"));
    return;
  }

  const failures: string[] = [];
  const summaries: string[] = [];
  for (const period of ["morning", "evening"] as const) {
    const periodStatus = document.periods[period];
    const terminal = periodStatus.lastTerminal;
    if (!terminal) {
      summaries.push(`${period}: unobserved`);
      continue;
    }
    summaries.push([
      `${period}: ${terminal.outcome}`,
      `target date ${terminal.targetDate}`,
      `started ${terminal.startedAt}`,
      `completed ${terminal.completedAt}`,
      `transferred cells ${terminal.v3?.transfer.transferredCellCount ?? "unobserved"}`,
      formatLastObserved("last done", periodStatus.lastDoneAt, deps.now()),
      formatLastObserved("last actual transfer", periodStatus.lastTransferredAt, deps.now()),
      ...(terminal.partialInput ? ["partial input true"] : []),
    ].join(", "));
    if (terminal.outcome.startsWith("failed:")) {
      failures.push(period);
    }
  }

  summaries.push(
    `APP_VERSION ${deps.appVersion}`,
    `morning stderr ${deps.paths.morningErrLogPath}`,
    `evening stderr ${deps.paths.eveningErrLogPath}`,
  );

  if (failures.length > 0) {
    checks.push(fail("last-run", summaries.join("; "), "LAST_RUN_FAILED"));
    return;
  }
  checks.push(pass("last-run", summaries.join("; ")));
}

function formatLastObserved(label: string, observedAt: string | undefined, now: DateTime): string {
  if (!observedAt) {
    return `${label} unobserved`;
  }
  const elapsedDays = Math.floor(Math.max(0, now.toMillis() - DateTime.fromISO(observedAt).toMillis()) / (24 * 60 * 60 * 1000));
  return `${label} ${observedAt} (${elapsedDays} days ago)`;
}

/** 12+13+14: Google Sheets 認証 / 対象 Spreadsheet と対象 sheet の読取 / 日付列と当日行の特定. */
async function checkSheetsAuthAndRead(deps: DoctorDeps, checks: DoctorCheckResult[]): Promise<void> {
  try {
    await deps.sheets.authenticate();
  } catch (error) {
    checks.push(fail("sheets-auth", error instanceof Error ? error.message : String(error), "AUTH_FAILED"));
    return;
  }
  checks.push(pass("sheets-auth", "Google Sheets authentication succeeded"));

  let headerRow: readonly unknown[];
  try {
    headerRow = await deps.sheets.readHeaderRow();
  } catch (error) {
    checks.push(fail("sheets-read", error instanceof Error ? error.message : String(error), "SHEET_NOT_SHARED"));
    return;
  }
  checks.push(pass("sheets-read", `header row read: ${headerRow.length} column(s)`));

  let dateColumnIndex: number;
  try {
    // Reuse the transfer path's normalized, exact `月日` header contract so
    // doctor cannot diagnose a production sheet by a different rule.
    dateColumnIndex = buildSheetColumnMapping(headerRow).dateColumnIndex;
  } catch (error) {
    checks.push(fail("today-row", error instanceof Error ? error.message : String(error), "TODAY_ROW_MISSING"));
    return;
  }

  const rowNumber = await deps.sheets.findTodayRow(dateColumnIndex, deps.now());
  if (rowNumber === undefined) {
    checks.push(fail("today-row", "no row matches today's date", "TODAY_ROW_MISSING"));
    return;
  }
  checks.push(pass("today-row", `today's row: ${rowNumber}`));
}
