import { ipcMain } from 'electron';
import { IPC, PROVIDER_URLS } from '../../shared/types';
import { claudeOptionsUnknown } from '../../shared/claudeModels';
import type { ClaudeModelChoice, ClaudeModelState } from '../../shared/claudeModels';
import { config } from '../config';
import { sendLog } from '../helpers';
import { llmLane } from '../flow/lanes';
import { ensureWorkerWindow, getWorkerWin } from '../windows';
import { getAccountStatus } from '../providers/authStatus';
import {
  getClaudeModelState,
  refreshClaudeModels,
  setClaudeModelChoice,
  syncClaudeModelIfParked,
} from '../providers/claudeModelSync';

/**
 * Reads the signed-in account's model list into the cache. Skipped for anyone who hid Claude or is
 * not signed in: loading it would only land on the login page.
 */
export async function refreshClaudeModelList(force = false): Promise<void> {
  if (config.hiddenProviders.includes('claude')) return;
  if (!force && config.claudeModelCatalog) return;
  if (!(await getAccountStatus('claude'))) return;
  await llmLane.runExclusive(async () => {
    if (!force && config.claudeModelCatalog) return;
    try {
      const worker = await ensureWorkerWindow(PROVIDER_URLS.claude);
      if (worker) await refreshClaudeModels(worker);
    } catch (err) {
      sendLog(`⚠️ Could not read Claude's model list: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}

export function registerClaudeModelHandlers(): void {
  ipcMain.handle(IPC.CLAUDE_MODEL_GET, (): ClaudeModelState => getClaudeModelState());

  ipcMain.handle(IPC.CLAUDE_MODEL_SET, (_event, patch: Partial<ClaudeModelChoice> | undefined): ClaudeModelState => {
    const state = setClaudeModelChoice(patch ?? {});
    // A model the page has never had selected has unknown options, so the composer cannot offer
    // its thinking control until they are read. That is worth loading Claude for, once per model:
    // afterwards they are cached with the rest of the list.
    if (claudeOptionsUnknown(state)) {
      void refreshClaudeModelList(true);
      return state;
    }
    // Behind the lane, like every other touch of the worker: never under a running automation.
    void llmLane.runExclusive(() => syncClaudeModelIfParked(getWorkerWin()));
    return state;
  });

  // Only a first run with nothing cached pays for this; afterwards every Claude send refreshes the
  // list on its way through, and signing in refreshes it again (see accounts.ts).
  ipcMain.handle(IPC.CLAUDE_MODEL_REFRESH, async (): Promise<ClaudeModelState> => {
    await refreshClaudeModelList();
    return getClaudeModelState();
  });
}
