import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("acceptance: bounded-wait diagnostics (#188)", () => {
  it("allows every living acceptance holder up to the #188 60-second abnormality bound", async () => {
    const script = await readFile(
      new URL("../../scripts/run-pipeline-shadow-acceptance.sh", import.meta.url),
      "utf8",
    );

    expect(script).toContain("holder_startup_attempts=1200");
    expect(script).toContain('for _ in $(seq 1 "$holder_startup_attempts"); do');
    expect(script).toContain("sleep 0.05");

    const runtimeScript = await readFile(
      new URL("../../scripts/run-runtime-safety-acceptance.sh", import.meta.url),
      "utf8",
    );
    expect(runtimeScript).toContain("holder_startup_attempts=1200");
    expect(runtimeScript.match(/seq 1 "\$holder_startup_attempts"/g)).toHaveLength(2);

    const installerScript = await readFile(
      new URL("../../scripts/run-installer-acceptance.sh", import.meta.url),
      "utf8",
    );
    expect(installerScript).toContain("holder_startup_attempts=1200");
    expect(installerScript).toContain('for _ in $(seq 1 "$holder_startup_attempts"); do');
  });

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
