import { spawn } from "node:child_process";

import type { HealthState } from "./status.js";

export interface HealthStateTransition {
  readonly fromState: HealthState;
  readonly toState: HealthState;
}

/** AC-112: called once per state transition, never once per failed run. */
export interface Notifier {
  notify(period: "morning" | "evening", transition: HealthStateTransition): Promise<void>;
}

export class MacOsNotifier implements Notifier {
  constructor(private readonly executablePath = "/usr/bin/osascript") {}

  async notify(period: "morning" | "evening", transition: HealthStateTransition): Promise<void> {
    const message = transition.toState === "alert"
      ? `異常を検知しました（period=${period}）`
      : `復旧しました（period=${period}）`;
    await new Promise<void>((resolve) => {
      const child = spawn(this.executablePath, [
        "-e",
        `display notification ${JSON.stringify(message)} with title "scale-pipeline" sound name "Basso"`,
      ], { stdio: "ignore" });
      child.once("error", () => resolve());
      child.once("exit", () => resolve());
    });
  }
}
