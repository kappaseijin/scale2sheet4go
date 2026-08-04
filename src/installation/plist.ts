export interface PipelinePlistInput {
  readonly label: string;
  readonly binaryPath: string;
  readonly period: "morning" | "evening";
  readonly stdoutPath: string;
  readonly stderrPath: string;
  readonly hour: number;
  readonly minute: number;
}

/** Returns a launchd plist value without reading or writing the filesystem. */
export function buildPipelinePlist(input: PipelinePlistInput): string {
  const xml = (value: string): string => value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>${xml(input.label)}</string>
    <key>ProgramArguments</key>
    <array><string>${xml(input.binaryPath)}</string><string>pipeline</string><string>--period</string><string>${input.period}</string></array>
    <key>StartCalendarInterval</key>
    <dict><key>Hour</key><integer>${input.hour}</integer><key>Minute</key><integer>${input.minute}</integer></dict>
    <key>StandardOutPath</key><string>${xml(input.stdoutPath)}</string>
    <key>StandardErrorPath</key><string>${xml(input.stderrPath)}</string>
</dict>
</plist>
`;
}
