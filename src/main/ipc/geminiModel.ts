import { ipcMain } from 'electron';
import { IPC } from '../../shared/types';
import type { GeminiModelChoice, GeminiModelState } from '../../shared/geminiModels';
import { config } from '../config';
import { llmLane } from '../flow/lanes';
import { getWorkerWin } from '../windows';
import {
  getGeminiModelState,
  refreshGeminiModels,
  setGeminiModelChoice,
  syncGeminiModelIfParked,
} from '../providers/geminiModelSync';
import { refreshModelList } from './modelListRefresh';

/** Reads Gemini's model list into the cache when it is missing or stale (or `force`). */
export function refreshGeminiModelList(force = false): Promise<void> {
  return refreshModelList(
    { provider: 'gemini', catalog: () => config.geminiModelCatalog, refresh: refreshGeminiModels, requireSignIn: false },
    force,
  );
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
