import { chmodSync, existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  O_EXLOCK_DARWIN,
  RunLeaseConflictError,
  RunLeaseError,
  acquireRunLease,
  buildLockFlags,
  readActiveRunReceipt,
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

  it("blocks the other period while a pipeline lease is held", async () => {
    const configDir = await temporaryConfigDirectory();
    const holder = await acquireRunLease({ configDir, kind: "pipeline", period: "morning" });

    await expect(
      acquireRunLease({ configDir, kind: "pipeline", period: "evening" }),
    ).rejects.toThrow(RunLeaseConflictError);

    await holder.release();
  });

  it("delivers a stop request only to the matching owner", async () => {
    const configDir = await temporaryConfigDirectory();
    const holder = await acquireRunLease({ configDir, stopPollMilliseconds: 5 });
    const stopped = new Promise<void>((resolve) => holder.startStopPolling(resolve));

    await requestCooperativeStop(configDir, holder.ownerToken);
    await expect(stopped).resolves.toBeUndefined();
    await holder.release();
  });

  it("rejects a malformed receipt with a concrete recovery path", async () => {
    const configDir = await temporaryConfigDirectory();
    const receiptPath = path.join(configDir, "active-run.json");
    await writeFile(receiptPath, "{ not json");

    await expect(acquireRunLease({ configDir })).rejects.toThrow(receiptPath);
  });

  it("rejects runtime directories and stable locks with unsafe modes", async () => {
    const configDir = await temporaryConfigDirectory();
    const holder = await acquireRunLease({ configDir });
    const runtimeDir = path.dirname(holder.lockPath);
    await holder.release();

    chmodSync(runtimeDir, 0o755);
    await expect(acquireRunLease({ configDir })).rejects.toThrow("runtime directory");
    chmodSync(runtimeDir, 0o700);

    chmodSync(holder.lockPath, 0o644);
    await expect(acquireRunLease({ configDir })).rejects.toThrow("lock file");
    chmodSync(holder.lockPath, 0o600);
  });

  it("readActiveRunReceipt (doctor's read-only path): reports the live receipt without acquiring the lease", async () => {
    const configDir = await temporaryConfigDirectory();
    const holder = await acquireRunLease({ configDir, kind: "serve", origin: "manual" });

    const receipt = readActiveRunReceipt(configDir);

    expect(receipt).toEqual({
      kind: "serve",
      origin: "manual",
      pid: process.pid,
      startedAt: expect.any(String),
    });
    await holder.release();
  });

  it("readActiveRunReceipt returns undefined when no run is active", async () => {
    const configDir = await temporaryConfigDirectory();

    expect(readActiveRunReceipt(configDir)).toBeUndefined();
  });

  it("readActiveRunReceipt returns undefined (not a throw) for a malformed receipt file", async () => {
    const configDir = await temporaryConfigDirectory();
    await writeFile(path.join(configDir, "active-run.json"), "{ not json");

    expect(readActiveRunReceipt(configDir)).toBeUndefined();
  });

  async function temporaryConfigDirectory(): Promise<string> {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "scale2sheet-run-lease-test-"),
    );
    configDirectories.push(directory);
    return directory;
  }
});
