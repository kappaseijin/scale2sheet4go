import path from "node:path";

import { buildPipelinePlist } from "./plist.js";
import type { LaunchdReadiness } from "./launchd-readiness.js";
import { LAUNCHD_LABEL_PREFIX, resolveInstallationPaths } from "./paths.js";
import type { InstallManifest } from "./manifest.js";
import type { InstallationOperation, InstallOptions } from "./model.js";

export class MissingAuthFilesError extends Error {
  constructor(public readonly missingFiles: readonly string[]) {
    super(`missing required auth file(s): ${missingFiles.join(", ")}`);
    this.name = "MissingAuthFilesError";
  }
}

export class LaunchdNotReadyError extends Error {
  constructor(public readonly readiness: LaunchdReadiness) {
    super("launchd installation is not ready");
    this.name = "LaunchdNotReadyError";
  }
}

export interface PlanInstallInput {
  readonly home: string;
  readonly options: InstallOptions;
  /** Read by the caller before planning; unused here except to make resume/reinstall explicit at the call site. */
  readonly currentManifest: InstallManifest | undefined;
  readonly settingsExists: boolean;
  /** Absolute paths of required auth files that a `stat` check found missing. */
  readonly missingAuthFiles: readonly string[];
  /** --launchd requires statically reproducible settings before planning any operation. */
  readonly launchdReadiness?: LaunchdReadiness;
  /** Resolved by the caller (Task 5's BinaryCopySource); planner does not touch the running process. */
  readonly binarySource: string;
}

/** design §実行時刻: morning fires at 07:00 and 11:30, evening at 21:00 and 23:30. */
const LAUNCHD_SCHEDULE: Record<"morning" | "evening", readonly { readonly hour: number; readonly minute: number }[]> = {
  morning: [{ hour: 7, minute: 0 }, { hour: 11, minute: 30 }],
  evening: [{ hour: 21, minute: 0 }, { hour: 23, minute: 30 }],
};

/**
 * design INSTALLATION_DESIGN.md §インストールフロー §計画/§適用. Returns the
 * operation sequence without touching the filesystem, launchd, or network.
 * The plan does not vary with `currentManifest`: every operation is meant to
 * be applied idempotently (design §エラーと部分適用), so resuming an
 * interrupted install or repeating a completed one re-plans identically and
 * lets the executor skip what is already done.
 */
export function planInstall(input: PlanInstallInput): readonly InstallationOperation[] {
  const paths = resolveInstallationPaths({ home: input.home, prefix: input.options.prefix });

  if (input.options.launchd && input.launchdReadiness?.status === "blocked") {
    throw new LaunchdNotReadyError(input.launchdReadiness);
  }

  /** AC-04: fail before the binary or launchd registration is touched. */
  if (input.missingAuthFiles.length > 0) {
    throw new MissingAuthFilesError(input.missingAuthFiles);
  }

  const operations: InstallationOperation[] = [
    { kind: "ensure-directory", path: paths.configDir, mode: 0o700 },
  ];

  if (!input.settingsExists) {
    operations.push({ kind: "ensure-settings", path: paths.settingsPath });
  }

  /** AC-05: zero plist/launchctl operations without --launchd. */
  if (input.options.launchd) {
    operations.push({ kind: "acquire-maintenance-lease", path: paths.activeRunPath });
  }

  operations.push(
    { kind: "ensure-directory", path: paths.binDir, mode: 0o755 },
    { kind: "ensure-directory", path: paths.logDir, mode: 0o700 },
    { kind: "replace-binary", source: input.binarySource, target: paths.binaryPath },
  );

  if (input.options.launchd) {
    const domain = `gui/${process.getuid?.() ?? 0}`;
    const periods = [
      { period: "morning" as const, plistPath: paths.morningPlistPath, stdout: paths.morningLogPath, stderr: paths.morningErrLogPath },
      { period: "evening" as const, plistPath: paths.eveningPlistPath, stdout: paths.eveningLogPath, stderr: paths.eveningErrLogPath },
    ];
    for (const { period, plistPath, stdout, stderr } of periods) {
      const label = `${LAUNCHD_LABEL_PREFIX}.${period}`;
      /** design §launchdフロー再登録: bootout, then replace the plist, then bootstrap. */
      operations.push(
        { kind: "bootout", domain, label },
        {
          kind: "write-plist",
          label,
          path: plistPath,
          xml: buildPipelinePlist({
            label,
            binaryPath: paths.binaryPath,
            period,
            stdoutPath: stdout,
            stderrPath: stderr,
            times: LAUNCHD_SCHEDULE[period],
            home: paths.home,
            binDir: paths.binDir,
          }),
        },
        { kind: "bootstrap", domain, plistPath },
      );
    }
  }

  return operations;
}

export interface PlanUninstallInput {
  /** design AC-10: the manifest's recorded paths are authoritative, not a freshly resolved --prefix. */
  readonly currentManifest: InstallManifest | undefined;
}

/**
 * design INSTALLATION_DESIGN.md §アンインストールフロー §既定. Returns an
 * empty plan when there is no manifest (AC-14: nothing to do). The plan is
 * the same whether resuming a mid-uninstall or starting fresh from
 * `installed`, for the same idempotent-operation reason as planInstall.
 */
export function planUninstall(input: PlanUninstallInput): readonly InstallationOperation[] {
  const manifest = input.currentManifest;
  if (!manifest) {
    return [];
  }

  const operations: InstallationOperation[] = [];
  const launchd = manifest.launchd;
  if (launchd) {
    for (const label of launchd.labels) {
      operations.push({ kind: "bootout", domain: launchd.domain, label });
    }
    for (const plistPath of launchd["plist-paths"]) {
      operations.push({ kind: "remove-file", path: plistPath });
    }
  }

  const configDir = manifest["config-dir"];
  const binaryPath = manifest["binary-path"];
  const binDir = path.dirname(binaryPath);
  for (const createdPath of manifest["created-paths"]) {
    if (createdPath === configDir || createdPath === binDir) {
      continue;
    }
    operations.push({ kind: "remove-tree", path: createdPath });
  }

  operations.push(
    { kind: "remove-file", path: path.join(configDir, "install-manifest.json") },
    { kind: "remove-file", path: binaryPath },
  );

  /**
   * B-1 follow-on (PR #139 review): remove-tree only deletes empty
   * directories (design §既定 step 7). The bin dir still holds the binary
   * at step 7's point in the plan, so its own cleanup is placed after the
   * binary removal above — otherwise it would always be skipped as
   * non-empty, orphaning an empty bin dir after every default uninstall.
   */
  if (manifest["created-paths"].includes(binDir)) {
    operations.push({ kind: "remove-tree", path: binDir });
  }

  return operations;
}
