import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

/**
 * #140 follow-up: scripts/verify-readme-config-keys.mjs was a classifier a
 * human read, not a regression detector -- it was never invoked from
 * npm test/preflight/acceptance, AND it unconditionally exited 0 regardless
 * of what it found (fixed alongside this test; see the script's own
 * comment). Connecting it here alone would not have been enough while that
 * second problem stood -- #128 taught that "wired to a gate" and "the gate
 * actually goes red" are different claims.
 *
 * Expected counts are pinned to the current, verified-correct baseline
 * (A=0, B=0, C=0), not copied from the script's own prior report: the
 * original PR's C=3 (GOOGLE_FIT_CLIENT_ID/SECRET/REDIRECT_URI unmapped)
 * was a real gap on the base it was written against, already closed by
 * #146's settings.json mapping addition -- confirmed by checking out that
 * commit directly and re-running the script there. Fixing all three
 * categories to 0 here, instead of freezing whatever the script currently
 * reports, is deliberate: this Issue exists because "the current value" was
 * once treated as correct without checking it.
 */
describe("config: README config-key classification (#110 AC-5, #140)", () => {
  it("reports zero deficiencies across all three categories (A/B/C)", () => {
    const result = spawnSync("node", ["scripts/verify-readme-config-keys.mjs"], {
      cwd: new URL("../..", import.meta.url).pathname,
      encoding: "utf8",
    });

    const total = result.stdout.match(/\*\*合計\*\*: A=(\d+) \+ B=(\d+) \+ C=(\d+)/);
    if (!total) {
      throw new Error(
        `verify-readme-config-keys.mjs did not print the expected summary line:\n${result.stdout}\n${result.stderr}`,
      );
    }
    const [, a, b, c] = total;

    if (result.status !== 0) {
      throw new Error(
        `verify-readme-config-keys.mjs failed (exit ${String(result.status)}, A=${a} B=${b} C=${c}):\n` +
          `${result.stdout}\n${result.stderr}`,
      );
    }

    expect({ A: Number(a), B: Number(b), C: Number(c) }).toEqual({ A: 0, B: 0, C: 0 });
    expect(result.status).toBe(0);
  });
});
