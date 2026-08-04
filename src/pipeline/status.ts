import { chmod, rename, writeFile } from "node:fs/promises";

export interface PipelineCounts {
  readonly matchedFileCount?: number;
  readonly readLineCount?: number;
  readonly windowedReadingCount?: number;
}

export interface PipelineStatus {
  readonly period: "morning" | "evening";
  readonly outcome: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly targetDate?: string;
  readonly counts: PipelineCounts;
}

export interface PipelineStatusWriter {
  write(status: PipelineStatus): Promise<void>;
}

export class AtomicPipelineStatusWriter implements PipelineStatusWriter {
  constructor(private readonly statusPath: string) {}

  async write(status: PipelineStatus): Promise<void> {
    const temporaryPath = `${this.statusPath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(status, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, this.statusPath);
  }
}
