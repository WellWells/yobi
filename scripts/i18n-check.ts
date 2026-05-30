import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const LANG_DIR = path.join(ROOT, 'language');
const EN_JSON_PATH = path.join(LANG_DIR, 'en-US.json');
const SRC_DIR = path.join(ROOT, 'src');

// --- Configuration ---

// Excluded scripts that should not be scanned for i18n key usage.
const EXCLUDED_SCRIPTS = new Set(['i18n-check.ts', 'strip-i18n-fallbacks.ts']);

// --- Helpers ---

function walkDir(dir: string, exts: string[]): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'out', 'dist', '.git'].includes(entry.name)) continue;
      results.push(...walkDir(full, exts));
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Key extraction logic.
 * t() now takes 1 argument (key) or 2 arguments (ctx, key).
 */
function extractKeysFromSource(src: string): string[] {
  const keys: string[] = [];

  // 1. Simple form: t('key') or tg('key') -> capture first quoted string.
  const simpleRe = /\bt(?:g)?\(\s*['"]([a-z][a-zA-Z0-9._-]*)['"]\s*[,)]/g;

  // 2. Context form: t(ctx, 'key') or tg(ctx, 'key') -> capture second quoted string.
  const contextRe = /\bt(?:g)?\(\s*[^'"]+?\s*,\s*['"]([a-z][a-zA-Z0-9._-]*)['"]\s*[,)]/g;

  // 3. Bracket-access form: strings['key.sub'].
  const bracketRe = /\[['"]([a-z][a-zA-Z0-9_-]*(?:\.[a-zA-Z0-9._-]+)+)['"]\]/g;

  // 4. Dotted string literals stored in object properties (e.g. descKey: 'capture.format.png.desc').
  //    Intentionally broad — false positives are harmless since we cross-check against the JSON.
  const keyLiteralRe = /['"]([a-z][a-zA-Z0-9_-]*(?:\.[a-zA-Z0-9._-]+)+)['"]/g;

  for (const re of [simpleRe, contextRe, bracketRe, keyLiteralRe]) {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(src)) !== null) {
      keys.push(m[1]);
    }
  }
  return keys;
}

/**
 * Auto-detects dynamic key prefixes from template literal t() calls.
 * e.g. t(`prefix.sub.${variable}`) → prefix 'prefix.sub.'
 * This eliminates the need for a manually maintained whitelist.
 */
function extractDynamicPrefixes(sources: string[]): Set<string> {
  const prefixes = new Set<string>();
  // Match t(`staticPart${...}`) and capture the static prefix before ${}
  const re = /\bt(?:g)?\(\s*`([a-z][a-zA-Z0-9._-]*)\$\{/g;
  for (const src of sources) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      prefixes.add(m[1]);
    }
  }
  return prefixes;
}

function writeSortedJson(filePath: string, data: Record<string, string>) {
  const sorted: Record<string, string> = {};
  Object.keys(data)
    .sort()
    .forEach((key) => {
      sorted[key] = data[key];
    });
  fs.writeFileSync(filePath, JSON.stringify(sorted, null, 2) + '\n', 'utf-8');
}

// --- Main logic ---

if (!fs.existsSync(EN_JSON_PATH)) {
  console.error('❌ en-US.json not found');
  process.exit(1);
}

const enJson: Record<string, string> = JSON.parse(fs.readFileSync(EN_JSON_PATH, 'utf-8'));
const sourceFiles = walkDir(SRC_DIR, ['.ts', '.tsx']);
const scriptFiles = walkDir(path.join(ROOT, 'scripts'), ['.ts'])
  .filter((f) => !EXCLUDED_SCRIPTS.has(path.basename(f)));

const allSources = [...sourceFiles, ...scriptFiles].map((f) => fs.readFileSync(f, 'utf-8'));

const usedKeys = new Set<string>();
allSources.forEach((src) => extractKeysFromSource(src).forEach((k) => usedKeys.add(k)));

// Auto-detect dynamic key prefixes (e.g. t(`prefix.${var}`) → 'prefix.')
const dynamicPrefixes = extractDynamicPrefixes(allSources);

// Process en-US.json.
const cleanedEnJson: Record<string, string> = {};
let removedFromEnCount = 0;

for (const key of Object.keys(enJson)) {
  const isUsed = usedKeys.has(key);
  const isDynamic = [...dynamicPrefixes].some((p) => key.startsWith(p));
  if (isUsed || isDynamic) {
    cleanedEnJson[key] = enJson[key];
  } else {
    removedFromEnCount++;
  }
}

writeSortedJson(EN_JSON_PATH, cleanedEnJson);
console.log(`✅ en-US.json synced (removed ${removedFromEnCount} unused keys)`);

// Process other locale files (e.g. zh-TW.json).
const otherJsons = fs.readdirSync(LANG_DIR).filter(f => f.endsWith('.json') && f !== 'en-US.json');
let hasMissingKeys = false;

for (const fileName of otherJsons) {
  const filePath = path.join(LANG_DIR, fileName);
  const targetJson: Record<string, string> = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const cleanedTargetJson: Record<string, string> = {};
  const missingKeys: string[] = [];
  let removedCount = 0;

  // Strictly align keys with en-US.json.
  for (const key of Object.keys(cleanedEnJson)) {
    if (key in targetJson) {
      cleanedTargetJson[key] = targetJson[key];
    } else {
      missingKeys.push(key);
    }
  }

  // Count discarded keys.
  removedCount = Object.keys(targetJson).length - Object.keys(cleanedTargetJson).length;

  writeSortedJson(filePath, cleanedTargetJson);
  console.log(`✅ ${fileName} synced (removed ${removedCount} stale keys)`);

  if (missingKeys.length > 0) {
    hasMissingKeys = true;
    console.error(`❌ ${fileName} is missing ${missingKeys.length} required keys:`);
    for (const key of missingKeys) {
      console.error(`   - ${key}`);
    }
  }
}

if (hasMissingKeys) {
  console.error('\n❌ i18n check failed: some locales are missing required keys. Please add them and retry.');
  process.exit(1);
}

console.log('\n✨ i18n static check and cleanup complete.');
