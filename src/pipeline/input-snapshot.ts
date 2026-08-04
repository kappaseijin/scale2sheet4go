import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import type { MeasurementReading } from "../domain/index.js";
import {
  classifyScaleExporterFileNames,
  parseScaleExporterReadingLine,
  type InputAnomalyCandidate,
} from "../sources/scale-exporter/index.js";

export const INPUT_READ_ATTEMPTS = 3;
export const INPUT_STABILITY_INTERVAL_MS = 5_000;

export class InputSnapshotError extends Error {
  constructor(
    readonly outcome: "input-missing" | "input-unstable" | "input-invalid-or-partial",
    readonly diagnostic?: string,
    readonly counts: InputSnapshotCounts = {},
    readonly inputAnomalyCandidates: readonly InputAnomalyCandidate[] = [],
  ) {
    super(diagnostic ? `pipeline input ${outcome}: ${diagnostic}` : `pipeline input ${outcome}`);
    this.name = "InputSnapshotError";
  }
}

export interface InputSnapshotCounts {
  readonly matchedFileCount?: number;
  readonly readLineCount?: number;
}

export interface ReadStableInputSnapshotOptions {
  readonly outputDir: string;
  readonly targetDate: string;
  readonly delay: (milliseconds: number) => Promise<void>;
}

export interface StableInputSnapshot {
  readonly matchedFileCount: number;
  readonly readLineCount: number;
  readonly readings: readonly MeasurementReading[];
  readonly inputAnomalyCandidates?: readonly InputAnomalyCandidate[];
}

interface SnapshotFile {
  readonly name: string;
  readonly path: string;
  readonly device: number;
  readonly inode: number;
  readonly size: number;
  readonly mtimeMs: number;
}

interface InputSnapshotFiles {
  readonly files: readonly SnapshotFile[];
  readonly inputAnomalyCandidates: readonly InputAnomalyCandidate[];
}

class SnapshotParseError extends Error {
  constructor(readonly readLineCount: number, message: string, options: ErrorOptions) {
    super(message, options);
  }
}

export async function readStableInputSnapshot(
  options: ReadStableInputSnapshotOptions,
): Promise<StableInputSnapshot> {
  let lastOutcome: InputSnapshotError["outcome"] = "input-missing";
  let lastDiagnostic: string | undefined;
  let lastCounts: InputSnapshotCounts = {};
  let lastInputAnomalyCandidates: readonly InputAnomalyCandidate[] = [];
  for (let attempt = 1; attempt <= INPUT_READ_ATTEMPTS; attempt += 1) {
    const before = await snapshotTargetFiles(options.outputDir, options.targetDate);
    lastCounts = { matchedFileCount: before.files.length };
    lastInputAnomalyCandidates = before.inputAnomalyCandidates;
    if (before.files.length === 0) {
      lastOutcome = "input-missing";
      lastDiagnostic = `no target-date files found for ${options.targetDate}`;
    } else {
      await options.delay(INPUT_STABILITY_INTERVAL_MS);
      const afterDelay = await snapshotTargetFiles(options.outputDir, options.targetDate);
      lastCounts = { matchedFileCount: afterDelay.files.length };
      lastInputAnomalyCandidates = afterDelay.inputAnomalyCandidates;
      if (!sameSnapshot(before.files, afterDelay.files)) {
        lastOutcome = "input-unstable";
        lastDiagnostic = "input file metadata changed during stability window";
      } else {
        try {
          const parsed = await readSnapshot(afterDelay.files);
          const afterRead = await snapshotTargetFiles(options.outputDir, options.targetDate);
          lastCounts = { matchedFileCount: afterRead.files.length };
          lastInputAnomalyCandidates = afterRead.inputAnomalyCandidates;
          if (sameSnapshot(afterDelay.files, afterRead.files)) {
            return {
              matchedFileCount: afterRead.files.length,
              readLineCount: parsed.readLineCount,
              readings: parsed.readings,
              ...(afterRead.inputAnomalyCandidates.length > 0
                ? { inputAnomalyCandidates: afterRead.inputAnomalyCandidates }
                : {}),
            };
          }
          lastOutcome = "input-unstable";
        } catch (error) {
          lastOutcome = "input-invalid-or-partial";
          lastDiagnostic = error instanceof Error ? error.message : String(error);
          lastCounts = {
            matchedFileCount: afterDelay.files.length,
            ...(error instanceof SnapshotParseError
              ? { readLineCount: error.readLineCount }
              : {}),
          };
        }
      }
    }
    if (attempt < INPUT_READ_ATTEMPTS) {
      await options.delay(INPUT_STABILITY_INTERVAL_MS);
    }
  }
  throw new InputSnapshotError(
    lastOutcome,
    lastDiagnostic,
    lastCounts,
    lastInputAnomalyCandidates,
  );
}

async function snapshotTargetFiles(
  outputDir: string,
  targetDate: string,
): Promise<InputSnapshotFiles> {
  try {
    const classification = classifyScaleExporterFileNames(
      await readdir(outputDir),
      targetDate,
    );
    const files = await Promise.all(
      classification.targetFileNames.map(async (name) => {
        const filePath = path.join(outputDir, name);
        const fileStat = await stat(filePath);
        return {
          name,
          path: filePath,
          device: fileStat.dev,
          inode: fileStat.ino,
          size: fileStat.size,
          mtimeMs: fileStat.mtimeMs,
        };
      }),
    );
    return {
      files,
      inputAnomalyCandidates: classification.inputAnomalyCandidates,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { files: [], inputAnomalyCandidates: [] };
    }
    throw error;
  }
}

function sameSnapshot(left: readonly SnapshotFile[], right: readonly SnapshotFile[]): boolean {
  return (
    left.length === right.length &&
    left.every((file, index) => {
      const candidate = right[index];
      return (
        candidate !== undefined &&
        file.name === candidate.name &&
        file.device === candidate.device &&
        file.inode === candidate.inode &&
        file.size === candidate.size &&
        file.mtimeMs === candidate.mtimeMs
      );
    })
  );
}

async function readSnapshot(files: readonly SnapshotFile[]): Promise<{
  readonly readings: MeasurementReading[];
  readonly readLineCount: number;
}> {
  const readings: MeasurementReading[] = [];
  let readLineCount = 0;
  for (const file of files) {
    const lines = (await readFile(file.path, "utf8")).split("\n");
    for (const [index, line] of lines.entries()) {
      if (line.trim().length === 0) {
        continue;
      }
      readLineCount += 1;
      try {
        readings.push(parseScaleExporterReadingLine(line, file.name, index + 1));
      } catch (error) {
        throw new SnapshotParseError(readLineCount, error instanceof Error ? error.message : String(error), {
          cause: error,
        });
      }
    }
  }
  return { readings, readLineCount };
}
