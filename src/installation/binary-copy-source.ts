import path from "node:path";

/** design plan Task 5: no CLI option, env var, or config file may override the copy source. */
export interface BinaryCopySource {
  resolve(): Promise<string>;
}

export class NotACompiledBinaryError extends Error {
  constructor(public readonly execPath: string) {
    super(`refusing to install a non-compiled-binary process: ${execPath}`);
    this.name = "NotACompiledBinaryError";
  }
}

export interface ProcessInfo {
  readonly bunVersion: string | undefined;
  readonly execPath: string;
}

/**
 * Bun does not publish a documented flag for "this is a `bun build --compile`
 * standalone executable" as opposed to `bun run script.ts`. The heuristic
 * used here: running under Bun (`process.versions.bun` set) and `execPath`
 * is not the bare `bun` CLI itself. `bun run` always reports `execPath` as
 * the `bun` binary; a compiled standalone executable reports itself.
 */
export class ProcessExecutableBinaryCopySource implements BinaryCopySource {
  constructor(
    private readonly processInfo: ProcessInfo = { bunVersion: process.versions.bun, execPath: process.execPath },
  ) {}

  async resolve(): Promise<string> {
    if (this.processInfo.bunVersion === undefined || path.basename(this.processInfo.execPath) === "bun") {
      throw new NotACompiledBinaryError(this.processInfo.execPath);
    }
    return this.processInfo.execPath;
  }
}

/** Test-only: returns a fixture's absolute path without inspecting the running process. */
export class FixedPathBinaryCopySource implements BinaryCopySource {
  constructor(private readonly absolutePath: string) {}

  async resolve(): Promise<string> {
    return this.absolutePath;
  }
}
