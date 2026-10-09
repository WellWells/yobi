import { config } from './config';
import { llmLane } from './flow/lanes';
import { isWorkerRevealed } from './windows';
import { isModelCatalogStale } from '../shared/modelCatalogFreshness';
import { refreshGeminiModelList } from './ipc/geminiModel';
import { refreshClaudeModelList } from './ipc/claudeModel';
import { refreshChatgptModelList } from './ipc/chatgptModel';

/**
 * Re-reads cached model lists for providers nobody has sent to lately (a send refreshes only its
 * own provider's list). Runs on the shared worker window, so it yields: starts a few minutes after
 * launch, steps aside while `llmLane` is busy or the worker is on screen, and backs off from a
 * provider whose read keeps failing.
 */
const FIRST_CHECK_MS = 3 * 60_000;
const CHECK_INTERVAL_MS = 60 * 60_000;
const MAX_BACKOFF_MS = 24 * 60 * 60_000;

interface Source {
  provider: 'gemini' | 'claude' | 'chatgpt';
  catalog: () => { updatedAt: string } | null;
  refresh: () => Promise<void>;
}

const SOURCES: readonly Source[] = [
  { provider: 'gemini', catalog: () => config.geminiModelCatalog, refresh: () => refreshGeminiModelList() },
  { provider: 'claude', catalog: () => config.claudeModelCatalog, refresh: () => refreshClaudeModelList() },
  { provider: 'chatgpt', catalog: () => config.chatgptModelCatalog, refresh: () => refreshChatgptModelList() },
];

interface Failure {
  count: number;
  at: number;
}

const failures = new Map<Source['provider'], Failure>();

/** One hour after the first failed read, then doubling, at most a day. */
export function backgroundReadDue(failure: Failure | undefined, now: number): boolean {
  if (!failure) return true;
  const wait = Math.min(CHECK_INTERVAL_MS * 2 ** (failure.count - 1), MAX_BACKOFF_MS);
  return now - failure.at >= wait;
}

function stampOf(source: Source): number {
  const at = Date.parse(source.catalog()?.updatedAt ?? '');
  return Number.isFinite(at) ? at : 0;
}

/** Reads every stale list it may, oldest first, one at a time. */
export async function refreshStaleModelCatalogs(now: number = Date.now()): Promise<void> {
  const stale = SOURCES
    .filter((source) => isModelCatalogStale(source.catalog(), now))
    .sort((a, b) => stampOf(a) - stampOf(b));
  for (const source of stale) {
    // Checked before every provider, not once: a send that arrives meanwhile waits behind at
    // most the one read already under way.
    if (llmLane.busy || isWorkerRevealed()) return;
    if (!backgroundReadDue(failures.get(source.provider), now)) continue;
    try {
      await source.refresh();
    } catch {
      // Each refresh logs its own failure; it still counts as one below.
    }
    if (isModelCatalogStale(source.catalog())) {
      failures.set(source.provider, { count: (failures.get(source.provider)?.count ?? 0) + 1, at: now });
    } else {
      failures.delete(source.provider);
    }
  }
}

let started = false;

export function resetModelCatalogRefreshForTests(): void {
  failures.clear();
  started = false;
}

export function startModelCatalogRefresh(): void {
  if (started) return;
  started = true;
  const first = setTimeout(() => {
    void refreshStaleModelCatalogs();
    const timer = setInterval(() => { void refreshStaleModelCatalogs(); }, CHECK_INTERVAL_MS);
    timer.unref?.();
  }, FIRST_CHECK_MS);
  first.unref?.();
}
