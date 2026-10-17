import { ipcMain } from 'electron';
import { IPC } from '../../shared/types';
import type { ChatgptModelChoice, ChatgptModelState } from '../../shared/chatgptModels';
import { config } from '../config';
import { llmLane } from '../flow/lanes';
import { getWorkerWin } from '../windows';
import { getAccountStatus } from '../providers/authStatus';
import {
  getChatgptModelState,
  refreshChatgptModels,
  setChatgptModelChoice,
  syncChatgptModelIfParked,
} from '../providers/chatgptModelSync';
import { refreshModelList } from './modelListRefresh';

/** Reads the signed-in account's controls into the cache when they are missing or stale (or `force`). */
export function refreshChatgptModelList(force = false): Promise<void> {
  return refreshModelList(
    { provider: 'chatgpt', catalog: () => config.chatgptModelCatalog, refresh: refreshChatgptModels, requireSignIn: true },
    force,
  );
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

  // Reads only a list that is missing or older than MODEL_CATALOG_MAX_AGE_MS; see claudeModel.ts.
  ipcMain.handle(IPC.CHATGPT_MODEL_REFRESH, async (): Promise<ChatgptModelState> => {
    await refreshChatgptModelList();
    return getChatgptModelState();
  });
}
