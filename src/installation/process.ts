import { execFile } from "node:child_process";

export interface ProcessRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

/** A command runner, injectable so tests never invoke the real `launchctl` binary. */
export type ProcessRunner = (
  command: string,
  args: readonly string[],
) => Promise<ProcessRunResult>;

const DEFAULT_TIMEOUT_MS = 10_000;

export const execFileProcessRunner: ProcessRunner = (command, args) =>
  new Promise((resolve) => {
    execFile(command, args, { timeout: DEFAULT_TIMEOUT_MS }, (error, stdout, stderr) => {
      const timedOut = error !== null && (error as NodeJS.ErrnoException & { killed?: boolean; signal?: string }).signal === "SIGTERM";
      resolve({
        exitCode: error && !timedOut ? (error as { code?: number }).code ?? 1 : timedOut ? 1 : 0,
        stdout,
        stderr,
        timedOut,
      });
    });
  });

export type LaunchctlOutcome = "done" | "skipped" | "failed";

export interface LaunchctlResult {
  readonly outcome: LaunchctlOutcome;
  readonly message: string;
}

/**
 * design INSTALLATION_DESIGN.md §launchdフロー再登録: the registration
 * contract is the exit code of `launchctl print` alone. Output format and
 * `state` are not an API and are never parsed for a pass/fail decision.
 */
export class LaunchctlAdapter {
  constructor(private readonly run: ProcessRunner = execFileProcessRunner) {}

  async isRegistered(domain: string, label: string): Promise<boolean> {
    const result = await this.run("launchctl", ["print", `${domain}/${label}`]);
    return result.exitCode === 0;
  }

  /**
   * design §診断契約: "best-effort の raw 診断出力" for `doctor` to display
   * as-is. Unlike isRegistered, this never turns the output into a
   * pass/fail decision — the exit code and text are shown, not parsed.
   */
  async printRaw(domain: string, label: string): Promise<{ readonly exitCode: number; readonly stdout: string }> {
    const result = await this.run("launchctl", ["print", `${domain}/${label}`]);
    return { exitCode: result.exitCode, stdout: result.stdout };
  }

  async bootout(domain: string, label: string): Promise<LaunchctlResult> {
    if (!(await this.isRegistered(domain, label))) {
      return { outcome: "skipped", message: "not loaded" };
    }
    const result = await this.run("launchctl", ["bootout", `${domain}/${label}`]);
    if (result.timedOut) {
      return { outcome: "failed", message: "timeout" };
    }
    return result.exitCode === 0
      ? { outcome: "done", message: "" }
      : { outcome: "failed", message: result.stderr.trim() };
  }

  async bootstrap(domain: string, plistPath: string): Promise<LaunchctlResult> {
    const result = await this.run("launchctl", ["bootstrap", domain, plistPath]);
    if (result.timedOut) {
      return { outcome: "failed", message: "timeout" };
    }
    return result.exitCode === 0
      ? { outcome: "done", message: "" }
      : { outcome: "failed", message: result.stderr.trim() };
  }
}
