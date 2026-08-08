import { chmod, copyFile, mkdir, open, rename, rm, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { LaunchctlAdapter, type LaunchctlResult } from "./process.js";
import { readManifest, writeManifest, type InstallManifest } from "./manifest.js";
import type { InstallationOperation, OperationResult } from "./model.js";
import { loadOrCreateSettings } from "../config/settings.js";

export interface EnsureDirectoryResult {
  /** True only when this call created the directory; a pre-existing one is not "new". */
  readonly created: boolean;
}

export interface RemoveTreeResult {
  /** False when the directory was left in place (non-empty, or already gone). */
  readonly removed: boolean;
}

/**
 * One function per operation kind. Production wiring performs the real OS
 * mutation; tests inject fakes so applyOperations itself stays unit-testable.
 */
export interface ExecutorDeps {
  readonly ensureDirectory: (targetPath: string, mode: number) => Promise<EnsureDirectoryResult>;
  readonly ensureSettings: (targetPath: string) => Promise<void>;
  readonly replaceBinary: (source: string, target: string) => Promise<void>;
  readonly writePlist: (targetPath: string, xml: string) => Promise<void>;
  readonly acquireMaintenanceLease: (targetPath: string) => Promise<void>;
  readonly removeFile: (targetPath: string) => Promise<void>;
  readonly removeTree: (targetPath: string) => Promise<RemoveTreeResult>;
  readonly bootout: (domain: string, label: string) => Promise<LaunchctlResult>;
  readonly bootstrap: (domain: string, plistPath: string) => Promise<LaunchctlResult>;
  readonly logger: Pick<Console, "log">;
}

const launchctl = new LaunchctlAdapter();

/** Real, OS-touching implementation. Slice 5's archive-paths is not implemented here. */
export const defaultExecutorDeps: ExecutorDeps = {
  ensureDirectory: async (targetPath, mode) => {
    const existedBefore = await stat(targetPath).then(() => true, () => false);
    if (!existedBefore) {
      await mkdir(targetPath, { recursive: true, mode });
    }
    return { created: !existedBefore };
  },
  ensureSettings: async (targetPath) => {
    loadOrCreateSettings(targetPath);
  },
  /**
   * design §バイナリのatomic replacement: same-directory temp file, copy,
   * mode 0755, fsync, then rename. A process with the target already open
   * keeps its old inode and runs to completion; `cp`-style in-place
   * overwrite is never used. On failure only the temp file is removed.
   */
  replaceBinary: async (source, target) => {
    const temporaryPath = path.join(path.dirname(target), `.scale2sheet.tmp-${process.pid}`);
    try {
      await copyFile(source, temporaryPath);
      await chmod(temporaryPath, 0o755);
      const handle = await open(temporaryPath, "r+");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporaryPath, target);
    } catch (error) {
      await unlink(temporaryPath).catch(() => {});
      throw error;
    }
  },
  writePlist: async (targetPath, xml) => {
    const temporaryPath = `${targetPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, xml, { encoding: "utf8", mode: 0o644 });
    await rename(temporaryPath, targetPath);
  },
  acquireMaintenanceLease: async () => {
    throw new Error("acquireMaintenanceLease is not wired to run-lease.ts yet");
  },
  removeFile: async (targetPath) => {
    await rm(targetPath, { force: true });
  },
  /**
   * design §アンインストールフロー §既定 step 7: only EMPTY created-paths are
   * removed. The log dir is created by install (so it's in created-paths)
   * but after real runs holds the user's log files, which default
   * uninstall must never delete alongside the directory.
   *
   * A separate readdir-then-rm(recursive) has a TOCTOU window: a log line
   * written between the check and the delete would be removed along with
   * the directory (reviewer finding, PR #139). `rmdir` is a single
   * non-recursive syscall that atomically fails with ENOTEMPTY if the
   * directory holds anything at the moment of the call — there is no
   * separate check to race against.
   */
  removeTree: async (targetPath) => {
    try {
      await rmdir(targetPath);
      return { removed: true };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTEMPTY") {
        return { removed: false };
      }
      throw error;
    }
  },
  bootout: (domain, label) => launchctl.bootout(domain, label),
  bootstrap: (domain, plistPath) => launchctl.bootstrap(domain, plistPath),
  logger: console,
};

/** Design §エラーと部分適用: `[<status>] <kind> <target>[: <message>]`. */
export function describeOperation(operation: InstallationOperation): string {
  switch (operation.kind) {
    case "ensure-directory":
      return `ensure-directory ${operation.path}`;
    case "ensure-settings":
      return `ensure-settings ${operation.path}`;
    case "replace-binary":
      return `replace-binary ${operation.target}`;
    case "write-plist":
      return `write-plist ${operation.label}`;
    case "acquire-maintenance-lease":
      return `acquire-maintenance-lease ${operation.path}`;
    case "bootout":
      return `bootout ${operation.label}`;
    case "bootstrap":
      return `bootstrap ${operation.plistPath}`;
    case "remove-file":
      return `remove-file ${operation.path}`;
    case "remove-tree":
      return `remove-tree ${operation.path}`;
    case "archive-paths":
      return `archive-paths ${operation.target}`;
  }
}

async function applyOne(
  operation: InstallationOperation,
  deps: ExecutorDeps,
): Promise<{ readonly result: OperationResult; readonly createdPath?: string }> {
  switch (operation.kind) {
    case "ensure-directory": {
      const { created } = await deps.ensureDirectory(operation.path, operation.mode);
      return {
        result: { operation, status: created ? "done" : "skipped", message: created ? "" : "already exists" },
        ...(created ? { createdPath: operation.path } : {}),
      };
    }
    case "ensure-settings":
      await deps.ensureSettings(operation.path);
      return { result: { operation, status: "done", message: "" } };
    case "replace-binary":
      await deps.replaceBinary(operation.source, operation.target);
      return { result: { operation, status: "done", message: "" } };
    case "write-plist":
      await deps.writePlist(operation.path, operation.xml);
      return { result: { operation, status: "done", message: "" } };
    case "acquire-maintenance-lease":
      await deps.acquireMaintenanceLease(operation.path);
      return { result: { operation, status: "done", message: "" } };
    case "remove-file":
      await deps.removeFile(operation.path);
      return { result: { operation, status: "done", message: "" } };
    case "remove-tree": {
      const { removed } = await deps.removeTree(operation.path);
      return {
        result: {
          operation,
          status: removed ? "done" : "skipped",
          message: removed ? "" : "not empty, left in place",
        },
      };
    }
    case "bootout": {
      const outcome = await deps.bootout(operation.domain, operation.label);
      return { result: { operation, status: outcome.outcome, message: outcome.message } };
    }
    case "bootstrap": {
      const outcome = await deps.bootstrap(operation.domain, operation.plistPath);
      return { result: { operation, status: outcome.outcome, message: outcome.message } };
    }
    case "archive-paths":
      throw new Error("archive-paths is Slice 5 (--purge/--wipe); not implemented in Slice 3");
  }
}

export interface ApplyOperationsOptions {
  readonly operations: readonly InstallationOperation[];
  readonly manifestPath: string;
  readonly deps?: ExecutorDeps;
}

export interface ApplyOperationsResult {
  readonly results: readonly OperationResult[];
  /** design §エラーと部分適用: the step id of the operation that failed, if any. */
  readonly failed?: string;
  /** Step ids for operations never reached because of an earlier failure. No automatic rollback. */
  readonly pending: readonly string[];
}

/**
 * Applies one operation at a time, in order, and updates the manifest after
 * each. Stops at the first failure without rolling back what already
 * succeeded (design §エラーと部分適用): the caller re-runs the same command,
 * and each operation's own idempotency (ensure-directory checks existence,
 * bootout checks registration, ...) makes that safe.
 */
export async function applyOperations(options: ApplyOperationsOptions): Promise<ApplyOperationsResult> {
  const deps = options.deps ?? defaultExecutorDeps;
  const results: OperationResult[] = [];
  /**
   * design §アンインストールフロー §既定 step 8-9: the plan itself removes the
   * manifest, then removes the binary as the final step. Once that removal
   * succeeds there is nothing left to record progress into, so recordStep is
   * skipped for the rest of the plan instead of failing on a manifest this
   * same run just deleted.
   */
  let manifestRemoved = false;

  for (let index = 0; index < options.operations.length; index += 1) {
    const operation = options.operations[index]!;
    const stepId = describeOperation(operation);

    let outcome: { readonly result: OperationResult; readonly createdPath?: string };
    try {
      outcome = await applyOne(operation, deps);
    } catch (error) {
      outcome = {
        result: {
          operation,
          status: "failed",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }

    results.push(outcome.result);
    deps.logger.log(
      `[${outcome.result.status}] ${stepId}${outcome.result.message ? `: ${outcome.result.message}` : ""}`,
    );

    const removesManifestItself =
      outcome.result.status === "done" &&
      operation.kind === "remove-file" &&
      operation.path === options.manifestPath;

    if (outcome.result.status !== "failed" && !manifestRemoved && !removesManifestItself) {
      await recordStep(options.manifestPath, stepId, outcome.createdPath);
    }

    if (removesManifestItself) {
      manifestRemoved = true;
    }

    if (outcome.result.status === "failed") {
      const pending = options.operations
        .slice(index + 1)
        .map((remaining) => describeOperation(remaining));
      return { results, failed: stepId, pending };
    }
  }

  return { results, pending: [] };
}

async function recordStep(manifestPath: string, stepId: string, createdPath: string | undefined): Promise<void> {
  const current = await readManifest(manifestPath);
  if (!current) {
    throw new Error(`cannot record installation progress: no manifest at ${manifestPath}`);
  }
  const next: InstallManifest = {
    ...current,
    "applied-steps": [...current["applied-steps"], stepId],
    ...(createdPath ? { "created-paths": [...current["created-paths"], createdPath] } : {}),
    "updated-at": new Date().toISOString(),
  };
  await writeManifest(manifestPath, next);
}
