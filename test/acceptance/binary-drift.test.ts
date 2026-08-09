import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

/**
 * #128: this acceptance check was previously reachable only through the
 * manual `npm run acceptance:binary-drift` command -- nothing invoked it
 * automatically, so a regression (e.g. the git-outside/dirty handling
 * silently reverting to a crash) would go undetected indefinitely. Running
 * it here connects it to `npm test`, the one command every contributor and
 * agent in this session already runs before every push.
 *
 * This compiles a real binary with `bun build --compile`, so it is slower
 * than the rest of the suite (~5-6s) and requires bun on PATH. If bun is
 * missing, the script itself fails with install guidance rather than this
 * test skipping -- a skip would mean "no binary was checked," not "the
 * binary matched the source" (Issue #126).
 */
describe("acceptance: binary/source command-set drift (#128)", () => {
  it(
    "passes the fresh/stale, git-outside, and dirty source_head scenarios",
    () => {
      const result = spawnSync("bash", ["scripts/run-binary-source-drift-acceptance.sh"], {
        cwd: new URL("../..", import.meta.url).pathname,
        encoding: "utf8",
      });

      if (result.status !== 0) {
        throw new Error(
          `acceptance:binary-drift failed (exit ${String(result.status)}):\n` +
            `${result.stdout}\n${result.stderr}`,
        );
      }

      expect(result.status).toBe(0);
    },
    90_000,
  );
});
