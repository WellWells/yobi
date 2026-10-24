import { ipcMain } from 'electron';
import { IPC } from '../../shared/types';
import type { PttBoardChoice, PttBoardPreviewResult } from '../../shared/pttBoard';
import { getLangCache } from '../i18n';
import { sendLog } from '../helpers';
import { pttService, type PttService } from '../ptt/pttService';
import { previewPttBoard } from '../ptt/pttBoardPreview';
import { createPreviewSlots } from './previewSlots';

const slots = createPreviewSlots();

const MAX_QUERY_CHARS = 100;

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** The boards matching what is typed in the step's board field, best match first. */
export async function handleFindBoards(query: unknown, service: PttService = pttService()): Promise<PttBoardChoice[]> {
  const typed = text(query).trim().slice(0, MAX_QUERY_CHARS);
  if (!typed) return [];
  try {
    return (await service.findBoards(typed)).map(({ board, cls, title }) => ({ board, cls, title }));
  } catch (err) {
    sendLog(`📰 [Flow] PTT board search failed for "${typed}": ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

export async function handlePttPreview(
  event: unknown,
  raw: unknown,
  service: PttService = pttService(),
): Promise<PttBoardPreviewResult> {
  const request = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const config = {
    board: text(request.board),
    keyword: text(request.keyword),
    scoreMode: text(request.scoreMode),
    score: text(request.score),
  };
  return slots.run(event, request.slot, (signal) => previewPttBoard(config, signal, getLangCache(), service));
}

export function registerPttBoardHandlers(): void {
  ipcMain.handle(IPC.PTT_FIND_BOARDS, (_event, query: unknown) => handleFindBoards(query));
  ipcMain.handle(IPC.PTT_PREVIEW_BOARD, (event, request: unknown) => handlePttPreview(event, request));
  ipcMain.handle(IPC.PTT_CANCEL_PREVIEW, (event, slot: unknown) => {
    slots.cancel(event, slot);
    return true;
  });
}
