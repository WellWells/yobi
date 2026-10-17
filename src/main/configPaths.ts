import { app } from 'electron';
import { mkdtempSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** Kept apart from config.ts so modules that only need the directory can import it without a cycle. */

let testConfigDir: string | null = null;

/**
 * In dev the config directory is the repo root, so tests get a temp directory instead, or they
 * would overwrite the developer's own config.json. One per module instance, so
 * the stores that share it still agree with each other.
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
