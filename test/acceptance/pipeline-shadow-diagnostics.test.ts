import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("acceptance: pipeline shadow diagnostics (#188)", () => {
  it("guards the reacquired pipeline command so a non-zero exit reaches its diagnostic", async () => {
    const script = await readFile(
      new URL("../../scripts/run-pipeline-shadow-acceptance.sh", import.meta.url),
      "utf8",
    );

    expect(script).toMatch(/run_pipeline_or_emit_diagnostic\(\) \{[\s\S]*if ! run_pipeline "\$1" "\$2" >"\$3" 2>&1; then/);
  });

  it("passes the fixture target date into every compiled pipeline invocation", async () => {
    const script = await readFile(
      new URL("../../scripts/run-pipeline-shadow-acceptance.sh", import.meta.url),
      "utf8",
    );

    expect(script.match(/\$binary" pipeline --period morning --date "\$target_date"/g)).toHaveLength(2);
  });
});
