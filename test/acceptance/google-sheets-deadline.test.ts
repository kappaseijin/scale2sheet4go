import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("acceptance: Google Sheets operation deadline (#280)", () => {
  it(
    "aborts a blackhole-backed pipeline transfer and releases its lease for the next run",
    () => {
      const result = spawnSync("bash", ["scripts/run-google-sheets-deadline-acceptance.sh"], {
        cwd: new URL("../..", import.meta.url).pathname,
        encoding: "utf8",
      });

      if (result.status !== 0) {
        throw new Error(
          `acceptance:google-sheets-deadline failed (exit ${String(result.status)}):\n` +
            `${result.stdout}\n${result.stderr}`,
        );
      }

      expect(result.status).toBe(0);
      for (const phase of [
        "child_lstart=",
        "receipt_started_at=",
        "pipeline_started_at=",
        "blackhole_accept_monotonic=",
        "terminal_completed_at=",
        "lease_reacquire_monotonic=",
      ]) {
        expect(result.stdout).toContain(phase);
      }
    },
    180_000,
  );

  it("bounds post-reacquire separately from the product deadline", () => {
    const script = readFileSync(
      new URL("../../scripts/run-google-sheets-deadline-acceptance.sh", import.meta.url),
      "utf8",
    );

    expect(script).toContain("post_timeout_seconds=30");
    expect(script).toContain("post-reacquire-timeout");
  });
});
