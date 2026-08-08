export type InstallationOperation =
  | { readonly kind: "ensure-directory"; readonly path: string; readonly mode: number }
  | { readonly kind: "ensure-settings"; readonly path: string }
  | { readonly kind: "replace-binary"; readonly source: string; readonly target: string }
  | { readonly kind: "write-plist"; readonly label: string; readonly path: string; readonly xml: string }
  | { readonly kind: "acquire-maintenance-lease"; readonly path: string }
  | { readonly kind: "bootout"; readonly domain: string; readonly label: string }
  | { readonly kind: "bootstrap"; readonly domain: string; readonly plistPath: string }
  | { readonly kind: "remove-file"; readonly path: string }
  | { readonly kind: "remove-tree"; readonly path: string }
  | { readonly kind: "archive-paths"; readonly target: string; readonly paths: readonly string[] };

export interface OperationResult {
  readonly operation: InstallationOperation;
  readonly status: "planned" | "done" | "skipped" | "failed";
  readonly message: string;
}

export interface InstallOptions {
  readonly prefix: string;
  readonly launchd: boolean;
  readonly dryRun: boolean;
  readonly force: boolean;
}

export interface UninstallOptions {
  readonly prefix?: string;
  readonly dryRun: boolean;
  readonly purge: boolean;
  readonly wipe: boolean;
  readonly archive?: string;
  readonly yes: boolean;
}
