import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("acceptance: bounded-wait diagnostics (#188)", () => {
  it("retains holder logs and absent receipt/status paths when a wait expires", async () => {
    const script = await readFile(
      new URL("../../scripts/run-pipeline-shadow-acceptance.sh", import.meta.url),
      "utf8",
    );

    expect(script).toContain('dump_diagnostic_file "active-run receipt" "$receipt"');
    expect(script).toContain('dump_diagnostic_file "pipeline holder log" "$root/holder.log"');
    expect(script).toContain('dump_diagnostic_file "pipeline status" "$status"');
    expect(script).toContain('echo "(absent: ${file_path})" >&2');
  });
});
