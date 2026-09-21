import { app } from 'electron';
import { mkdtempSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Split out of config.ts so modules that only need the directory (secretHealth,
 * the token stores) can import it without pulling config.ts back in as a cycle.
 * config.ts re-exports it, so external import paths are unchanged.
 */

let testConfigDir: string | null = null;

/**
 * In dev the config directory IS the repo root, and Vitest runs from there with an
 * `isPackaged: false` stand-in for `app` — so every test that imported config.ts opened the
 * developer's own config.json, and `importConfigFromJson` ends in `saveConfig`, which rewrote
 * it from a four-line fixture: Telegram switched off, paired users dropped, bot token blanked.
 * One directory per worker process, so the stores that share it still agree with each other.
 */
function getTestConfigDir(): string {
  testConfigDir ??= mkdtempSync(path.join(os.tmpdir(), 'yobi-test-config-'));
  return testConfigDir;
}

export function getConfigDir(): string {
  if (app.isPackaged) return app.getPath('userData');
  if (process.env.VITEST) return getTestConfigDir();
  return path.resolve('.');
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json');
}
