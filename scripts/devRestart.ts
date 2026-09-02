import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Touching this file asks a running `npm run dev` to restart Electron, which is the
 * only way a src/main or src/preload change takes effect. It sits under node_modules
 * so it never reaches git, a build, or a public release.
 */
export const RESTART_SENTINEL = 'node_modules/.yobi-dev-restart';

/** Source trees whose changes require an Electron restart rather than an HMR update. */
export const RESTART_SOURCES = ['src/main', 'src/preload', 'src/shared'] as const;

/** Bundles the restarted Electron process actually loads. */
export const RESTART_OUTPUTS = ['out/main/index.js', 'out/preload/index.js'] as const;

/** Newest mtime anywhere under `target`, or 0 when it does not exist. */
export function newestMtimeMs(target: string): number {
  let newest = 0;
  const visit = (entry: string): void => {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(entry);
    } catch {
      return;
    }
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(entry)) visit(path.join(entry, child));
      return;
    }
    if (stat.mtimeMs > newest) newest = stat.mtimeMs;
  };
  visit(target);
  return newest;
}

/**
 * Whether every bundle in `outputs` is at least as new as everything in `sources`.
 * The watch build writes those bundles asynchronously, so a restart fired the moment a
 * file is saved would relaunch Electron on the previous bundle — and look exactly like
 * a successful restart. The trigger waits for this to hold instead of guessing a delay.
 */
export function isBuildCurrent(
  sources: readonly string[] = RESTART_SOURCES,
  outputs: readonly string[] = RESTART_OUTPUTS,
): boolean {
  const oldestOutput = Math.min(...outputs.map(newestMtimeMs));
  if (!Number.isFinite(oldestOutput) || oldestOutput === 0) return false;
  return oldestOutput >= Math.max(0, ...sources.map(newestMtimeMs));
}
