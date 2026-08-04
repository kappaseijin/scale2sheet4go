import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  InputSnapshotError,
  readStableInputSnapshot,
} from "../../src/pipeline/input-snapshot.js";

describe("readStableInputSnapshot", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });

  it("classifies a target date with no published JSONL as missing", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-pipeline-input-"));
    directories.push(outputDir);

    await expect(
      readStableInputSnapshot({
        outputDir,
        targetDate: "2026-08-03",
        delay: async () => {},
      }),
    ).rejects.toMatchObject<InputSnapshotError>({ outcome: "input-missing" });
  });

  it("reads a stable target-date JSONL and records its input counts", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-pipeline-input-"));
    directories.push(outputDir);
    await writeFile(
      path.join(outputDir, "scale_exporter_2026-08-03_google-fit_001.jsonl"),
      '{"measuredAt":"2026-08-03T06:30:00+09:00","kind":"weight","value":68.4,"unit":"kg","source":"google_fit"}\n',
    );

    await expect(
      readStableInputSnapshot({
        outputDir,
        targetDate: "2026-08-03",
        delay: async () => {},
      }),
    ).resolves.toMatchObject({
      matchedFileCount: 1,
      readLineCount: 1,
      readings: [{ kind: "weight", value: 68.4, source: "google_fit" }],
    });
  });

  it("rejects files that change during all three stability attempts", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-pipeline-input-"));
    directories.push(outputDir);
    const filePath = path.join(outputDir, "scale_exporter_2026-08-03_google-fit_001.jsonl");
    await writeFile(filePath, validReading());
    let delayCall = 0;

    await expect(
      readStableInputSnapshot({
        outputDir,
        targetDate: "2026-08-03",
        delay: async () => {
          delayCall += 1;
          if (delayCall % 2 === 1) {
            await writeFile(filePath, validReading() + " ".repeat(delayCall));
          }
        },
      }),
    ).rejects.toMatchObject<InputSnapshotError>({ outcome: "input-unstable" });
    expect(delayCall).toBe(5);
  });

  it("rejects all input when one stable JSONL line is invalid", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-pipeline-input-"));
    directories.push(outputDir);
    await writeFile(
      path.join(outputDir, "scale_exporter_2026-08-03_google-fit_001.jsonl"),
      validReading() + "\nnot-json\n",
    );

    await expect(
      readStableInputSnapshot({
        outputDir,
        targetDate: "2026-08-03",
        delay: async () => {},
      }),
    ).rejects.toMatchObject<InputSnapshotError>({
      outcome: "input-invalid-or-partial",
    });
  });
});

function validReading(): string {
  return '{"measuredAt":"2026-08-03T06:30:00+09:00","kind":"weight","value":68.4,"unit":"kg","source":"google_fit"}';
}
