import { spawn } from "node:child_process";

export type PipelineFailureStage = "input" | "transfer";

export interface Notifier {
  notify(stage: PipelineFailureStage, period: "morning" | "evening"): Promise<void>;
}

export class MacOsNotifier implements Notifier {
  constructor(private readonly executablePath = "/usr/bin/osascript") {}

  async notify(stage: PipelineFailureStage, period: "morning" | "evening"): Promise<void> {
    const message = `${stage === "input" ? "入力" : "転記"}に失敗しました（period=${period}）`;
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
