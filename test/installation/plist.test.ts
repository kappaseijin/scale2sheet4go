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
      times: [{ hour: 7, minute: 0 }, { hour: 11, minute: 30 }],
      home: "/Users/kappa",
      binDir: "/Users/kappa/.local/bin",
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
      times: [{ hour: 21, minute: 0 }, { hour: 23, minute: 30 }],
      home: "/Users/kappa",
      binDir: "/Users/kappa/.local/bin",
    })).toContain("a&amp;b");

    expect(buildPipelinePlist({
      label: "jp.seijin.kappa.scale-pipeline.evening",
      binaryPath: "/Applications/scale2sheet",
      period: "evening",
      stdoutPath: "/tmp/evening.log",
      stderrPath: "/tmp/evening.err.log",
      times: [{ hour: 21, minute: 0 }, { hour: 23, minute: 30 }],
      home: "/Users/kappa",
      binDir: "/Users/kappa/.local/bin",
    })).toContain("<string>/tmp/evening.err.log</string>");
  });

  it("emits two StartCalendarInterval entries per period (design §実行時刻)", () => {
    const morning = buildPipelinePlist({
      label: "jp.seijin.kappa.scale-pipeline.morning",
      binaryPath: "/Users/kappa/.local/bin/scale2sheet",
      period: "morning",
      stdoutPath: "/tmp/morning.log",
      stderrPath: "/tmp/morning.err.log",
      times: [{ hour: 7, minute: 0 }, { hour: 11, minute: 30 }],
      home: "/Users/kappa",
      binDir: "/Users/kappa/.local/bin",
    });

    // StartCalendarInterval must be an array of two dicts, not a single dict,
    // so launchd fires both 07:00 and 11:30 for the morning period.
    expect(morning).toMatch(/<key>StartCalendarInterval<\/key>\s*<array>/);
    const dictMatches = morning.match(/<dict><key>Hour<\/key>/g) ?? [];
    expect(dictMatches).toHaveLength(2);
    expect(morning).toContain("<key>Hour</key><integer>7</integer><key>Minute</key><integer>0</integer>");
    expect(morning).toContain("<key>Hour</key><integer>11</integer><key>Minute</key><integer>30</integer>");

    const evening = buildPipelinePlist({
      label: "jp.seijin.kappa.scale-pipeline.evening",
      binaryPath: "/Users/kappa/.local/bin/scale2sheet",
      period: "evening",
      stdoutPath: "/tmp/evening.log",
      stderrPath: "/tmp/evening.err.log",
      times: [{ hour: 21, minute: 0 }, { hour: 23, minute: 30 }],
      home: "/Users/kappa",
      binDir: "/Users/kappa/.local/bin",
    });
    expect(evening).toContain("<key>Hour</key><integer>21</integer><key>Minute</key><integer>0</integer>");
    expect(evening).toContain("<key>Hour</key><integer>23</integer><key>Minute</key><integer>30</integer>");
  });

  it("emits EnvironmentVariables with HOME, PATH, and the plist's own fixed label (design §EnvironmentVariables)", () => {
    const plist = buildPipelinePlist({
      label: "jp.seijin.kappa.scale-pipeline.morning",
      binaryPath: "/Users/kappa/.local/bin/scale2sheet",
      period: "morning",
      stdoutPath: "/tmp/morning.log",
      stderrPath: "/tmp/morning.err.log",
      times: [{ hour: 7, minute: 0 }, { hour: 11, minute: 30 }],
      home: "/Users/kappa",
      binDir: "/Users/kappa/.local/bin",
    });

    expect(plist).toContain("<key>EnvironmentVariables</key>");
    expect(plist).toContain("<key>HOME</key><string>/Users/kappa</string>");
    expect(plist).toContain(
      "<key>PATH</key><string>/Users/kappa/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>",
    );
    expect(plist).toContain("<key>SCALE2SHEET_LAUNCHD_LABEL</key><string>jp.seijin.kappa.scale-pipeline.morning</string>");
  });

  it("dedupes PATH entries when binDir collides with one of the fixed system paths", () => {
    // If a caller ever resolves binDir to a path that's already in the fixed
    // list (e.g. an unusual --prefix), PATH must not repeat it (design
    // §EnvironmentVariables: "重複除去して連結する").
    const plist = buildPipelinePlist({
      label: "jp.seijin.kappa.scale-pipeline.morning",
      binaryPath: "/usr/bin/scale2sheet",
      period: "morning",
      stdoutPath: "/tmp/morning.log",
      stderrPath: "/tmp/morning.err.log",
      times: [{ hour: 7, minute: 0 }, { hour: 11, minute: 30 }],
      home: "/Users/kappa",
      binDir: "/usr/bin",
    });

    expect(plist).toContain(
      "<key>PATH</key><string>/usr/bin:/opt/homebrew/bin:/usr/local/bin:/bin:/usr/sbin:/sbin</string>",
    );
  });
});
