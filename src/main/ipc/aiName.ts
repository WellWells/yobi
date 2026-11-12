import * as fs from 'node:fs/promises';
import { ipcMain } from 'electron';
import { IPC } from '../../shared/types';
import { parseAiNameRequest } from '../../shared/aiName';
import type { AiNameResult } from '../../shared/aiName';
import { suggestAiName } from '../aiName';
import type { AiNameDeps } from '../aiName';
import { oneShotIo, rememberQuickActionModel } from '../chat/oneShotRequest';
import { loadMarkdownHeadingAliases } from '../files';
import { sendLog } from '../helpers';
import { getLangCache, localizeUserFacingError, t } from '../i18n';
import { isAllowedFilePath } from './context';
import { config } from '../config';

/** One name at a time: a new request (another box, another model) drops the one before it. */
let running: { id: string; controller: AbortController } | null = null;

/** Only a markdown file in the outputs folder is read: the box names a conversation or a document there. */
async function readOutputMarkdown(filePath: string): Promise<string | null> {
  if (!/\.md$/i.test(filePath) || !await isAllowedFilePath(filePath)) return null;
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

export async function handleAiNameSuggest(raw: unknown): Promise<AiNameResult> {
  const strings = getLangCache();
  const request = parseAiNameRequest(raw);
  if (!request) return { ok: false, reason: 'failed', error: t(strings, 'aiName.error.empty') };
  rememberQuickActionModel(request.providerUrl);

  running?.controller.abort();
  const controller = new AbortController();
  running = { id: request.id, controller };
  const deps: AiNameDeps = {
    readFile: readOutputMarkdown,
    aliases: loadMarkdownHeadingAliases,
    emptyReply: t(strings, 'aiName.error.empty'),
    noMaterial: t(strings, 'aiName.error.noMaterial'),
    locale: config.locale,
  };
  sendLog(`🏷️ [AI name] naming a ${request.source.kind}`);
  try {
    const result = await suggestAiName(request, oneShotIo(controller.signal, () => undefined), deps);
    if (result.ok || result.reason !== 'failed') return result;
    sendLog(`⚠️ [AI name] no name: ${result.error}`);
    return { ok: false, reason: 'failed', error: localizeUserFacingError(result.error, strings) };
  } finally {
    if (running?.controller === controller) running = null;
  }
}

export function registerAiNameHandlers(): void {
  ipcMain.handle(IPC.AI_NAME_SUGGEST, (_event, request: unknown) => handleAiNameSuggest(request));
  ipcMain.handle(IPC.AI_NAME_CANCEL, (_event, id: unknown): boolean => {
    if (!running || running.id !== id) return false;
    running.controller.abort();
    return true;
  });
}
