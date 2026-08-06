import { ipcMain } from 'electron';
import { IPC } from '../../shared/types';
import type { SearchCommandResult, SearchMode } from '../../shared/types';
import { config } from '../config';
import { loadLanguageData, t } from '../i18n';
import { runSearchCommand } from '../chat/searchCommand';
import type { IpcContext } from './context';

export function registerSearchHandlers(ctx: IpcContext): void {
  ipcMain.handle(IPC.SEARCH_RUN, async (
    _event,
    rawQuery: string,
    targetUrl?: string,
    mode?: SearchMode,
    conversationPath?: string,
    clientToken?: string,
  ): Promise<SearchCommandResult> => {
    const query = (rawQuery ?? '').trim();
    const strings = await loadLanguageData(config.locale) ?? {};
    if (!query) return { success: false, error: t(strings, 'search.error.empty') };

    return runSearchCommand(ctx.flowManager, {
      query,
      strings,
      targetUrl,
      mode,
      conversationPath,
      clientToken,
    });
  });
}
