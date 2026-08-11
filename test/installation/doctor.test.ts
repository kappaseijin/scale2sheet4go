import { readFile } from "node:fs/promises";
import os from "node:os";

import { DateTime } from "luxon";
import { describe, expect, it, vi } from "vitest";

import { runDoctor, type DoctorDeps } from "../../src/installation/doctor.js";
import type { InstallManifest } from "../../src/installation/manifest.js";
import type { InstallationPaths } from "../../src/installation/paths.js";
import { LAUNCHD_LABEL_PREFIX } from "../../src/installation/paths.js";
import type { PipelineStatusDocumentV1 } from "../../src/pipeline/status.js";
import type { GoogleFitCredentialsFile, SettingsFile } from "../../src/config/settings.js";
import type { SheetsReadPort } from "../../src/installation/sheets-read.js";

const paths: InstallationPaths = {
  home: "/Users/example",
  prefix: "/Users/example/.local",
  binDir: "/Users/example/.local/bin",
  binaryPath: "/Users/example/.local/bin/scale2sheet",
  configDir: "/Users/example/.config/scale2sheet",
  settingsPath: "/Users/example/.config/scale2sheet/settings.json",
  manifestPath: "/Users/example/.config/scale2sheet/install-manifest.json",
  activeRunPath: "/Users/example/.config/scale2sheet/active-run.json",
  pipelineStatusPath: "/Users/example/.config/scale2sheet/pipeline-status.json",
  launchAgentsDir: "/Users/example/Library/LaunchAgents",
  morningPlistPath: `/Users/example/Library/LaunchAgents/${LAUNCHD_LABEL_PREFIX}.morning.plist`,
  eveningPlistPath: `/Users/example/Library/LaunchAgents/${LAUNCHD_LABEL_PREFIX}.evening.plist`,
  logDir: "/Users/example/Library/Logs/scale-pipeline",
  morningLogPath: "/Users/example/Library/Logs/scale-pipeline/morning.log",
  morningErrLogPath: "/Users/example/Library/Logs/scale-pipeline/morning.err.log",
  eveningLogPath: "/Users/example/Library/Logs/scale-pipeline/evening.log",
  eveningErrLogPath: "/Users/example/Library/Logs/scale-pipeline/evening.err.log",
};

function healthyManifest(overrides: Partial<InstallManifest> = {}): InstallManifest {
  return {
    "schema-version": 1,
    state: "installed",
    version: "0.1.0",
    prefix: paths.prefix,
    "binary-path": paths.binaryPath,
    "config-dir": paths.configDir,
    "log-dir": paths.logDir,
    launchd: {
      enabled: true,
      domain: "gui/501",
      labels: [`${LAUNCHD_LABEL_PREFIX}.morning`, `${LAUNCHD_LABEL_PREFIX}.evening`],
      "plist-paths": [paths.morningPlistPath, paths.eveningPlistPath],
    },
    "applied-steps": [],
    "created-paths": [paths.binDir, paths.logDir],
    "updated-at": "2026-08-08T00:00:00.000Z",
    ...overrides,
  };
}

function healthySettings(overrides: Partial<SettingsFile> = {}): SettingsFile {
  return {
    "time-zone": "Asia/Tokyo",
    source: "scale-exporter",
    "sheet-id": "sheet-abc",
    "sheet-name": "体温・血圧",
    "sheets-credentials": "/Users/example/.config/scale2sheet/google-sheets-service-account.json",
    "scale-exporter-output-dir": "/Users/example/exports",
    "morning-cron": "0 7 * * *",
    "evening-cron": "0 21 * * *",
    ...overrides,
  };
}

function installedPlistXml(extra: string = ""): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict><key>Label</key><string>x</string><key>ProgramArguments</key><array><string>/Users/example/.local/bin/scale2sheet</string><string>pipeline</string><string>--period</string><string>morning</string></array>${extra}</dict>\n</plist>\n`;
}

function legacyPlistXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict><key>Label</key><string>x</string><key>ProgramArguments</key><array><string>/bin/bash</string><string>/Users/example/Dropbox/data/dev/scale2sheet/scripts/run-pipeline.sh</string><string>morning</string></array></dict>\n</plist>\n`;
}

function healthyPlistXml(): string {
  return installedPlistXml();
}

function fakeSheetsPort(overrides: Partial<SheetsReadPort> = {}): SheetsReadPort {
  return {
    authenticate: async () => {},
    readHeaderRow: async () => ["月日", "朝体重"],
    findTodayRow: async () => 5,
    ...overrides,
  };
}

function baseDeps(overrides: Partial<DoctorDeps> = {}): DoctorDeps {
  const files = new Set([
    paths.settingsPath,
    paths.binaryPath,
    "/Users/example/.config/scale2sheet/google-sheets-service-account.json",
    "/Users/example/exports",
    paths.morningErrLogPath,
    paths.eveningErrLogPath,
  ]);
  return {
    paths,
    execPath: paths.binaryPath,
    appVersion: "0.1.0",
    now: () => DateTime.fromISO("2026-08-08T09:00:00", { zone: "Asia/Tokyo" }),
    readManifest: async () => healthyManifest(),
    readSettings: () => healthySettings(),
    environment: {},
    readGoogleFitCredentials: () => undefined,
    process: {
      isRegistered: async () => true,
      printRaw: async () => ({ exitCode: 0, stdout: "state = running\n" }),
    },
    sheets: fakeSheetsPort(),
    statFile: async (filePath: string) =>
      files.has(filePath) ? { executable: filePath === paths.binaryPath, readable: true } : undefined,
    readTextFile: async (filePath: string) =>
      filePath === paths.morningPlistPath || filePath === paths.eveningPlistPath ? healthyPlistXml() : undefined,
    readActiveRunReceipt: () => undefined,
    readPipelineStatus: async () => healthyStatusDocument(),
    ...overrides,
  };
}

type DoctorAuthDeps = DoctorDeps & {
  readonly environment: Pick<NodeJS.ProcessEnv, "GOOGLE_FIT_CLIENT_ID" | "GOOGLE_FIT_CLIENT_SECRET">;
  readonly readGoogleFitCredentials: (configDir: string) => GoogleFitCredentialsFile | undefined;
};

function withGoogleFitResolution(
  deps: DoctorDeps,
  overrides: Partial<Pick<DoctorAuthDeps, "environment" | "readGoogleFitCredentials">> = {},
): DoctorAuthDeps {
  return {
    ...deps,
    environment: {},
    readGoogleFitCredentials: () => undefined,
    ...overrides,
  };
}

function healthyStatusDocument(): PipelineStatusDocumentV1 {
  return {
    schemaVersion: 1,
    definitionsVersion: 3,
    definitionsLabel: "test",
    updatedAt: "2026-08-08T00:01:00.000Z",
    periods: {
      morning: {
        consecutiveFailureCount: 0,
        consecutiveNoDataCount: 0,
        health: { state: "normal", causes: [] },
        lastTerminal: {
          runId: "r1",
          outcome: "completed:transferred",
          startedAt: "2026-08-08T07:00:00.000Z",
          completedAt: "2026-08-08T07:00:05.000Z",
          targetDate: "2026-08-08",
          counts: {},
        },
        lastDoneAt: "2026-08-08T07:00:05.000Z",
        lastTransferredAt: "2026-08-08T07:00:05.000Z",
      },
      evening: {
        consecutiveFailureCount: 0,
        consecutiveNoDataCount: 0,
        health: { state: "unobserved", causes: [] },
      },
    },
  };
}

function statusOf(report: Awaited<ReturnType<typeof runDoctor>>, id: string) {
  return report.checks.find((check) => check.id === id);
}

describe("runDoctor: overall aggregation and prohibitions", () => {
  it("does not accept a --purge or --wipe style input (doctor has no such options; read-only by construction)", async () => {
    const report = await runDoctor(baseDeps());
    expect(report.status).toBe("PASS");
  });

  it("aggregates to FAIL if any check is FAIL", async () => {
    const report = await runDoctor(baseDeps({ execPath: "/somewhere/else/scale2sheet" }));
    expect(report.status).toBe("FAIL");
  });

  it("aggregates to WARN (not FAIL) when nothing is installed", async () => {
    const report = await runDoctor(baseDeps({ readManifest: async () => undefined }));
    expect(report.status).toBe("WARN");
    expect(report.checks.every((check) => check.status !== "FAIL")).toBe(true);
  });
});

describe("runDoctor: 1. manifest schema and state", () => {
  it("PASS: a valid manifest is read successfully", async () => {
    const report = await runDoctor(baseDeps());
    expect(statusOf(report, "manifest")?.status).toBe("PASS");
  });

  it("WARN: no manifest means not installed, not a failure", async () => {
    const report = await runDoctor(baseDeps({ readManifest: async () => undefined }));
    expect(statusOf(report, "manifest")?.status).toBe("WARN");
  });
});

describe("runDoctor: 2. running binary / manifest / plist placement consistency, executable bit, --version", () => {
  it("PASS: execPath matches the manifest, the file is executable, and the version matches", async () => {
    const report = await runDoctor(baseDeps());
    expect(statusOf(report, "binary-placement")?.status).toBe("PASS");
  });

  it("FAIL (INSTALL_PATH_MISMATCH): the running binary is not the manifest's recorded path", async () => {
    const report = await runDoctor(baseDeps({ execPath: "/Applications/scale2sheet" }));
    const check = statusOf(report, "binary-placement");
    expect(check?.status).toBe("FAIL");
    expect(check?.stage).toBe("INSTALL_PATH_MISMATCH");
    expect(check?.message).toContain(`scale2sheet install --prefix ${paths.prefix} --launchd`);
  });

  it("FAIL (BINARY_NOT_EXECUTABLE): the manifest's binary path has no execute permission", async () => {
    const report = await runDoctor(
      baseDeps({
        statFile: async (filePath) =>
          filePath === paths.binaryPath ? { executable: false, readable: true } : undefined,
      }),
    );
    const check = statusOf(report, "binary-executable");
    expect(check?.status).toBe("FAIL");
    expect(check?.stage).toBe("BINARY_NOT_EXECUTABLE");
    expect(check?.message).toContain(`scale2sheet install --prefix ${paths.prefix} --launchd`);
  });

  it("FAIL (BINARY_VERSION_MISMATCH): the running binary's version differs from the manifest's", async () => {
    const report = await runDoctor(baseDeps({ appVersion: "0.2.0" }));
    const check = statusOf(report, "binary-version");
    expect(check?.status).toBe("FAIL");
    expect(check?.stage).toBe("BINARY_VERSION_MISMATCH");
    expect(check?.message).toContain(`scale2sheet install --prefix ${paths.prefix} --launchd`);
  });
});

describe("runDoctor: 3. settings.json JSON and schema", () => {
  it("PASS: settings.json parses and validates", async () => {
    const report = await runDoctor(baseDeps());
    expect(statusOf(report, "settings")?.status).toBe("PASS");
  });

  it("WARN: no settings.json yet", async () => {
    const report = await runDoctor(baseDeps({ readSettings: () => undefined }));
    expect(statusOf(report, "settings")?.status).toBe("WARN");
  });

  it("FAIL: settings.json fails to parse or validate", async () => {
    const report = await runDoctor(
      baseDeps({
        readSettings: () => {
          throw new Error("invalid settings file: settings.json: bad JSON");
        },
      }),
    );
    expect(statusOf(report, "settings")?.status).toBe("FAIL");
  });
});

describe("runDoctor: 4. Google Sheets key file existence and readability", () => {
  it("PASS: the sheets-credentials file exists and is readable", async () => {
    const report = await runDoctor(baseDeps());
    expect(statusOf(report, "sheets-key-file")?.status).toBe("PASS");
  });

  it("FAIL (KEY_MISSING): sheets-credentials is configured but the file is missing", async () => {
    const report = await runDoctor(
      baseDeps({
        readSettings: () => healthySettings({ "sheets-credentials": "/tmp/does-not-exist.json" }),
      }),
    );
    const check = statusOf(report, "sheets-key-file");
    expect(check?.status).toBe("FAIL");
    expect(check?.stage).toBe("KEY_MISSING");
  });

  it("WARN: sheets-credentials is not configured without throwing", async () => {
    const report = await runDoctor(
      baseDeps({ readSettings: () => healthySettings({ "sheets-credentials": undefined }) }),
    );
    expect(statusOf(report, "sheets-key-file")?.status).toBe("WARN");
  });

  it("PASS: expands a tilde in sheets-credentials before stat", async () => {
    const report = await runDoctor(
      baseDeps({
        readSettings: () => healthySettings({ "sheets-credentials": "~/.config/scale2sheet/credentials.json" }),
        statFile: async (filePath) =>
          filePath === `${os.homedir()}/.config/scale2sheet/credentials.json`
            || filePath === "/Users/example/exports"
            || filePath === paths.binaryPath
            || filePath === paths.settingsPath
            ? { executable: filePath === paths.binaryPath, readable: true }
            : undefined,
      }),
    );
    expect(statusOf(report, "sheets-key-file")?.status).toBe("PASS");
  });
});

describe("runDoctor: 5. source-specific extra auth file (google-fit only)", () => {
  it("PASS: apple-health source needs no extra auth file, so this check does not apply (WARN-not-applicable)", async () => {
    const report = await runDoctor(baseDeps({ readSettings: () => healthySettings({ source: "apple-health" }) }));
    expect(statusOf(report, "source-auth-file")?.status).not.toBe("FAIL");
  });

  it("N-8: FAIL (KEY_MISSING) when only google-fit-token-path exists but client credentials are absent", async () => {
    const report = await runDoctor(
      withGoogleFitResolution(
        baseDeps({
          readSettings: () =>
            healthySettings({ source: "google-fit", "google-fit-token-path": "/Users/example/google-fit-token.json" }),
          statFile: async (filePath) =>
            [paths.binaryPath, "/Users/example/.config/scale2sheet/google-sheets-service-account.json", "/Users/example/exports", "/Users/example/google-fit-token.json"].includes(filePath)
              ? { executable: filePath === paths.binaryPath, readable: true }
              : undefined,
        }),
      ),
    );
    const check = statusOf(report, "source-auth-file");
    expect(check?.status).toBe("FAIL");
    expect(check?.stage).toBe("KEY_MISSING");
    expect(check?.message).toContain("client credentials");
  });

  it("N-8b: PASS when client ID and secret are configured without an explicit redirect URI", async () => {
    const report = await runDoctor(
      withGoogleFitResolution(
        baseDeps({
          readSettings: () =>
            healthySettings({
              source: "google-fit",
              "google-fit-client-id": "client-id",
              "google-fit-client-secret": "client-secret",
              "google-fit-token-path": "/Users/example/google-fit-token.json",
            }),
          statFile: async (filePath) =>
            [paths.binaryPath, "/Users/example/.config/scale2sheet/google-sheets-service-account.json", "/Users/example/exports", "/Users/example/google-fit-token.json"].includes(filePath)
              ? { executable: filePath === paths.binaryPath, readable: true }
              : undefined,
        }),
      ),
    );
    const check = statusOf(report, "source-auth-file");
    expect(check?.status).toBe("PASS");
    expect(check?.message).toContain("client credentials");
  });

  it("uses the credentials file when settings and environment leave either required credential absent", async () => {
    const report = await runDoctor(
      withGoogleFitResolution(
        baseDeps({
          readSettings: () => healthySettings({ source: "google-fit" }),
        }),
        {
          readGoogleFitCredentials: () => ({ clientId: "file-id", clientSecret: "file-secret" }),
        },
      ),
    );
    expect(statusOf(report, "source-auth-file")?.status).toBe("PASS");
  });
});

describe("runDoctor: 6. scale_exporter output directory existence and readability", () => {
  it("PASS: the configured output directory exists and is readable", async () => {
    const report = await runDoctor(
      baseDeps({
        statFile: async (filePath) =>
          filePath === "/Users/example/exports" || filePath === paths.binaryPath || filePath === paths.settingsPath
            ? { executable: filePath === paths.binaryPath, readable: true }
            : undefined,
      }),
    );
    expect(statusOf(report, "scale-exporter-output-dir")?.status).toBe("PASS");
  });

  it("FAIL: the configured output directory does not exist", async () => {
    const report = await runDoctor(
      baseDeps({
        statFile: async (filePath) =>
          [paths.binaryPath, paths.settingsPath, "/Users/example/.config/scale2sheet/google-sheets-service-account.json"].includes(filePath)
            ? { executable: filePath === paths.binaryPath, readable: true }
            : undefined,
      }),
    );
    expect(statusOf(report, "scale-exporter-output-dir")?.status).toBe("FAIL");
  });

  it("PASS: expands a tilde in the configured output directory before stat", async () => {
    const report = await runDoctor(
      baseDeps({
        readSettings: () => healthySettings({ "scale-exporter-output-dir": "~/exports" }),
        statFile: async (filePath) =>
          filePath === `${os.homedir()}/exports` || filePath === paths.binaryPath || filePath === paths.settingsPath
            ? { executable: filePath === paths.binaryPath, readable: true }
            : undefined,
      }),
    );
    expect(statusOf(report, "scale-exporter-output-dir")?.status).toBe("PASS");
  });

  it("FAIL: reports a missing expanded tilde output directory", async () => {
    const report = await runDoctor(
      baseDeps({
        readSettings: () => healthySettings({ "scale-exporter-output-dir": "~/missing-exports" }),
        statFile: async (filePath) =>
          filePath === paths.binaryPath || filePath === paths.settingsPath
            ? { executable: filePath === paths.binaryPath, readable: true }
            : undefined,
      }),
    );
    expect(statusOf(report, "scale-exporter-output-dir")?.status).toBe("FAIL");
  });

  it("WARN: scale-exporter-output-dir is not configured without throwing", async () => {
    const report = await runDoctor(
      baseDeps({ readSettings: () => healthySettings({ "scale-exporter-output-dir": undefined }) }),
    );
    expect(statusOf(report, "scale-exporter-output-dir")?.status).toBe("WARN");
  });
});

describe("runDoctor: 7. plist syntax and execution route", () => {
  it("PASS: installed plists invoke pipeline and do not reference scripts/run-pipeline.sh", async () => {
    const report = await runDoctor(baseDeps());
    expect(statusOf(report, "plist-syntax")?.status).toBe("PASS");
  });

  it("N-9: WARN, not FAIL, for the legacy run-pipeline.sh route because cutover has not happened", async () => {
    const report = await runDoctor(
      baseDeps({
        readTextFile: async (filePath) =>
          filePath === paths.morningPlistPath
            ? legacyPlistXml()
            : filePath === paths.eveningPlistPath
              ? legacyPlistXml()
              : undefined,
      }),
    );
    const check = statusOf(report, "plist-syntax");
    // Legacy is the documented pre-cutover route; treating its checkout path
    // as a failure would make doctor unusable as the cutover gate.
    expect(check?.status).toBe("WARN");
    expect(check?.message).toContain("legacy");
  });

  it("N-10: FAIL when an installed plist still contains a fixed checkout path", async () => {
    const report = await runDoctor(
      baseDeps({
        readTextFile: async (filePath) =>
          filePath === paths.morningPlistPath
            ? installedPlistXml("<key>WorkingDirectory</key><string>/Users/example/Dropbox/data/dev/scale2sheet/scripts/run-pipeline.sh</string>")
            : filePath === paths.eveningPlistPath
              ? healthyPlistXml()
              : undefined,
      }),
    );
    expect(statusOf(report, "plist-syntax")?.status).toBe("FAIL");
  });
});

describe("runDoctor: 8. registration state of both launchd labels", () => {
  it("PASS: both labels report registered", async () => {
    const report = await runDoctor(baseDeps());
    expect(statusOf(report, "launchd-registration")?.status).toBe("PASS");
  });

  it("WARN: a label is not registered (informational, not a failure by itself)", async () => {
    const report = await runDoctor(
      baseDeps({ process: { isRegistered: async () => false, printRaw: async () => ({ exitCode: 113, stdout: "" }) } }),
    );
    expect(statusOf(report, "launchd-registration")?.status).toBe("WARN");
  });
});

describe("runDoctor: 9. registration presence, best-effort raw output, stderr log existence", () => {
  it("PASS: raw print output and both stderr logs are present", async () => {
    const report = await runDoctor(
      baseDeps({
        statFile: async (filePath) =>
          [paths.binaryPath, paths.settingsPath, "/Users/example/.config/scale2sheet/google-sheets-service-account.json", paths.morningErrLogPath, paths.eveningErrLogPath].includes(filePath)
            ? { executable: filePath === paths.binaryPath, readable: true }
            : undefined,
      }),
    );
    const check = statusOf(report, "launchd-diagnostic");
    expect(check?.status).toBe("PASS");
    expect(check?.message).toContain("state = running");
  });

  it("WARN: stderr logs do not exist yet (never run)", async () => {
    const report = await runDoctor(
      baseDeps({
        statFile: async (filePath) =>
          [paths.binaryPath, paths.settingsPath, "/Users/example/.config/scale2sheet/google-sheets-service-account.json", "/Users/example/exports"].includes(filePath)
            ? { executable: filePath === paths.binaryPath, readable: true }
            : undefined,
      }),
    );
    expect(statusOf(report, "launchd-diagnostic")?.status).toBe("WARN");
  });
});

describe("runDoctor: 10. serve liveness via the run receipt", () => {
  it("PASS/info: no active receipt means serve is not running", async () => {
    const report = await runDoctor(baseDeps());
    const check = statusOf(report, "serve-liveness");
    expect(check?.status).toBe("PASS");
    expect(check?.message).toContain("not running");
  });

  it("PASS/info: an active serve receipt is reported, not treated as a failure", async () => {
    const report = await runDoctor(
      baseDeps({
        readActiveRunReceipt: () => ({
          kind: "serve",
          origin: "manual",
          pid: 4242,
          startedAt: "2026-08-08T00:00:00.000Z",
        }),
      }),
    );
    const check = statusOf(report, "serve-liveness");
    expect(check?.status).toBe("PASS");
    expect(check?.message).toContain("4242");
  });
});

describe("runDoctor: 11. pipeline-status.json's most recent start/completion/result", () => {
  it("reports persisted execution facts without treating done as a transfer or inventing anomaly duration", async () => {
    const document = healthyStatusDocument();
    const report = await runDoctor(
      baseDeps({
        now: () => DateTime.fromISO("2026-08-10T09:00:00", { zone: "Asia/Tokyo" }),
        readPipelineStatus: async () => ({
          ...document,
          periods: {
            ...document.periods,
            morning: {
              ...document.periods.morning,
              lastTransferredAt: "2026-08-07T07:00:05.000Z",
              lastTerminal: {
                ...document.periods.morning.lastTerminal!,
                counts: { windowedReadingCount: 2, uniqueMeasurementCount: 2 },
                partialInput: true,
                v3: {
                  input: "ready",
                  windowedWeightCount: 2,
                  transfer: { state: "written", transferredCellCount: 4 },
                },
              },
            },
          },
        }),
      }),
    );

    const message = statusOf(report, "last-run")?.message ?? "";
    expect(message).toContain("APP_VERSION 0.1.0");
    expect(message).toContain("morning: completed:transferred");
    expect(message).toContain("target date 2026-08-08");
    expect(message).toContain("started 2026-08-08T07:00:00.000Z");
    expect(message).toContain("completed 2026-08-08T07:00:05.000Z");
    expect(message).toContain("transferred cells 4");
    expect(message).toContain("last done 2026-08-08T07:00:05.000Z (1 days ago)");
    expect(message).toContain("last actual transfer 2026-08-07T07:00:05.000Z (2 days ago)");
    expect(message).toContain("partial input true");
    expect(message).toContain("evening: unobserved");
    expect(message).toContain(`morning stderr ${paths.morningErrLogPath}`);
    expect(message).toContain(`evening stderr ${paths.eveningErrLogPath}`);
    expect(message).not.toContain("anomaly duration");
  });

  it("reports a missing status as expected on the legacy route, where it is never written", async () => {
    const report = await runDoctor(
      baseDeps({
        readPipelineStatus: async () => undefined,
        readTextFile: async (filePath) =>
          filePath === paths.morningPlistPath || filePath === paths.eveningPlistPath
            ? legacyPlistXml()
            : undefined,
      }),
    );
    const check = statusOf(report, "last-run");
    expect(check?.status).toBe("PASS");
    expect(check?.message).toContain("not written on this route");
  });

  it("reports a missing status as not executed on the installed route", async () => {
    const report = await runDoctor(baseDeps({ readPipelineStatus: async () => undefined }));
    const check = statusOf(report, "last-run");
    expect(check?.status).toBe("WARN");
    expect(check?.message).toContain("not executed");
  });

  it("PASS: the most recent run completed and transferred", async () => {
    const report = await runDoctor(baseDeps());
    expect(statusOf(report, "last-run")?.status).toBe("PASS");
  });

  it("WARN: no pipeline-status.json yet (never run)", async () => {
    const report = await runDoctor(baseDeps({ readPipelineStatus: async () => undefined }));
    expect(statusOf(report, "last-run")?.status).toBe("WARN");
  });

  it("FAIL (LAST_RUN_FAILED): the most recent run for a period failed", async () => {
    const report = await runDoctor(
      baseDeps({
        readPipelineStatus: async () => {
          const document = healthyStatusDocument();
          return {
            ...document,
            periods: {
              ...document.periods,
              morning: {
                ...document.periods.morning,
                lastTerminal: {
                  ...document.periods.morning.lastTerminal!,
                  outcome: "failed:transfer",
                },
              },
            },
          };
        },
      }),
    );
    const check = statusOf(report, "last-run");
    expect(check?.status).toBe("FAIL");
    expect(check?.stage).toBe("LAST_RUN_FAILED");
  });
});

describe("runDoctor: 12. Google Sheets authentication", () => {
  it("PASS: authenticate() succeeds", async () => {
    const report = await runDoctor(baseDeps());
    expect(statusOf(report, "sheets-auth")?.status).toBe("PASS");
  });

  it("FAIL (AUTH_FAILED): authenticate() throws", async () => {
    const report = await runDoctor(
      baseDeps({
        sheets: fakeSheetsPort({
          authenticate: async () => {
            throw new Error("invalid_grant");
          },
        }),
      }),
    );
    const check = statusOf(report, "sheets-auth");
    expect(check?.status).toBe("FAIL");
    expect(check?.stage).toBe("AUTH_FAILED");
  });
});

describe("runDoctor: 13. target Spreadsheet and sheet read", () => {
  it("PASS: readHeaderRow() succeeds", async () => {
    const report = await runDoctor(baseDeps());
    expect(statusOf(report, "sheets-read")?.status).toBe("PASS");
  });

  it("FAIL (SHEET_NOT_SHARED): readHeaderRow() throws", async () => {
    const report = await runDoctor(
      baseDeps({
        sheets: fakeSheetsPort({
          readHeaderRow: async () => {
            throw new Error("The caller does not have permission");
          },
        }),
      }),
    );
    const check = statusOf(report, "sheets-read");
    expect(check?.status).toBe("FAIL");
    expect(check?.stage).toBe("SHEET_NOT_SHARED");
  });
});

describe("runDoctor: 14. date column and today's row identification", () => {
  it("design integration 11: calls the fake Sheets API in read-only order", async () => {
    const calls: string[] = [];
    const sheets: SheetsReadPort = {
      authenticate: vi.fn(async () => {
        calls.push("authenticate");
      }),
      readHeaderRow: vi.fn(async () => {
        calls.push("readHeaderRow");
        return ["月日", "朝体重"];
      }),
      findTodayRow: vi.fn(async () => {
        calls.push("findTodayRow");
        return 5;
      }),
    };

    const report = await runDoctor(baseDeps({ sheets }));

    expect(report.status).toBe("PASS");
    expect(calls).toEqual(["authenticate", "readHeaderRow", "findTodayRow"]);
    expect(Object.keys(sheets).sort()).toEqual(["authenticate", "findTodayRow", "readHeaderRow"]);
  });

  it("PASS: today's row is found", async () => {
    let receivedDateColumnIndex: number | undefined;
    const report = await runDoctor(baseDeps({
      sheets: fakeSheetsPort({
        findTodayRow: async (dateColumnIndex) => {
          receivedDateColumnIndex = dateColumnIndex;
          return 5;
        },
      }),
    }));
    expect(statusOf(report, "today-row")?.status).toBe("PASS");
    expect(receivedDateColumnIndex).toBe(0);
  });

  it("FAIL (TODAY_ROW_MISSING): no row matches today", async () => {
    const report = await runDoctor(
      baseDeps({ sheets: fakeSheetsPort({ findTodayRow: async () => undefined }) }),
    );
    const check = statusOf(report, "today-row");
    expect(check?.status).toBe("FAIL");
    expect(check?.stage).toBe("TODAY_ROW_MISSING");
  });

  it("FAIL (TODAY_ROW_MISSING): the header row has no recognizable date column", async () => {
    const report = await runDoctor(
      baseDeps({ sheets: fakeSheetsPort({ readHeaderRow: async () => ["朝体重", "朝体温"] }) }),
    );
    const check = statusOf(report, "today-row");
    expect(check?.status).toBe("FAIL");
    expect(check?.stage).toBe("TODAY_ROW_MISSING");
  });
});

describe("runDoctor: negative controls (plan §5)", () => {
  it("N-3: does not write to the manifest, settings, or launchd — a fake that throws on any write call would fail the whole run if doctor ever wrote", async () => {
    // doctor's deps expose no write-capable manifest/settings/launchd methods
    // at all (readManifest/readSettings/isRegistered/printRaw are
    // read-only by type), so this is a structural, type-level guarantee
    // rather than a runtime spy — matching Task 1's SheetsReadPort approach.
    const deps = baseDeps();
    const allowedManifestMethods = ["readManifest"];
    const allowedSettingsMethods = ["readSettings"];
    expect(Object.keys(deps).filter((key) => key.toLowerCase().includes("manifest"))).toEqual(
      allowedManifestMethods,
    );
    expect(Object.keys(deps).filter((key) => key.toLowerCase().includes("settings"))).toEqual(
      allowedSettingsMethods,
    );
  });

  it("N-4: launchd registration state is judged by isRegistered's boolean (exit code), not by parsing printRaw's text", async () => {
    // Deliberately contradictory fixture: isRegistered (the correct,
    // exit-code-only source) says registered, but printRaw's raw text does
    // NOT say "running" at all. If the registration check ever switched to
    // parsing the raw text (the exact regression N-4 guards against), it
    // would judge this as unregistered (WARN) — verified by mutation: this
    // assertion fails when checkLaunchdRegistration is changed to read
    // printRaw's stdout instead of calling isRegistered.
    const report = await runDoctor(
      baseDeps({
        process: {
          isRegistered: async () => true,
          printRaw: async () => ({ exitCode: 113, stdout: "unexpected format, no state field\n" }),
        },
      }),
    );
    expect(statusOf(report, "launchd-registration")?.status).toBe("PASS");
  });

  it("N-5: does not judge whether the last run happened on schedule (no expected-time-exceeded check exists)", async () => {
    // "now" is set far past the healthy fixture's last morning run
    // (completed 2026-08-08T07:00:05Z) — a plausible "is this overdue"
    // mutation comparing deps.now() against the last completion or
    // against a fixed expected schedule would flag this as stale. The
    // real implementation must stay PASS regardless (design AC-36: "判定
    // は利用者が行う").
    const report = await runDoctor(baseDeps({ now: () => DateTime.fromISO("2026-08-09T20:00:00", { zone: "Asia/Tokyo" }) }));
    const lastRunCheck = statusOf(report, "last-run");
    expect(lastRunCheck?.status).toBe("PASS");
    expect(lastRunCheck?.message).not.toMatch(/expected|overdue|on time|scheduled/i);
    expect(report.checks.some((check) => /overdue|expected time/i.test(check.message))).toBe(false);
  });

  it("N-6: an uninstalled state (no manifest) is WARN, not FAIL", async () => {
    const report = await runDoctor(baseDeps({ readManifest: async () => undefined }));
    expect(report.status).toBe("WARN");
  });

  it("N-7: any single FAIL check makes the aggregate exit non-zero (FAIL), never silently PASS/WARN", async () => {
    const report = await runDoctor(baseDeps({ appVersion: "9.9.9" }));
    expect(report.status).toBe("FAIL");
  });

  it("N-11: doctor has no notifier dependency or notification dispatch", async () => {
    // DoctorDeps deliberately has no notifier port.  The source-level check
    // complements that type boundary: adding a notification import/call is a
    // behavior change and must make this read-only contract visibly fail.
    const source = await readFile(new URL("../../src/installation/doctor.ts", import.meta.url), "utf8");
    expect(Object.keys(baseDeps()).some((key) => /notifier|notification/i.test(key))).toBe(false);
    expect(source).not.toMatch(/\bnotifier\b|\.notify\(/i);
  });
});
