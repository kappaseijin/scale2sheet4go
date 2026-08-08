import path from "node:path";

/**
 * User decision (2026-08-06): reject these regardless of write permission, to
 * prevent a mistyped --prefix from writing into system-owned or home-root
 * locations. $HOME itself is denied; a subdirectory of it (e.g. ~/.local) is not.
 */
const DENIED_PREFIXES = ["/", "/usr", "/bin", "/sbin", "/etc", "/System", "/Library"] as const;

export class DangerousPrefixError extends Error {
  constructor(public readonly prefix: string) {
    super(`refusing to install under dangerous prefix: ${prefix}`);
    this.name = "DangerousPrefixError";
  }
}

export interface InstallationPaths {
  readonly home: string;
  readonly prefix: string;
  readonly binDir: string;
  readonly binaryPath: string;
  readonly configDir: string;
  readonly settingsPath: string;
  readonly manifestPath: string;
  readonly activeRunPath: string;
  readonly pipelineStatusPath: string;
  readonly launchAgentsDir: string;
  readonly morningPlistPath: string;
  readonly eveningPlistPath: string;
  readonly logDir: string;
  readonly morningLogPath: string;
  readonly morningErrLogPath: string;
  readonly eveningLogPath: string;
  readonly eveningErrLogPath: string;
}

export interface ResolveInstallationPathsOptions {
  readonly home: string;
  readonly prefix: string;
}

export const LAUNCHD_LABEL_PREFIX = "jp.seijin.kappa.scale-pipeline";

/** Expands a leading `~` against home, then resolves to an absolute, clean path. */
export function normalizePath(input: string, home: string): string {
  const expanded = input === "~"
    ? home
    : input.startsWith("~/")
      ? path.join(home, input.slice(2))
      : input;
  return path.resolve(expanded);
}

function assertSafePrefix(prefix: string, home: string): void {
  const normalizedHome = path.resolve(home);
  if (prefix === normalizedHome || (DENIED_PREFIXES as readonly string[]).includes(prefix)) {
    throw new DangerousPrefixError(prefix);
  }
}

/**
 * design §配置: only the binary path moves with --prefix. Config, logs, and
 * LaunchAgents are always under $HOME.
 */
export function resolveInstallationPaths(
  options: ResolveInstallationPathsOptions,
): InstallationPaths {
  const home = path.resolve(options.home);
  const prefix = normalizePath(options.prefix, home);
  assertSafePrefix(prefix, home);

  const binDir = path.join(prefix, "bin");
  const configDir = path.join(home, ".config", "scale2sheet");
  const launchAgentsDir = path.join(home, "Library", "LaunchAgents");
  const logDir = path.join(home, "Library", "Logs", "scale-pipeline");

  return {
    home,
    prefix,
    binDir,
    binaryPath: path.join(binDir, "scale2sheet"),
    configDir,
    settingsPath: path.join(configDir, "settings.json"),
    manifestPath: path.join(configDir, "install-manifest.json"),
    activeRunPath: path.join(configDir, "active-run.json"),
    pipelineStatusPath: path.join(configDir, "pipeline-status.json"),
    launchAgentsDir,
    morningPlistPath: path.join(launchAgentsDir, `${LAUNCHD_LABEL_PREFIX}.morning.plist`),
    eveningPlistPath: path.join(launchAgentsDir, `${LAUNCHD_LABEL_PREFIX}.evening.plist`),
    logDir,
    morningLogPath: path.join(logDir, "morning.log"),
    morningErrLogPath: path.join(logDir, "morning.err.log"),
    eveningLogPath: path.join(logDir, "evening.log"),
    eveningErrLogPath: path.join(logDir, "evening.err.log"),
  };
}
