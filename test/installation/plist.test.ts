import { describe, expect, it } from "vitest";

import { buildPipelinePlist } from "../../src/installation/plist.js";

describe("buildPipelinePlist", () => {
  it("generates direct pipeline arguments and log paths without side effects", () => {
    const plist = buildPipelinePlist({
      label: "jp.seijin.kappa.scale-pipeline.morning",
      binaryPath: "/Applications/scale2sheet",
      period: "morning",
      stdoutPath: "/tmp/morning.log",
      stderrPath: "/tmp/morning.err.log",
      hour: 7,
      minute: 0,
    });

    expect(plist).toContain("<key>ProgramArguments</key>");
    expect(plist).toContain("<string>pipeline</string>");
    expect(plist).toContain("<key>StandardOutPath</key>");
    expect(plist).toContain("<key>StandardErrorPath</key>");
    expect(plist).toContain("<string>/tmp/morning.err.log</string>");
    expect(plist).not.toContain("scripts/run-pipeline.sh");
  });

  it("escapes XML values", () => {
    expect(buildPipelinePlist({
      label: "a&b",
      binaryPath: "/tmp/<scale>",
      period: "evening",
      stdoutPath: "/tmp/out",
      stderrPath: "/tmp/err",
      hour: 21,
      minute: 0,
    })).toContain("a&amp;b");

    expect(buildPipelinePlist({
      label: "jp.seijin.kappa.scale-pipeline.evening",
      binaryPath: "/Applications/scale2sheet",
      period: "evening",
      stdoutPath: "/tmp/evening.log",
      stderrPath: "/tmp/evening.err.log",
      hour: 21,
      minute: 0,
    })).toContain("<string>/tmp/evening.err.log</string>");
  });
});
