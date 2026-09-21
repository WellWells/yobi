import { ipcMain } from 'electron';
import { IPC, PROVIDER_URLS } from '../../shared/types';
import type { ChatgptModelChoice, ChatgptModelState } from '../../shared/chatgptModels';
import { config } from '../config';
import { sendLog } from '../helpers';
import { llmLane } from '../flow/lanes';
import { ensureWorkerWindow, getWorkerWin } from '../windows';
import { getAccountStatus } from '../providers/authStatus';
import {
  getChatgptModelState,
  refreshChatgptModels,
  setChatgptModelChoice,
  syncChatgptModelIfParked,
} from '../providers/chatgptModelSync';

/**
 * Reads the signed-in account's controls into the cache. Skipped for anyone who hid ChatGPT or is
 * not signed in: the signed-out page has controls of its own that belong to no plan.
 */
export async function refreshChatgptModelList(force = false): Promise<void> {
  if (config.hiddenProviders.includes('chatgpt')) return;
  if (!force && config.chatgptModelCatalog) return;
  if (!(await getAccountStatus('chatgpt'))) return;
  await llmLane.runExclusive(async () => {
    if (!force && config.chatgptModelCatalog) return;
    try {
      const worker = await ensureWorkerWindow(PROVIDER_URLS.chatgpt);
      if (worker) await refreshChatgptModels(worker);
    } catch (err) {
      sendLog(`⚠️ Could not read ChatGPT's model list: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}

export function registerChatgptModelHandlers(): void {
  ipcMain.handle(IPC.CHATGPT_MODEL_GET, (): ChatgptModelState => getChatgptModelState());

  ipcMain.handle(IPC.CHATGPT_MODEL_SET, (_event, patch: Partial<ChatgptModelChoice> | undefined): ChatgptModelState => {
    const state = setChatgptModelChoice(patch ?? {});
    // Behind the lane, like every other touch of the worker: never under a running automation.
    // Signed out, the page parked there is not this account's and is left alone.
    void llmLane.runExclusive(async () => {
      if (await getAccountStatus('chatgpt')) await syncChatgptModelIfParked(getWorkerWin());
    });
    return state;
  });

  // Only a first run with nothing cached pays for this; afterwards every ChatGPT send refreshes the
  // list on its way through, and signing in refreshes it again (see accounts.ts).
  ipcMain.handle(IPC.CHATGPT_MODEL_REFRESH, async (): Promise<ChatgptModelState> => {
    await refreshChatgptModelList();
    return getChatgptModelState();
  });
}
