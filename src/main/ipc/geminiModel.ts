import { ipcMain } from 'electron';
import { IPC, PROVIDER_URLS } from '../../shared/types';
import type { GeminiModelChoice, GeminiModelState } from '../../shared/geminiModels';
import { config } from '../config';
import { sendLog } from '../helpers';
import { llmLane } from '../flow/lanes';
import { ensureWorkerWindow, getWorkerWin } from '../windows';
import {
  getGeminiModelState,
  refreshGeminiModels,
  setGeminiModelChoice,
  syncGeminiModelIfParked,
} from '../providers/geminiModelSync';

export function registerGeminiModelHandlers(): void {
  ipcMain.handle(IPC.GEMINI_MODEL_GET, (): GeminiModelState => getGeminiModelState());

  ipcMain.handle(IPC.GEMINI_MODEL_SET, (_event, patch: Partial<GeminiModelChoice> | undefined): GeminiModelState => {
    const state = setGeminiModelChoice(patch ?? {});
    // Behind the lane, like every other touch of the worker: never under a running automation.
    void llmLane.runExclusive(() => syncGeminiModelIfParked(getWorkerWin()));
    return state;
  });

  // Only a first run with nothing cached pays for this; afterwards every Gemini send refreshes
  // the list on its way through, for free.
  ipcMain.handle(IPC.GEMINI_MODEL_REFRESH, async (): Promise<GeminiModelState> => {
    // Someone who hid Gemini has no menu to fill, and should not have it loaded behind their back.
    if (config.geminiModelCatalog || config.hiddenProviders.includes('gemini')) return getGeminiModelState();
    await llmLane.runExclusive(async () => {
      if (config.geminiModelCatalog) return;
      try {
        const worker = await ensureWorkerWindow(PROVIDER_URLS.gemini);
        if (worker) await refreshGeminiModels(worker);
      } catch (err) {
        sendLog(`⚠️ Could not read Gemini's model list: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
    return getGeminiModelState();
  });
}
