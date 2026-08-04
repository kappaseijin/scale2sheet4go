import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import type { MeasurementReading } from "../domain/index.js";
import { parseScaleExporterReadingLine } from "../sources/scale-exporter/index.js";

export const INPUT_READ_ATTEMPTS = 3;
export const INPUT_STABILITY_INTERVAL_MS = 5_000;

export class InputSnapshotError extends Error {
  constructor(
    readonly outcome: "input-missing" | "input-unstable" | "input-invalid-or-partial",
    readonly diagnostic?: string,
  ) {
    super(diagnostic ? `pipeline input ${outcome}: ${diagnostic}` : `pipeline input ${outcome}`);
    this.name = "InputSnapshotError";
  }
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
}

interface SnapshotFile {
  readonly name: string;
  readonly path: string;
  readonly device: number;
  readonly inode: number;
  readonly size: number;
  readonly mtimeMs: number;
}

export async function readStableInputSnapshot(
  options: ReadStableInputSnapshotOptions,
): Promise<StableInputSnapshot> {
  let lastOutcome: InputSnapshotError["outcome"] = "input-missing";
  let lastDiagnostic: string | undefined;
  for (let attempt = 1; attempt <= INPUT_READ_ATTEMPTS; attempt += 1) {
    const before = await snapshotTargetFiles(options.outputDir, options.targetDate);
    if (before.length === 0) {
      lastOutcome = "input-missing";
      lastDiagnostic = `no target-date files found for ${options.targetDate}`;
    } else {
      await options.delay(INPUT_STABILITY_INTERVAL_MS);
      const afterDelay = await snapshotTargetFiles(options.outputDir, options.targetDate);
      if (!sameSnapshot(before, afterDelay)) {
        lastOutcome = "input-unstable";
        lastDiagnostic = "input file metadata changed during stability window";
      } else {
        try {
          const parsed = await readSnapshot(afterDelay);
          const afterRead = await snapshotTargetFiles(options.outputDir, options.targetDate);
          if (sameSnapshot(afterDelay, afterRead)) {
            return {
              matchedFileCount: afterRead.length,
              readLineCount: parsed.readLineCount,
              readings: parsed.readings,
            };
          }
          lastOutcome = "input-unstable";
        } catch (error) {
          lastOutcome = "input-invalid-or-partial";
          lastDiagnostic = error instanceof Error ? error.message : String(error);
        }
      }
    }
    if (attempt < INPUT_READ_ATTEMPTS) {
      await options.delay(INPUT_STABILITY_INTERVAL_MS);
    }
  }
  throw new InputSnapshotError(lastOutcome, lastDiagnostic);
}

async function snapshotTargetFiles(
  outputDir: string,
  targetDate: string,
): Promise<SnapshotFile[]> {
  try {
    const names = (await readdir(outputDir))
      .filter((name) => isTargetFile(name, targetDate))
      .sort();
    return Promise.all(
      names.map(async (name) => {
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
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function isTargetFile(name: string, targetDate: string): boolean {
  return new RegExp(
    `^scale_exporter_${targetDate}_(apple-health|google-fit)_\\d{3}\\.jsonl$`,
  ).test(name);
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
      readings.push(parseScaleExporterReadingLine(line, file.name, index + 1));
    }
  }
  return { readings, readLineCount };
}
