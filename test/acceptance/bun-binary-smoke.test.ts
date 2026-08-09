import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

/**
 * #168: this smoke check was not even registered in package.json before
 * this Issue, let alone reachable through `npm test` -- there was no
 * discoverable way to know it existed or ran regularly. #148's startup
 * Sheets/source-config validation had silently broken 3 of its 6 cases.
 * Running it here connects it to `npm test`, following the same pattern
 * #128 established for acceptance:binary-drift.
 *
 * This compiles a real binary with `bun build --compile` and runs six
 * isolated CLI invocations against it, so it is slower than the rest of
 * the suite (~4s) and requires bun on PATH. If bun is missing, the script
 * itself fails with install guidance rather than this test skipping -- a
 * skip would mean "the binary was not smoke-tested," not "the binary
 * behaved correctly" (Issue #126).
 */
describe("acceptance: Bun binary smoke (#168)", () => {
  it(
    "passes all six isolated CLI smoke cases",
    () => {
      const result = spawnSync("bash", ["scripts/run-bun-binary-smoke.sh"], {
        cwd: new URL("../..", import.meta.url).pathname,
        encoding: "utf8",
      });

      if (result.status !== 0) {
        throw new Error(
          `acceptance:bun-binary-smoke failed (exit ${String(result.status)}):\n` +
            `${result.stdout}\n${result.stderr}`,
        );
      }

      expect(result.status).toBe(0);
    },
    90_000,
  );
});
