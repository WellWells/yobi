import { ipcMain } from 'electron';
import { IPC } from '../../shared/types';
import { WRITING_TEXT_MAX_CHARS, parseWritingToolsRequest } from '../../shared/writingTools';
import type { WritingToolsProgress, WritingToolsResult } from '../../shared/writingTools';
import { runWritingTools } from '../chat/writingTools';
import { oneShotIo, quickActionModelUrl, rememberQuickActionModel } from '../chat/oneShotRequest';
import { sendLog, sendToRenderer } from '../helpers';

/** One request at a time: a new one replaces the one before it, which is dropped. */
let running: { id: string; controller: AbortController } | null = null;

function sendProgress(progress: WritingToolsProgress): void {
  sendToRenderer(IPC.WRITING_TOOLS_PROGRESS, progress);
}

export async function handleWritingToolsRun(raw: unknown): Promise<WritingToolsResult> {
  // Too long is its own answer, not a malformed request: the user is told to select less.
  const rawText = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).text : undefined;
  if (typeof rawText === 'string' && rawText.length > WRITING_TEXT_MAX_CHARS) return { ok: false, reason: 'tooLong' };
  const request = parseWritingToolsRequest(raw);
  if (!request) return { ok: false, reason: 'invalid' };
  rememberQuickActionModel(request.providerUrl);

  running?.controller.abort();
  const controller = new AbortController();
  running = { id: request.id, controller };
  sendLog(`✍️ [Writing tools] ${request.action} on ${request.text.length} chars`);

  try {
    const io = oneShotIo(controller.signal, (phase) => sendProgress({ id: request.id, phase }));
    const result = await runWritingTools(request, io);
    if (!result.ok && result.reason === 'failed') sendLog(`⚠️ [Writing tools] failed: ${result.error ?? ''}`);
    return result;
  } finally {
    if (running?.controller === controller) running = null;
  }
}

export function registerWritingToolsHandlers(): void {
  ipcMain.handle(IPC.WRITING_TOOLS_GET_MODEL, (): string => quickActionModelUrl());
  ipcMain.handle(IPC.WRITING_TOOLS_RUN, (_event, request: unknown) => handleWritingToolsRun(request));
  ipcMain.handle(IPC.WRITING_TOOLS_CANCEL, (_event, id: unknown): boolean => {
    if (!running || running.id !== id) return false;
    running.controller.abort();
    return true;
  });
}
