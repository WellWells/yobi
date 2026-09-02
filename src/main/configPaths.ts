import { app } from 'electron';
import * as path from 'node:path';

/**
 * Split out of config.ts so modules that only need the directory (secretHealth,
 * the token stores) can import it without pulling config.ts back in as a cycle.
 * config.ts re-exports it, so external import paths are unchanged.
 */
export function getConfigDir(): string {
  if (app.isPackaged) return app.getPath('userData');
  return path.resolve('.');
}

export function getConfigPath(): string {
  return path.join(getConfigDir(), 'config.json');
}
