import { sendLog } from '../helpers';
import { guardedFetch } from '../net/ssrfGuard';
import type { SkillOrigin } from '../../shared/agentSkills';
import { readState, updateState } from './skillStore';
import type { StateFile } from './skillStore';

/*
 * "Is there a newer version?" for skills imported from GitHub. A folder's git tree hash changes
 * exactly when a file in it changes, and one request per repository returns every folder's hash.
 * A check never installs anything: it marks the skill, and the user opens the import preview from
 * there and decides, the same trust gate as the first import.
 */

const CHECK_TIMEOUT_MS = 30_000;
/** The first check waits for start-up to settle; then one a day while the app runs. */
const FIRST_CHECK_DELAY_MS = 5 * 60_000;
const CHECK_INTERVAL_MS = 24 * 60 * 60_000;

/** One repository at one ref: what a single tree request answers for. */
function repoKey(origin: SkillOrigin): string {
  return `${origin.owner}/${origin.repo}@${origin.ref}`;
}

export function githubTreeUrl(origin: SkillOrigin): string {
  const part = (value: string) => encodeURIComponent(value);
  return `https://api.github.com/repos/${part(origin.owner)}/${part(origin.repo)}/git/trees/${origin.ref.split('/').map(part).join('/')}?recursive=1`;
}

/** Every folder's tree hash in one repository, '' keyed to the root. Null when it cannot be read. */
async function fetchTreeHashes(origin: SkillOrigin, fetchImpl: typeof guardedFetch): Promise<Map<string, string> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const res = await fetchImpl(githubTreeUrl(origin), {
      signal: controller.signal,
      headers: { 'User-Agent': 'Yobi', Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) {
      sendLog(`⚠️ [Skills] update check for ${repoKey(origin)}: HTTP ${res.status}`);
      return null;
    }
    const body = (await res.json()) as { sha?: unknown; tree?: unknown };
    const hashes = new Map<string, string>();
    if (typeof body.sha === 'string') hashes.set('', body.sha);
    for (const entry of Array.isArray(body.tree) ? body.tree : []) {
      const item = entry as { path?: unknown; type?: unknown; sha?: unknown };
      if (item.type === 'tree' && typeof item.path === 'string' && typeof item.sha === 'string') hashes.set(item.path, item.sha);
    }
    return hashes;
  } catch (err) {
    sendLog(`⚠️ [Skills] update check for ${repoKey(origin)} failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Applies what the check saw. A skill with no baseline takes the hash as it (the check right after
 * an install); one with a baseline records the latest, and the two differing is "update available".
 */
export function applyTreeHashes(state: StateFile, seen: ReadonlyMap<string, ReadonlyMap<string, string>>): string[] {
  const changed: string[] = [];
  for (const [name, entry] of Object.entries(state)) {
    if (!entry.origin) continue;
    const hash = seen.get(repoKey(entry.origin))?.get(entry.origin.path);
    if (!hash) continue;
    if (!entry.tree) {
      entry.tree = hash;
      entry.latest = hash;
      continue;
    }
    if (entry.latest !== hash && hash !== entry.tree) changed.push(name);
    entry.latest = hash;
  }
  return changed;
}

/** Checks every GitHub-imported skill; resolves the names that just turned "update available". */
export async function checkSkillUpdates(fetchImpl: typeof guardedFetch = guardedFetch): Promise<string[]> {
  const state = await readState();
  const repos = new Map<string, SkillOrigin>();
  for (const entry of Object.values(state)) {
    if (entry.origin) repos.set(repoKey(entry.origin), entry.origin);
  }
  if (repos.size === 0) return [];
  const seen = new Map<string, Map<string, string>>();
  for (const [key, origin] of repos) {
    const hashes = await fetchTreeHashes(origin, fetchImpl);
    if (hashes) seen.set(key, hashes);
  }
  if (seen.size === 0) return [];
  let changed: string[] = [];
  await updateState((current) => {
    changed = applyTreeHashes(current, seen);
  });
  if (changed.length > 0) sendLog(`🧩 [Skills] newer version at the source: ${changed.join(', ')}`);
  return changed;
}

let scheduled: ReturnType<typeof setTimeout> | null = null;

/** Starts the daily check; `onChange` hears when a skill turned "update available". */
export function scheduleSkillUpdateChecks(onChange: () => void): void {
  if (scheduled) return;
  const run = (): void => {
    void checkSkillUpdates()
      .then((changed) => { if (changed.length > 0) onChange(); })
      .catch(() => undefined)
      .finally(() => { scheduled = setTimeout(run, CHECK_INTERVAL_MS); });
  };
  scheduled = setTimeout(run, FIRST_CHECK_DELAY_MS);
}
