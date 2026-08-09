import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

/**
 * #168: this acceptance check was previously reachable only through the
 * manual `npm run acceptance:installer` command -- nothing invoked it
 * automatically. #148's startup Sheets/source-config validation silently
 * broke it for hours before reviewer caught it while judging an unrelated
 * PR. Running it here connects it to `npm test`, following the same
 * pattern #128 established for acceptance:binary-drift.
 *
 * This compiles a real binary with `bun build --compile` and drives
 * install/uninstall through several isolated HOME trees, so it is slower
 * than the rest of the suite (~7-8s) and requires bun on PATH. If bun is
 * missing, the script itself fails with install guidance rather than this
 * test skipping -- a skip would mean "install/uninstall was not checked,"
 * not "install/uninstall behaved correctly" (Issue #126).
 */
describe("acceptance: install / uninstall (#168)", () => {
  it(
    "passes the isolated install/uninstall checks (1,2,4,5,6) plus AC-17/AC-18/AC-19",
    () => {
      const result = spawnSync("bash", ["scripts/run-installer-acceptance.sh"], {
        cwd: new URL("../..", import.meta.url).pathname,
        encoding: "utf8",
      });

      if (result.status !== 0) {
        throw new Error(
          `acceptance:installer failed (exit ${String(result.status)}):\n` +
            `${result.stdout}\n${result.stderr}`,
        );
      }

      expect(result.status).toBe(0);
    },
    90_000,
  );
});
