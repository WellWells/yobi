import { ipcMain } from 'electron';
import { IPC, PROVIDER_URLS } from '../../shared/types';
import type { GeminiModelChoice, GeminiModelState } from '../../shared/geminiModels';
import { isModelCatalogStale } from '../../shared/modelCatalogFreshness';
import { config } from '../config';
import { sendLog } from '../helpers';
import { llmLane } from '../flow/lanes';
import { ensureWorkerWindow, getWorkerWin, isWorkerRevealed } from '../windows';
import {
  getGeminiModelState,
  refreshGeminiModels,
  setGeminiModelChoice,
  syncGeminiModelIfParked,
} from '../providers/geminiModelSync';

/**
 * Reads Gemini's model list into the cache when it is missing or stale (or `force`). Someone who
 * hid Gemini has no menu to fill, and should not have it loaded behind their back.
 */
export async function refreshGeminiModelList(force = false): Promise<void> {
  if (config.hiddenProviders.includes('gemini')) return;
  if (!force && !isModelCatalogStale(config.geminiModelCatalog)) return;
  await llmLane.runExclusive(async () => {
    if (!force && !isModelCatalogStale(config.geminiModelCatalog)) return;
    // The worker is on screen for a sign-in or a challenge: navigating it would pull the page out
    // from under the user. Only a read nobody asked for waits; the next check retries.
    if (!force && isWorkerRevealed()) return;
    try {
      const worker = await ensureWorkerWindow(PROVIDER_URLS.gemini);
      if (worker) await refreshGeminiModels(worker);
    } catch (err) {
      sendLog(`⚠️ Could not read Gemini's model list: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}

export function registerGeminiModelHandlers(): void {
  ipcMain.handle(IPC.GEMINI_MODEL_GET, (): GeminiModelState => getGeminiModelState());

  ipcMain.handle(IPC.GEMINI_MODEL_SET, (_event, patch: Partial<GeminiModelChoice> | undefined): GeminiModelState => {
    const state = setGeminiModelChoice(patch ?? {});
    // Behind the lane, like every other touch of the worker: never under a running automation.
    void llmLane.runExclusive(() => syncGeminiModelIfParked(getWorkerWin()));
    return state;
  });

  // Reads only a list that is missing or older than MODEL_CATALOG_MAX_AGE_MS: every Gemini send
  // refreshes it on the way through, and the hourly check (modelCatalogRefresh.ts) does the rest.
  ipcMain.handle(IPC.GEMINI_MODEL_REFRESH, async (): Promise<GeminiModelState> => {
    await refreshGeminiModelList();
    return getGeminiModelState();
  });
}
