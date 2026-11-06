// Checks the native core (win32-x64) that electron-builder's win.extraResources packs: the tracked
// build-native/line.dll. $YOBI_LINE_CORE_DLL replaces it with another build during development.
// `--release` (the packaging scripts) ignores that and accepts only the pinned file, so every
// installer carries the same one.
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { LINE_CORE_PIN as pin } from './lineCorePin';
import { loadNativeCore } from '../src/main/line/nativeLineCore';

const release = process.argv.includes('--release');
const target = path.join(process.cwd(), 'build-native', 'line.dll');

function fail(why: string): never {
  console.error(`native core: ${why}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const override = release ? '' : process.env.YOBI_LINE_CORE_DLL;
  if (override) fs.copyFileSync(override, target);
  if (!fs.existsSync(target)) fail(`${target} is missing`);
  const sha256 = createHash('sha256').update(fs.readFileSync(target)).digest('hex');
  if (release && sha256 !== pin.sha256) fail(`SHA-256 is ${sha256}, expected ${pin.sha256}`);
  if (process.platform === 'win32') await loadNativeCore(target);
  console.log(`native core ready (${sha256.slice(0, 12)})`);
}

main().catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
