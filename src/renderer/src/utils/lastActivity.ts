import type { OutputFile } from '../../../shared/types';

/** Mirrors the newest conversation time, so the first paint knows it before the list loads. */
const LAST_ACTIVITY_KEY = 'yobi-last-activity';

export function latestActivityAt(files: readonly Pick<OutputFile, 'timestamp'>[]): number | null {
  let latest: number | null = null;
  for (const { timestamp } of files) {
    const at = timestamp ? Date.parse(timestamp) : Number.NaN;
    if (Number.isFinite(at) && (latest === null || at > latest)) latest = at;
  }
  return latest;
}

export function rememberLastActivity(files: readonly Pick<OutputFile, 'timestamp'>[]): void {
  try {
    const latest = latestActivityAt(files);
    if (latest === null) localStorage.removeItem(LAST_ACTIVITY_KEY);
    else localStorage.setItem(LAST_ACTIVITY_KEY, String(latest));
  } catch {
    // Storage unavailable: the greeting just never says welcome back.
  }
}

export function readLastActivity(): number | null {
  try {
    const at = Number(localStorage.getItem(LAST_ACTIVITY_KEY) ?? Number.NaN);
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}
