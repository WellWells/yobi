import { ipcMain } from 'electron';
import * as path from 'node:path';
import { IPC } from '../../shared/types';
import type {
  NotionBrowseResult,
  NotionDocStatus,
  NotionImportResult,
  NotionPullResult,
  NotionPushResult,
  NotionSearchResult,
} from '../../shared/notion/notionSyncTypes';
import { listOutputFiles } from '../files';
import { sendLog, sendToRenderer } from '../helpers';
import { findNotionServer, notionApiFor } from '../notion/notionClient';
import { browseNotionPages, importNotionPage, searchNotionPages } from '../notion/notionImport';
import {
  configureNotionSync,
  notionDocStatus,
  pullNotionDoc,
  pushNotionDoc,
  resolveNotionConflict,
  revertNotionChange,
} from '../notion/notionSync';
import { isAllowedFilePath } from './context';

/** At most this many changes in one push; the preview never lists more than a page has blocks. */
const MAX_PUSH_IDS = 500;
const MAX_QUERY_CHARS = 2_000;

/**
 * `title` is the H1 the preview showed (null: leave the title alone). Main sends it only if the
 * file still says exactly that, so a title typed after the preview is never sent unseen.
 */
export function parsePushRequest(filePath: unknown, ids: unknown, title: unknown): { filePath: string; ids: string[]; title: string | null } | null {
  if (typeof filePath !== 'string' || !filePath) return null;
  if (!Array.isArray(ids) || ids.length > MAX_PUSH_IDS || !ids.every((id) => typeof id === 'string' && id.length <= 200)) return null;
  if (title !== null && (typeof title !== 'string' || title.length > MAX_QUERY_CHARS)) return null;
  return { filePath, ids, title };
}

/** No cursor (null) asks for the first stretch; a cursor is whatever Notion handed back, kept short. */
export function parseBrowseCursor(cursor: unknown): { cursor?: string } | null {
  if (cursor === null || cursor === undefined) return {};
  if (typeof cursor !== 'string' || !cursor || cursor.length > 200) return null;
  return { cursor };
}

export function parseResolveRequest(filePath: unknown, key: unknown, choice: unknown): { filePath: string; key: string; choice: 'mine' | 'theirs' } | null {
  if (typeof filePath !== 'string' || !filePath) return null;
  if (typeof key !== 'string' || !key || key.length > 200) return null;
  if (choice !== 'mine' && choice !== 'theirs') return null;
  return { filePath, key, choice };
}

async function broadcastFiles(): Promise<void> {
  sendToRenderer(IPC.FILE_LIST, await listOutputFiles());
}

/**
 * Notion documents: search and import from the sidebar, and the document view's sync. Every write
 * to Notion goes through NOTION_PUSH, which takes only the ids of changes main computes itself, so
 * the renderer can confirm what is sent but never say what it is.
 */
export function registerNotionHandlers(): void {
  configureNotionSync({ apiFor: notionApiFor });

  ipcMain.handle(IPC.NOTION_CONNECTED, (): boolean => findNotionServer() !== null);

  ipcMain.handle(IPC.NOTION_SEARCH, async (_event, query: unknown): Promise<NotionSearchResult> => {
    if (typeof query !== 'string' || query.length > MAX_QUERY_CHARS) return { ok: false, reason: 'invalid' };
    return searchNotionPages(query).catch((): NotionSearchResult => ({ ok: false, reason: 'failed' }));
  });

  ipcMain.handle(IPC.NOTION_BROWSE, async (_event, cursor: unknown): Promise<NotionBrowseResult> => {
    const request = parseBrowseCursor(cursor);
    if (!request) return { ok: false, reason: 'invalid' };
    return browseNotionPages(request.cursor).catch((): NotionBrowseResult => ({ ok: false, reason: 'failed' }));
  });

  ipcMain.handle(IPC.NOTION_IMPORT, async (_event, input: unknown): Promise<NotionImportResult> => {
    if (typeof input !== 'string' || input.length > MAX_QUERY_CHARS) return { ok: false, reason: 'invalid' };
    try {
      const result = await importNotionPage(input);
      if (result.ok && !result.existing) {
        sendLog(`📥 Imported a Notion page as ${path.basename(result.path)}`);
        await broadcastFiles();
      }
      return result;
    } catch (err: unknown) {
      sendLog(`⚠️ Could not import the Notion page: ${err instanceof Error ? err.message : String(err)}`);
      return { ok: false, reason: 'failed' };
    }
  });

  ipcMain.handle(IPC.NOTION_STATUS, async (_event, filePath: unknown): Promise<NotionDocStatus | null> => {
    if (typeof filePath !== 'string' || !await isAllowedFilePath(filePath)) return null;
    return notionDocStatus(filePath).catch(() => null);
  });

  ipcMain.handle(IPC.NOTION_PULL, async (_event, filePath: unknown): Promise<NotionPullResult> => {
    if (typeof filePath !== 'string' || !await isAllowedFilePath(filePath)) return { ok: false, reason: 'invalid' };
    try {
      const result = await pullNotionDoc(filePath);
      if (result.ok && result.updated + result.conflicts > 0) await broadcastFiles();
      return result;
    } catch (err: unknown) {
      sendLog(`⚠️ Could not read the Notion page: ${err instanceof Error ? err.message : String(err)}`);
      return { ok: false, reason: 'failed' };
    }
  });

  ipcMain.handle(IPC.NOTION_PUSH, async (_event, filePath: unknown, ids: unknown, title: unknown): Promise<NotionPushResult> => {
    const request = parsePushRequest(filePath, ids, title);
    if (!request || !await isAllowedFilePath(request.filePath)) return { ok: false, reason: 'invalid' };
    try {
      const result = await pushNotionDoc(request.filePath, request.ids, request.title);
      if (result.ok) {
        sendLog(`📤 Sent ${result.pushed} change(s) of ${path.basename(request.filePath)} to Notion`);
        await broadcastFiles();
      }
      return result;
    } catch (err: unknown) {
      sendLog(`⚠️ Could not send the changes to Notion: ${err instanceof Error ? err.message : String(err)}`);
      return { ok: false, reason: 'failed' };
    }
  });

  ipcMain.handle(IPC.NOTION_REVERT, async (_event, filePath: unknown, id: unknown): Promise<boolean> => {
    if (typeof filePath !== 'string' || typeof id !== 'string' || id.length > 200 || !await isAllowedFilePath(filePath)) return false;
    const done = await revertNotionChange(filePath, id).catch(() => false);
    if (done) await broadcastFiles();
    return done;
  });

  ipcMain.handle(IPC.NOTION_RESOLVE, async (_event, filePath: unknown, key: unknown, choice: unknown): Promise<boolean> => {
    const request = parseResolveRequest(filePath, key, choice);
    if (!request || !await isAllowedFilePath(request.filePath)) return false;
    const done = await resolveNotionConflict(request.filePath, request.key, request.choice).catch(() => false);
    if (done) await broadcastFiles();
    return done;
  });
}
