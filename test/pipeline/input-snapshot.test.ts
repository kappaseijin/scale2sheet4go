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
    ).rejects.toMatchObject<InputSnapshotError>({
      outcome: "input-missing",
      counts: { matchedFileCount: 0 },
    });
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

  it("keeps valid input while reporting only a near-miss filename", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-pipeline-input-"));
    directories.push(outputDir);
    await writeFile(
      path.join(outputDir, "scale_exporter_2026-08-03_google-fit_001.jsonl"),
      validReading(),
    );
    await writeFile(
      path.join(outputDir, "scale_exporter_2026-08-03_apple-health-file_001.jsonl"),
      validReading(),
    );
    await writeFile(
      path.join(
        outputDir,
        "scale_exporter_2026-08-03_google-fit_001.jsonlのコピー".normalize("NFD"),
      ),
      validReading(),
    );
    await writeFile(
      path.join(
        outputDir,
        "scale_exporter_2026-08-03_google-fit_001.jsonlのコピー2".normalize("NFD"),
      ),
      validReading(),
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
      inputAnomalyCandidates: [
        {
          name: "scale_exporter_2026-08-03_apple-health-file_001.jsonl",
          reason: "file-name-pattern-mismatch",
        },
      ],
    });
  });

  it("keeps near-miss candidates when no valid target file exists", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-pipeline-input-"));
    directories.push(outputDir);
    await writeFile(
      path.join(outputDir, "scale_exporter_2026-08-03_apple-health-file_001.jsonl"),
      validReading(),
    );

    await expect(
      readStableInputSnapshot({
        outputDir,
        targetDate: "2026-08-03",
        delay: async () => {},
      }),
    ).rejects.toMatchObject<InputSnapshotError>({
      outcome: "input-missing",
      counts: { matchedFileCount: 0 },
      inputAnomalyCandidates: [
        {
          name: "scale_exporter_2026-08-03_apple-health-file_001.jsonl",
          reason: "file-name-pattern-mismatch",
        },
      ],
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
    ).rejects.toMatchObject<InputSnapshotError>({
      outcome: "input-unstable",
      counts: { matchedFileCount: 1 },
    });
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
      counts: { matchedFileCount: 1, readLineCount: 2 },
    });
  });

  it("keeps an invalid-reading observation after the target file disappears", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-pipeline-input-"));
    directories.push(outputDir);
    const fileName = "scale_exporter_2026-08-03_google-fit_001.jsonl";
    const filePath = path.join(outputDir, fileName);
    await writeFile(filePath, "not-json\n");
    let delayCalls = 0;

    await expect(
      readStableInputSnapshot({
        outputDir,
        targetDate: "2026-08-03",
        delay: async () => {
          delayCalls += 1;
          if (delayCalls === 2) {
            await rm(filePath);
          }
        },
      }),
    ).rejects.toMatchObject<InputSnapshotError>({
      outcome: "input-invalid-or-partial",
      diagnostic: `invalid JSON in ${fileName}:1`,
      counts: { matchedFileCount: 1, readLineCount: 1 },
    });
  });

  it("keeps an invalid-reading observation after a later post-read instability", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-pipeline-input-"));
    directories.push(outputDir);
    const fileName = "scale_exporter_2026-08-03_google-fit_001.jsonl";
    const filePath = path.join(outputDir, fileName);
    await writeFile(filePath, "not-json\n");
    let delayCalls = 0;
    let afterReadCalls = 0;
    const options: Parameters<typeof readStableInputSnapshot>[0] & {
      readonly afterReadSnapshot: () => Promise<void>;
    } = {
      outputDir,
      targetDate: "2026-08-03",
      delay: async () => {
        delayCalls += 1;
        if (delayCalls === 2) {
          await writeFile(filePath, validReading());
        }
        if (delayCalls === 4) {
          await rm(filePath);
        }
      },
      afterReadSnapshot: async () => {
        afterReadCalls += 1;
        await writeFile(filePath, validReading() + "\n");
      },
    };

    await expect(readStableInputSnapshot(options)).rejects.toMatchObject<InputSnapshotError>({
      outcome: "input-invalid-or-partial",
      diagnostic: `invalid JSON in ${fileName}:1`,
      counts: { matchedFileCount: 1, readLineCount: 1 },
    });
    expect(afterReadCalls).toBe(1);
  });

  it("uses the later invalid observation when failures have the same strength", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-pipeline-input-"));
    directories.push(outputDir);
    const fileName = "scale_exporter_2026-08-03_google-fit_001.jsonl";
    const filePath = path.join(outputDir, fileName);
    await writeFile(filePath, `${validReading()}\nnot-json\n`);
    let delayCalls = 0;

    await expect(
      readStableInputSnapshot({
        outputDir,
        targetDate: "2026-08-03",
        delay: async () => {
          delayCalls += 1;
          if (delayCalls === 2) {
            await writeFile(filePath, "not-json\n");
          }
          if (delayCalls === 4) {
            await rm(filePath);
          }
        },
      }),
    ).rejects.toMatchObject<InputSnapshotError>({
      outcome: "input-invalid-or-partial",
      diagnostic: `invalid JSON in ${fileName}:1`,
      counts: { matchedFileCount: 1, readLineCount: 1 },
    });
  });

  it("keeps an unstable observation and its matching diagnostic over later missing input", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-pipeline-input-"));
    directories.push(outputDir);
    const filePath = path.join(outputDir, "scale_exporter_2026-08-03_google-fit_001.jsonl");
    let delayCalls = 0;

    await expect(
      readStableInputSnapshot({
        outputDir,
        targetDate: "2026-08-03",
        delay: async () => {
          delayCalls += 1;
          if (delayCalls === 1) {
            await writeFile(filePath, validReading());
          }
          if (delayCalls === 2) {
            await writeFile(filePath, validReading() + "\n");
          }
          if (delayCalls === 3) {
            await rm(filePath);
          }
        },
      }),
    ).rejects.toMatchObject<InputSnapshotError>({
      outcome: "input-unstable",
      diagnostic: "input file metadata changed during stability window",
      counts: { matchedFileCount: 1 },
    });
  });

  it("returns a later stable snapshot after an earlier missing observation", async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "scale2sheet-pipeline-input-"));
    directories.push(outputDir);
    const filePath = path.join(outputDir, "scale_exporter_2026-08-03_google-fit_001.jsonl");
    let delayCalls = 0;

    await expect(
      readStableInputSnapshot({
        outputDir,
        targetDate: "2026-08-03",
        delay: async () => {
          delayCalls += 1;
          if (delayCalls === 1) {
            await writeFile(filePath, validReading());
          }
        },
      }),
    ).resolves.toMatchObject({
      matchedFileCount: 1,
      readLineCount: 1,
      readings: [{ kind: "weight", value: 68.4 }],
    });
  });
});

function validReading(): string {
  return '{"measuredAt":"2026-08-03T06:30:00+09:00","kind":"weight","value":68.4,"unit":"kg","source":"google_fit"}';
}
