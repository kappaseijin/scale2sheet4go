#!/usr/bin/env node

/**
 * README と src/config/ のキー対応を検査する
 * 用途: Issue #110 受け入れ条件 5 の置き換え（方向 B: 機械的なキー対応検査）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// ===== README が要求する設定キーを動的に抽出 =====
// 出典: README の config key table（L54-62 付近）から抽出
const readmeFile = fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf8');
const readmeKeys = new Set();

// table セクション（| キー | 用途 | という headers を含む部分）を抽出
// table 行パターン: | `key` | description |
// スラッシュで複数キーを含む場合: | `key1` / `key2` | description |
const tablePattern = /\|\s*`([^|]+)`\s*\|/g;
let match;
while ((match = tablePattern.exec(readmeFile)) !== null) {
  const cellContent = match[1];
  // セル内のスラッシュで複数キーを分割
  cellContent.split(' / ').forEach((part) => {
    // backtick を削除して key を抽出
    const key = part.replace(/`/g, '').trim();
    // config キーのフォーマット: lowercase + hyphen（settings.json キー）
    if (/^[a-z][a-z0-9-]*$/.test(key)) {
      readmeKeys.add(key);
    }
  });
}

// ===== src/config/settings.ts から実装キーを抽出 =====
const settingsFile = fs.readFileSync(path.join(projectRoot, 'src/config/settings.ts'), 'utf8');

const settingsKeys = new Set();
const settingsSchemaMatch = settingsFile.match(/const settingsFileSchema[\s\S]*?\.passthrough\(\);/);
if (!settingsSchemaMatch) {
  console.error('Error: settingsFileSchema not found in settings.ts');
  process.exit(1);
}

const schemaText = settingsSchemaMatch[0];
const settingsKeyMatches = schemaText.match(/"([a-z][a-z0-9-]*)"/g);
if (settingsKeyMatches) {
  settingsKeyMatches.forEach((match) => {
    const key = match.slice(1, -1);
    settingsKeys.add(key);
  });
}

// ===== src/config/env.ts から環境変数と mapping 配列を抽出 =====
const envFile = fs.readFileSync(path.join(projectRoot, 'src/config/env.ts'), 'utf8');

const envSchema = new Set();
const envMatches = envFile.match(/([A-Z][A-Z0-9_]*)\s*:/g);
if (envMatches) {
  envMatches.forEach((match) => {
    const envKey = match.slice(0, -1);
    envSchema.add(envKey);
  });
}

// 明示的な mapping 配列から対応関係を抽出
const mappedEnvVars = new Set();
const mappingSection = envFile.match(/const mapping:[\s\S]*?\];/);
if (mappingSection) {
  const matches = mappingSection[0].match(/"([A-Z][A-Z0-9_]*)"\s*\]/g);
  if (matches) {
    matches.forEach((match) => {
      const envKey = match.slice(1, -2);
      mappedEnvVars.add(envKey);
    });
  }
}

// ===== README から環境変数要求を確認 =====
const readmeEnvVars = new Set(['TIME_ZONE']);

// .env.example から環境変数を抽出
const envExampleFile = fs.readFileSync(path.join(projectRoot, '.env.example'), 'utf8');
const envExampleVars = new Set();
const envExampleMatches = envExampleFile.match(/^([A-Z][A-Z0-9_]*)=/gm);
if (envExampleMatches) {
  envExampleMatches.forEach((match) => {
    const key = match.slice(0, -1);
    envExampleVars.add(key);
  });
}

// ===== 3 分類の計算 =====
// A: settings.json キーで README に無いもの
const missingFromReadmeA = Array.from(settingsKeys).filter((k) => !readmeKeys.has(k));

// B: 環境変数で README にも .env.example にも無いもの
const missingFromBothB = Array.from(envSchema).filter(
  (k) => !readmeEnvVars.has(k) && !envExampleVars.has(k)
);

// C: 環境変数で settings.json 経由で設定できないもの
const notViaSettingsC = Array.from(envSchema).filter((k) => !mappedEnvVars.has(k));

// ===== 出力 =====
console.log('## README 設定キー検証\n');

console.log('### A: settings.json キーで README に無いもの\n');
console.log(`${settingsKeys.size} 個中 ${missingFromReadmeA.length} 件`);
if (missingFromReadmeA.length > 0) {
  console.log(`\n${missingFromReadmeA.sort().join('\n')}`);
}

console.log('\n---\n');
console.log('### B: 環境変数で README にも .env.example にも無いもの\n');
console.log(`${envSchema.size} 個中 ${missingFromBothB.length} 件`);
if (missingFromBothB.length > 0) {
  console.log(`\n${missingFromBothB.sort().join('\n')}`);
}

console.log('\n---\n');
console.log('### C: 環境変数で settings.json 経由で設定できないもの\n');
console.log(`${envSchema.size} 個中 ${notViaSettingsC.length} 件`);
if (notViaSettingsC.length > 0) {
  console.log(`\n${notViaSettingsC.sort().join('\n')}`);
}

console.log('\n---\n');
console.log(`**合計**: A=${missingFromReadmeA.length} + B=${missingFromBothB.length} + C=${notViaSettingsC.length}\n`);

// #140 follow-up: this was a classifier a human read, not a regression
// detector -- it always exited 0 regardless of what it found, so nothing
// ever failed when README/settings/env drifted out of sync. All three
// categories are genuine defects when nonzero (verified: on the baseline
// this script was written against, C's three GOOGLE_FIT_* entries were a
// real gap, since fixed by #146's settings.json mapping addition) -- so
// any nonzero count is a real regression to fail on, not noise to tolerate.
const totalDeficiencies = missingFromReadmeA.length + missingFromBothB.length + notViaSettingsC.length;
process.exit(totalDeficiencies > 0 ? 1 : 0);
