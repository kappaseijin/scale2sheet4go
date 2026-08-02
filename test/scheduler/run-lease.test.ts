import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  O_EXLOCK_DARWIN,
  RunLeaseConflictError,
  RunLeaseError,
  acquireRunLease,
  buildLockFlags,
  requestCooperativeStop,
} from "../../src/scheduler/run-lease.js";

describe("run lease", () => {
  const configDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      configDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  it("builds Darwin flags with the raw exclusive-lock bit", () => {
    expect(O_EXLOCK_DARWIN).toBe(0x0020);
    expect(buildLockFlags() & O_EXLOCK_DARWIN).toBe(O_EXLOCK_DARWIN);
  });

  it("rejects platforms other than Darwin before changing runtime state", async () => {
    await expect(
      acquireRunLease({ configDir: "/tmp/scale2sheet-unsupported", platform: "linux" }),
    ).rejects.toThrow(RunLeaseError);
  });

  it("allows one owner, exposes an owner-specific socket, and releases only its own volatile state", async () => {
    const configDir = await temporaryConfigDirectory();
    const holder = await acquireRunLease({ configDir });

    expect(holder.ownerToken).toMatch(/^[a-f0-9]{32,}$/);
    expect(existsSync(holder.socketPath)).toBe(true);
    expect(existsSync(holder.receiptPath)).toBe(true);
    expect(existsSync(holder.lockPath)).toBe(true);

    await expect(acquireRunLease({ configDir })).rejects.toThrow(
      RunLeaseConflictError,
    );

    await holder.release();

    expect(existsSync(holder.socketPath)).toBe(false);
    expect(existsSync(holder.receiptPath)).toBe(false);
    expect(existsSync(holder.lockPath)).toBe(true);
  });

  it("delivers a stop request only to the matching owner", async () => {
    const configDir = await temporaryConfigDirectory();
    const holder = await acquireRunLease({ configDir, stopPollMilliseconds: 5 });
    const stopped = new Promise<void>((resolve) => holder.startStopPolling(resolve));

    await requestCooperativeStop(configDir, holder.ownerToken);
    await expect(stopped).resolves.toBeUndefined();
    await holder.release();
  });

  async function temporaryConfigDirectory(): Promise<string> {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "scale2sheet-run-lease-test-"),
    );
    configDirectories.push(directory);
    return directory;
  }
});
