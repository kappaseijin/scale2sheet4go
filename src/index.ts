#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { runCli } from "./cli/index.js";

export * from "./auth/index.js";
export * from "./cli/index.js";
export * from "./config/index.js";
export * from "./domain/index.js";
export * from "./scheduler/index.js";
export * from "./installation/plist.js";
export * from "./service/index.js";
export * from "./sheets/index.js";
export * from "./sources/index.js";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli();
}
