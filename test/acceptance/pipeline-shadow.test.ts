import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

/**
 * #168: this acceptance check was previously reachable only through the
 * manual `npm run acceptance:pipeline-shadow` command -- nothing invoked it
 * automatically. #148's startup Sheets-config validation silently broke it
 * for hours before reviewer caught it while judging an unrelated PR.
 * Running it here connects it to `npm test`, following the same pattern
 * #128 established for acceptance:binary-drift.
 *
 * This compiles a real binary with `bun build --compile`, so it is
 * noticeably slower than the rest of the suite (~19s) and requires bun on
 * PATH. If bun is missing, the script itself fails with install guidance
 * rather than this test skipping -- a skip would mean "no binary was
 * checked," not "the binary matched the source" (Issue #126).
 */
describe("acceptance: pipeline shadow path (#168)", () => {
  it(
    "rejects producer invocation, recovers a SIGKILL lease, and records statuses",
    () => {
      const result = spawnSync("bash", ["scripts/run-pipeline-shadow-acceptance.sh"], {
        cwd: new URL("../..", import.meta.url).pathname,
        encoding: "utf8",
      });

      if (result.status !== 0) {
        throw new Error(
          `acceptance:pipeline-shadow failed (exit ${String(result.status)}):\n` +
            `${result.stdout}\n${result.stderr}`,
        );
      }

      expect(result.status).toBe(0);
    },
    90_000,
  );
});
