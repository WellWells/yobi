import { ipcMain } from 'electron';
import { IPC } from '../../shared/types';
import { DOC_ASSISTANT_DOCUMENT_MAX_CHARS, parseDocAssistantRequest } from '../../shared/docAssistant';
import type { DocAssistantProgress, DocAssistantResult } from '../../shared/docAssistant';
import { runDocAssistant } from '../chat/docAssistant';
import { oneShotIo, rememberQuickActionModel } from '../chat/oneShotRequest';
import { sendLog, sendToRenderer } from '../helpers';

/** One request at a time, apart from rewriting and translation: a new one replaces the one before it. */
let running: { id: string; controller: AbortController } | null = null;

function sendProgress(progress: DocAssistantProgress): void {
  sendToRenderer(IPC.DOC_ASSISTANT_PROGRESS, progress);
}

export async function handleDocAssistantRun(raw: unknown): Promise<DocAssistantResult> {
  const document = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).document : undefined;
  if (typeof document === 'string' && document.length > DOC_ASSISTANT_DOCUMENT_MAX_CHARS) return { ok: false, reason: 'tooLong' };
  const request = parseDocAssistantRequest(raw);
  if (!request) return { ok: false, reason: 'invalid' };
  rememberQuickActionModel(request.providerUrl);

  running?.controller.abort();
  const controller = new AbortController();
  running = { id: request.id, controller };
  sendLog(`📝 [Doc assistant] ${request.retry ? `retry (${request.retry.problems.length} problems)` : 'turn'} on ${request.document.length} chars`);

  try {
    const io = oneShotIo(controller.signal, (phase) => sendProgress({ id: request.id, phase }));
    const result = await runDocAssistant(request, io);
    if (!result.ok && result.reason === 'failed') sendLog(`⚠️ [Doc assistant] failed: ${result.error ?? ''}`);
    return result;
  } finally {
    if (running?.controller === controller) running = null;
  }
}

export function registerDocAssistantHandlers(): void {
  ipcMain.handle(IPC.DOC_ASSISTANT_RUN, (_event, request: unknown) => handleDocAssistantRun(request));
  ipcMain.handle(IPC.DOC_ASSISTANT_CANCEL, (_event, id: unknown): boolean => {
    if (!running || running.id !== id) return false;
    running.controller.abort();
    return true;
  });
}
