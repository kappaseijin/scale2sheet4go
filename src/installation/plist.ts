export interface PipelinePlistTime {
  readonly hour: number;
  readonly minute: number;
}

export interface PipelinePlistInput {
  readonly label: string;
  readonly binaryPath: string;
  readonly period: "morning" | "evening";
  readonly stdoutPath: string;
  readonly stderrPath: string;
  /** design §実行時刻: morning has two entries (07:00, 11:30), evening two (21:00, 23:30). */
  readonly times: readonly PipelinePlistTime[];
  /** design §EnvironmentVariables: HOME the job runs with. */
  readonly home: string;
  /** design §EnvironmentVariables: PATH item 1 (`<prefix>/bin`). */
  readonly binDir: string;
}

/**
 * design §EnvironmentVariables: `<prefix>/bin`, then the fixed system dirs,
 * deduped and joined with `:`. The interactive shell's PATH is never copied.
 */
const FIXED_PATH_ENTRIES = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
] as const;

function buildLaunchdPath(binDir: string): string {
  const seen = new Set<string>();
  const entries: string[] = [];
  for (const entry of [binDir, ...FIXED_PATH_ENTRIES]) {
    if (seen.has(entry)) {
      continue;
    }
    seen.add(entry);
    entries.push(entry);
  }
  return entries.join(":");
}

/** Returns a launchd plist value without reading or writing the filesystem. */
export function buildPipelinePlist(input: PipelinePlistInput): string {
  const xml = (value: string): string => value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

  const calendarIntervals = input.times
    .map((time) => `<dict><key>Hour</key><integer>${time.hour}</integer><key>Minute</key><integer>${time.minute}</integer></dict>`)
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>${xml(input.label)}</string>
    <key>ProgramArguments</key>
    <array><string>${xml(input.binaryPath)}</string><string>pipeline</string><string>--period</string><string>${input.period}</string></array>
    <key>StartCalendarInterval</key>
    <array>${calendarIntervals}</array>
    <key>StandardOutPath</key><string>${xml(input.stdoutPath)}</string>
    <key>StandardErrorPath</key><string>${xml(input.stderrPath)}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key><string>${xml(input.home)}</string>
        <key>PATH</key><string>${xml(buildLaunchdPath(input.binDir))}</string>
        <key>SCALE2SHEET_LAUNCHD_LABEL</key><string>${xml(input.label)}</string>
    </dict>
</dict>
</plist>
`;
}
