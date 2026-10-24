import { ipcMain } from 'electron';
import { IPC } from '../../shared/types';
import type { FeedPreviewResult } from '../../shared/feedPreview';
import { previewFeed } from '../feedPreview';
import { getLangCache } from '../i18n';
import { createPreviewSlots } from './previewSlots';

const slots = createPreviewSlots();

export async function handleFeedPreview(event: unknown, raw: unknown): Promise<FeedPreviewResult> {
  const request = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const url = typeof request.url === 'string' ? request.url : '';
  return slots.run(event, request.slot, (signal) => previewFeed(url, signal, getLangCache()));
}

export function registerFeedPreviewHandlers(): void {
  ipcMain.handle(IPC.RSS_PREVIEW_FEED, (event, request: unknown) => handleFeedPreview(event, request));
  ipcMain.handle(IPC.RSS_CANCEL_PREVIEW, (event, slot: unknown) => {
    slots.cancel(event, slot);
    return true;
  });
}
