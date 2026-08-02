import {
  closeSync,
  chmodSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statfsSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import net from "node:net";
import os from "node:os";
import path from "node:path";

/** Darwin sys/fcntl.h O_EXLOCK. node:fs deliberately does not export it. */
export const O_EXLOCK_DARWIN = 0x0020;
const APFS_FILESYSTEM_TYPE = 0x1a;
const SOCKET_PATH_MAX_BYTES = 103;

export class RunLeaseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RunLeaseError";
  }
}

export class RunLeaseConflictError extends RunLeaseError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RunLeaseConflictError";
  }
}

export interface AcquireRunLeaseOptions {
  readonly configDir?: string;
  readonly kind?: "serve" | "pipeline" | "maintenance";
  readonly origin?: "launchd" | "manual" | "maintenance";
  readonly period?: "morning" | "evening";
  readonly launchdLabel?: string;
  readonly platform?: NodeJS.Platform;
  readonly stopPollMilliseconds?: number;
}

interface RunReceipt {
  readonly "owner-token": string;
  readonly "socket-path": string;
  readonly kind: "serve" | "pipeline" | "maintenance";
  readonly origin: "launchd" | "manual" | "maintenance";
  readonly period?: "morning" | "evening";
  readonly "launchd-label"?: string;
  readonly pid: number;
  readonly "started-at": string;
}

export interface RunLeaseHandle {
  readonly ownerToken: string;
  readonly socketPath: string;
  readonly receiptPath: string;
  readonly lockPath: string;
  startStopPolling(onStop: () => void): void;
  release(): Promise<void>;
}

/** Builds the only supported lock flags and asserts the raw Darwin bit survives. */
export function buildLockFlags(): number {
  const flags =
    constants.O_CREAT |
    constants.O_RDWR |
    O_EXLOCK_DARWIN |
    constants.O_NONBLOCK |
    constants.O_NOFOLLOW;
  if ((flags & O_EXLOCK_DARWIN) === 0) {
    throw new RunLeaseError("Darwin O_EXLOCK flag is missing from lock flags");
  }
  return flags;
}

export async function acquireRunLease(
  options: AcquireRunLeaseOptions,
): Promise<RunLeaseHandle> {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin") {
    throw new RunLeaseError("run lease is supported only on macOS");
  }

  const physicalConfigDir = physicalPath(
    options.configDir ?? path.join(os.homedir(), ".config", "scale2sheet"),
  );
  const namespace = createHash("sha256")
    .update(physicalConfigDir)
    .digest("hex")
    .slice(0, 16);
  const runtimeDir = path.join("/tmp", `scale2sheet-${process.getuid?.() ?? 0}-${namespace}`);
  ensureRuntimeDirectory(runtimeDir);

  const lockPath = path.join(runtimeDir, "active-run.lock");
  const receiptPath = path.join(physicalConfigDir, "active-run.json");
  const ownerToken = randomBytes(16).toString("hex");
  const socketPath = path.join(runtimeDir, `run-${ownerToken}.sock`);
  if (Buffer.byteLength(socketPath, "utf8") > SOCKET_PATH_MAX_BYTES) {
    throw new RunLeaseError(`run lease socket path exceeds ${SOCKET_PATH_MAX_BYTES} bytes`);
  }

  let descriptor: number;
  try {
    descriptor = openSync(lockPath, buildLockFlags(), 0o600);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EAGAIN" || code === "EWOULDBLOCK") {
      throw new RunLeaseConflictError("another scale2sheet run lease is active", {
        cause: error,
      });
    }
    throw new RunLeaseError(`cannot acquire run lease: ${code ?? String(error)}`, {
      cause: error,
    });
  }

  try {
    validateLockDescriptor(descriptor);
    recoverDeadOwner(receiptPath, runtimeDir);
    const server = await listenOwnerSocket(socketPath, ownerToken);
    const receipt: RunReceipt = {
      "owner-token": ownerToken,
      "socket-path": socketPath,
      kind: options.kind ?? "serve",
      origin: options.origin ?? "manual",
      pid: process.pid,
      "started-at": new Date().toISOString(),
      ...(options.period ? { period: options.period } : {}),
      ...(options.launchdLabel ? { "launchd-label": options.launchdLabel } : {}),
    };
    writeAtomically(receiptPath, JSON.stringify(receipt) + "\n", 0o600);
    return new LeaseHandle({
      descriptor,
      ownerToken,
      socketPath,
      receiptPath,
      lockPath,
      server,
      stopPath: path.join(physicalConfigDir, `active-run.stop.${ownerToken}.json`),
      stopPollMilliseconds: options.stopPollMilliseconds ?? 15_000,
    });
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

export async function requestCooperativeStop(
  configDir: string,
  ownerToken: string,
): Promise<void> {
  if (!/^[a-f0-9]{32,}$/u.test(ownerToken)) {
    throw new RunLeaseError("invalid run lease owner token");
  }
  const physicalConfigDir = physicalPath(configDir);
  const stopPath = path.join(physicalConfigDir, `active-run.stop.${ownerToken}.json`);
  writeAtomically(stopPath, JSON.stringify({ "owner-token": ownerToken }) + "\n", 0o600);
}

class LeaseHandle implements RunLeaseHandle {
  private released = false;
  private stopTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly state: {
      readonly descriptor: number;
      readonly ownerToken: string;
      readonly socketPath: string;
      readonly receiptPath: string;
      readonly lockPath: string;
      readonly server: net.Server;
      readonly stopPath: string;
      readonly stopPollMilliseconds: number;
    },
  ) {}

  get ownerToken(): string {
    return this.state.ownerToken;
  }

  get socketPath(): string {
    return this.state.socketPath;
  }

  get receiptPath(): string {
    return this.state.receiptPath;
  }

  get lockPath(): string {
    return this.state.lockPath;
  }

  startStopPolling(onStop: () => void): void {
    if (this.stopTimer) {
      return;
    }
    this.stopTimer = setInterval(() => {
      if (this.ownsStopRequest()) {
        clearInterval(this.stopTimer);
        this.stopTimer = undefined;
        onStop();
      }
    }, this.state.stopPollMilliseconds);
    this.stopTimer.unref();
  }

  async release(): Promise<void> {
    if (this.released) {
      return;
    }
    this.released = true;
    if (this.stopTimer) {
      clearInterval(this.stopTimer);
      this.stopTimer = undefined;
    }
    await new Promise<void>((resolve, reject) => {
      this.state.server.close((error) => (error ? reject(error) : resolve()));
    });
    removeIfExists(this.state.socketPath);
    removeOwnedFile(this.state.receiptPath, this.state.ownerToken);
    removeOwnedFile(this.state.stopPath, this.state.ownerToken);
    closeSync(this.state.descriptor);
  }

  private ownsStopRequest(): boolean {
    try {
      const request = JSON.parse(readFileSync(this.state.stopPath, "utf8")) as {
        "owner-token"?: unknown;
      };
      return request["owner-token"] === this.state.ownerToken;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }
      return false;
    }
  }
}

function physicalPath(inputPath: string): string {
  const absolutePath = path.resolve(inputPath);
  const missingSuffix: string[] = [];
  let cursor = absolutePath;
  while (true) {
    try {
      return path.join(realpathSync(cursor), ...missingSuffix.reverse());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new RunLeaseError(`cannot resolve configuration path: ${cursor}`, {
          cause: error,
        });
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) {
        throw new RunLeaseError(`configuration path has no existing ancestor: ${absolutePath}`);
      }
      missingSuffix.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

function ensureRuntimeDirectory(runtimeDir: string): void {
  const type = Number(statfsSync("/private/tmp").type);
  if (type !== APFS_FILESYSTEM_TYPE) {
    throw new RunLeaseError("/private/tmp must be on APFS for run lease safety");
  }
  if (!existsSync(runtimeDir)) {
    mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  }
  const stat = lstatSync(runtimeDir);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== (process.getuid?.() ?? stat.uid) ||
    (stat.mode & 0o777) !== 0o700
  ) {
    throw new RunLeaseError("run lease runtime directory has unsafe owner, mode, or type");
  }
}

function validateLockDescriptor(descriptor: number): void {
  const stat = fstatSync(descriptor);
  if (
    !stat.isFile() ||
    stat.uid !== (process.getuid?.() ?? stat.uid) ||
    (stat.mode & 0o777) !== 0o600
  ) {
    throw new RunLeaseError("run lease lock file has unsafe owner, mode, or type");
  }
}

async function listenOwnerSocket(socketPath: string, ownerToken: string): Promise<net.Server> {
  const server = net.createServer((socket) => socket.end(ownerToken));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
  try {
    chmodSync(socketPath, 0o600);
  } catch (error) {
    server.close();
    throw new RunLeaseError("cannot set owner socket permissions", { cause: error });
  }
  return server;
}

function recoverDeadOwner(receiptPath: string, runtimeDir: string): void {
  try {
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as RunReceipt;
    if (
      typeof receipt["owner-token"] === "string" &&
      typeof receipt["socket-path"] === "string" &&
      receipt["socket-path"] ===
        path.join(runtimeDir, `run-${receipt["owner-token"]}.sock`)
    ) {
      removeIfExists(receipt["socket-path"]);
      removeIfExists(receiptPath);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new RunLeaseError("existing run lease receipt is invalid; state is unknown", {
        cause: error,
      });
    }
  }
}

function writeAtomically(filePath: string, content: string, mode: number): void {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  writeFileSync(temporaryPath, content, { mode });
  renameSync(temporaryPath, filePath);
}

function removeOwnedFile(filePath: string, ownerToken: string): void {
  try {
    const value = JSON.parse(readFileSync(filePath, "utf8")) as { "owner-token"?: unknown };
    if (value["owner-token"] === ownerToken) {
      unlinkSync(filePath);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

function removeIfExists(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}
