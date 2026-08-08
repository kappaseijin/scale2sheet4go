import { chmod, readFile, rename, writeFile } from "node:fs/promises";

export type ManifestState = "installing" | "installed" | "uninstalling";

export interface InstallManifestLaunchd {
  readonly enabled: boolean;
  readonly domain: string;
  readonly labels: readonly string[];
  readonly "plist-paths": readonly string[];
}

/**
 * design INSTALLATION_DESIGN.md §マニフェスト. Field names are kebab-case to
 * match the on-disk JSON contract shown there verbatim.
 */
export interface InstallManifest {
  readonly "schema-version": 1;
  readonly state: ManifestState;
  readonly version: string;
  readonly prefix: string;
  readonly "binary-path": string;
  readonly "config-dir": string;
  readonly "log-dir": string;
  readonly launchd?: InstallManifestLaunchd;
  readonly "applied-steps": readonly string[];
  readonly "created-paths": readonly string[];
  readonly "updated-at": string;
}

export class ManifestSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestSchemaError";
  }
}

export class IllegalManifestTransitionError extends Error {
  constructor(
    public readonly fromState: ManifestState | undefined,
    public readonly toState: ManifestState,
  ) {
    super(`illegal manifest transition: ${fromState ?? "(none)"} -> ${toState}`);
    this.name = "IllegalManifestTransitionError";
  }
}

/**
 * design §マニフェスト: install writes `installing` before any permanent
 * mutation and only reaches `installed` by completing that pass. A write
 * that would skip `installing` (or resurrect a completed uninstall) is a
 * corrupt caller, not a legal resume, so it is rejected rather than persisted.
 */
const ALLOWED_TRANSITIONS: ReadonlySet<string> = new Set([
  "(none)->installing",
  "installing->installing",
  "installing->installed",
  "installed->installing",
  "installed->uninstalling",
  "uninstalling->uninstalling",
]);

function assertLegalTransition(fromState: ManifestState | undefined, toState: ManifestState): void {
  const key = `${fromState ?? "(none)"}->${toState}`;
  if (!ALLOWED_TRANSITIONS.has(key)) {
    throw new IllegalManifestTransitionError(fromState, toState);
  }
}

export interface WriteManifestOptions {
  readonly renameFile?: typeof rename;
}

/** Never accepted: secrets, Spreadsheet ID, and OAuth tokens do not belong in the manifest (design §マニフェスト). */
function parseManifest(value: unknown): InstallManifest {
  if (!isRecord(value)) {
    throw new ManifestSchemaError("install manifest must be a JSON object");
  }
  if (value["schema-version"] !== 1) {
    throw new ManifestSchemaError(
      `unsupported manifest schema-version ${String(value["schema-version"] ?? "missing")}`,
    );
  }
  if (!isManifestState(value.state)) {
    throw new ManifestSchemaError(`unsupported manifest state ${String(value.state)}`);
  }
  if (typeof value.version !== "string") {
    throw new ManifestSchemaError("manifest version must be a string");
  }
  if (typeof value.prefix !== "string") {
    throw new ManifestSchemaError("manifest prefix must be a string");
  }
  if (typeof value["binary-path"] !== "string") {
    throw new ManifestSchemaError("manifest binary-path must be a string");
  }
  if (typeof value["config-dir"] !== "string") {
    throw new ManifestSchemaError("manifest config-dir must be a string");
  }
  if (typeof value["log-dir"] !== "string") {
    throw new ManifestSchemaError("manifest log-dir must be a string");
  }
  if (!isStringArray(value["applied-steps"])) {
    throw new ManifestSchemaError("manifest applied-steps must be a string array");
  }
  if (!isStringArray(value["created-paths"])) {
    throw new ManifestSchemaError("manifest created-paths must be a string array");
  }
  if (typeof value["updated-at"] !== "string") {
    throw new ManifestSchemaError("manifest updated-at must be a string");
  }
  const launchd = value.launchd;
  if (launchd !== undefined && !isLaunchdManifest(launchd)) {
    throw new ManifestSchemaError("manifest launchd must match the launchd manifest shape");
  }

  return {
    "schema-version": 1,
    state: value.state,
    version: value.version,
    prefix: value.prefix,
    "binary-path": value["binary-path"],
    "config-dir": value["config-dir"],
    "log-dir": value["log-dir"],
    ...(launchd !== undefined ? { launchd } : {}),
    "applied-steps": value["applied-steps"],
    "created-paths": value["created-paths"],
    "updated-at": value["updated-at"],
  };
}

export async function readManifest(manifestPath: string): Promise<InstallManifest | undefined> {
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ManifestSchemaError(`install manifest is not valid JSON: ${String(error)}`);
  }
  return parseManifest(parsed);
}

/**
 * Atomic write: same-directory temp file, mode 0600, then rename (design
 * §配置 権限). Reads the current on-disk state first so a transition that
 * skips `installing` is rejected before anything is staged for rename.
 */
export async function writeManifest(
  manifestPath: string,
  manifest: InstallManifest,
  options: WriteManifestOptions = {},
): Promise<void> {
  const validated = parseManifest(manifest);
  const current = await readManifest(manifestPath);
  assertLegalTransition(current?.state, validated.state);
  const renameFile = options.renameFile ?? rename;
  const temporaryPath = `${manifestPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(temporaryPath, 0o600);
  await renameFile(temporaryPath, manifestPath);
}

function isManifestState(value: unknown): value is ManifestState {
  return value === "installing" || value === "installed" || value === "uninstalling";
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isLaunchdManifest(value: unknown): value is InstallManifestLaunchd {
  return isRecord(value) &&
    typeof value.enabled === "boolean" &&
    typeof value.domain === "string" &&
    isStringArray(value.labels) &&
    isStringArray(value["plist-paths"]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
