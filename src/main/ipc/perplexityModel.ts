import { ipcMain } from 'electron';
import { IPC } from '../../shared/types';
import type { PerplexityModelChoice, PerplexityModelState } from '../../shared/perplexityModels';
import { config } from '../config';
import { llmLane } from '../flow/lanes';
import { getWorkerWin } from '../windows';
import { getAccountStatus } from '../providers/authStatus';
import {
  clearPerplexityModels,
  getPerplexityModelState,
  refreshPerplexityModels,
  setPerplexityModelChoice,
  syncPerplexityModelIfParked,
} from '../providers/perplexityModelSync';
import { refreshModelList } from './modelListRefresh';

/**
 * Reads the signed-in account's model menu into the cache when it is missing or stale (or
 * `force`). A visitor has no model to choose, so nothing is loaded for one.
 */
export async function refreshPerplexityModelList(force = false): Promise<void> {
  // A list kept from a signed-in session belongs to an account that is no longer there.
  if (!(await getAccountStatus('perplexity'))) {
    clearPerplexityModels();
    return;
  }
  return refreshModelList(
    {
      provider: 'perplexity',
      catalog: () => config.perplexityModelCatalog,
      refresh: (worker) => refreshPerplexityModels(worker, force),
      requireSignIn: true,
    },
    force,
  );
}

export function registerPerplexityModelHandlers(): void {
  ipcMain.handle(IPC.PERPLEXITY_MODEL_GET, (): PerplexityModelState => getPerplexityModelState());

  ipcMain.handle(IPC.PERPLEXITY_MODEL_SET, (_event, patch: Partial<PerplexityModelChoice> | undefined): PerplexityModelState => {
    const state = setPerplexityModelChoice(patch ?? {});
    // Behind the lane, like every other touch of the worker: never under a running automation.
    void llmLane.runExclusive(() => syncPerplexityModelIfParked(getWorkerWin()));
    return state;
  });

  // Reads only a list that is missing or older than MODEL_CATALOG_MAX_AGE_MS: every signed-in
  // Perplexity send refreshes it on the way through, and the hourly check does the rest.
  ipcMain.handle(IPC.PERPLEXITY_MODEL_REFRESH, async (): Promise<PerplexityModelState> => {
    await refreshPerplexityModelList();
    return getPerplexityModelState();
  });
}
