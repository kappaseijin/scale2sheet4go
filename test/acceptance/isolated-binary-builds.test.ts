import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const acceptanceScripts = [
  "scripts/run-pipeline-shadow-acceptance.sh",
  "scripts/run-installer-acceptance.sh",
  "scripts/run-runtime-safety-acceptance.sh",
  "scripts/run-bun-binary-smoke.sh",
] as const;

describe("acceptance: isolated compiled binaries (#190)", () => {
  it("builds each acceptance binary below its own temporary directory, not checkout dist", async () => {
    for (const scriptPath of acceptanceScripts) {
      const script = await readFile(new URL(`../../${scriptPath}`, import.meta.url), "utf8");

      expect(script).toContain('bun build ./src/index.ts --compile --outfile "$binary"');
      expect(script).not.toContain("npm run build:bun");
      expect(script).not.toMatch(/binary="[^"\n]*dist\/scale2sheet"/);
    }
  });
});
