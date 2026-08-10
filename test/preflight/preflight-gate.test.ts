import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const root = new URL("../..", import.meta.url).pathname;
function runPreflight() {
  return spawnSync("npm", ["run", "preflight:ac-ledger"], {
    cwd: root,
    encoding: "utf8",
  });
}

describe("preflight gate (#238)", () => {
  it("runs the AC ledger and document reference checks", () => {
    const baseline = runPreflight();
    expect(baseline.status, `${baseline.stdout}\n${baseline.stderr}`).toBe(0);
  }, 60_000);
});
