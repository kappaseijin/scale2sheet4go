#!/usr/bin/env node

/**
 * Verify that the current Go configuration contract is documented in README.
 *
 * The product implementation is Go; the old TypeScript configuration is not
 * used as an authority for this check.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const readme = fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf8');
const settingsSource = fs.readFileSync(
  path.join(projectRoot, 'internal/config/settings.go'),
  'utf8',
);
const envSource = fs.readFileSync(path.join(projectRoot, 'internal/config/env.go'), 'utf8');

const settingsKeys = new Set(
  [...settingsSource.matchAll(/json:"([a-z][a-z0-9-]*)"/g)].map((match) => match[1]),
);
const environmentKeys = new Set(
  [...envSource.matchAll(/(?:getString|positiveIntSetting)\("([A-Z][A-Z0-9_]*)"/g)].map(
    (match) => match[1],
  ),
);

const missingSettings = [...settingsKeys].filter((key) => !readme.includes(`\`${key}\``));
const missingEnvironment = [...environmentKeys].filter((key) => !readme.includes(`\`${key}\``));

console.log(
  `README Go 設定キー検証: settings=${settingsKeys.size}, env=${environmentKeys.size}`,
);
if (missingSettings.length > 0 || missingEnvironment.length > 0) {
  if (missingSettings.length > 0) {
    console.error(`未記載の settings.json キー: ${missingSettings.join(', ')}`);
  }
  if (missingEnvironment.length > 0) {
    console.error(`未記載の環境変数: ${missingEnvironment.join(', ')}`);
  }
  process.exit(1);
}

console.log('README Go 設定キー検証: PASS');
