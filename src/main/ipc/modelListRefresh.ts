import type { BrowserWindow } from 'electron';
import { PROVIDER_LABELS, PROVIDER_URLS } from '../../shared/types';
import { isModelCatalogStale } from '../../shared/modelCatalogFreshness';
import { config } from '../config';
import { sendLog } from '../helpers';
import { llmLane } from '../flow/lanes';
import { ensureWorkerWindow, isWorkerRevealed } from '../windows';
import { getAccountStatus } from '../providers/authStatus';

type ModelListProvider = 'gemini' | 'claude' | 'chatgpt';

export interface ModelListSource {
  provider: ModelListProvider;
  /** The cached list as it is now; read again inside the lane, where another refresh may have filled it. */
  catalog: () => { updatedAt: string } | null;
  /** Reads the page the worker was just sent to into the cache. */
  refresh: (worker: BrowserWindow) => Promise<void>;
  /**
   * Skip when the account is signed out. Claude's signed-out page is the login page and ChatGPT's
   * shows controls that belong to no plan; signed-out Gemini still has a menu worth reading.
   */
  requireSignIn: boolean;
}

/**
 * Reads a provider's model list into the cache when it is missing or stale (or `force`). Someone
 * who hid the provider has no menu to fill, and should not have it loaded behind their back. The
 * sign-in check is asked once, before waiting for the lane.
 */
export async function refreshModelList(source: ModelListSource, force: boolean): Promise<void> {
  const { provider, catalog, refresh, requireSignIn } = source;
  if (config.hiddenProviders.includes(provider)) return;
  if (!force && !isModelCatalogStale(catalog())) return;
  if (requireSignIn && !(await getAccountStatus(provider))) return;
  await llmLane.runExclusive(async () => {
    if (!force && !isModelCatalogStale(catalog())) return;
    // The worker is on screen for a sign-in or a challenge: navigating it would pull the page out
    // from under the user. Only a read nobody asked for waits; the next check retries.
    if (!force && isWorkerRevealed()) return;
    try {
      const worker = await ensureWorkerWindow(PROVIDER_URLS[provider]);
      if (worker) await refresh(worker);
    } catch (err) {
      sendLog(`⚠️ Could not read ${PROVIDER_LABELS[provider]}'s model list: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}
