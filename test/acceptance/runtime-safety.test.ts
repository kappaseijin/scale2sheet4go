import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

/**
 * #168: this acceptance check was previously reachable only through the
 * manual `npm run acceptance:runtime-safety` command -- nothing invoked it
 * automatically. #148's startup Sheets/source-config validation silently
 * broke it for hours before reviewer caught it while judging an unrelated
 * PR. Running it here connects it to `npm test`, following the same
 * pattern #128 established for acceptance:binary-drift.
 *
 * This compiles a real binary with `bun build --compile` and drives two
 * processes through the Darwin O_EXLOCK lease contract, so it is slower
 * than the rest of the suite (~3-4s) and requires bun on PATH. If bun is
 * missing, the script itself fails with install guidance rather than this
 * test skipping -- a skip would mean "no lease contract was checked," not
 * "the contract held" (Issue #126).
 */
describe("acceptance: runtime safety / run lease (#168)", () => {
  it(
    "enforces the compiled Bun two-process EAGAIN/EWOULDBLOCK conflict and SIGKILL release",
    () => {
      const result = spawnSync("bash", ["scripts/run-runtime-safety-acceptance.sh"], {
        cwd: new URL("../..", import.meta.url).pathname,
        encoding: "utf8",
      });

      if (result.status !== 0) {
        throw new Error(
          `acceptance:runtime-safety failed (exit ${String(result.status)}):\n` +
            `${result.stdout}\n${result.stderr}`,
        );
      }

      expect(result.status).toBe(0);
    },
    30_000,
  );
});
