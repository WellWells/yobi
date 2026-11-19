/**
 * The knowledge bases' settings: list with index status, add or edit (name, folder, aliases),
 * remove, re-index, and opening a cited file. Every path comes from config or the folder picker,
 * never from the renderer as a path to open: a citation link names a base and a path inside it,
 * and is opened only when that resolves to a document inside the base's folder.
 */
import { ipcMain, shell, app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { IPC } from '../../shared/types';
import { KB_ALIASES_MAX, KB_NAME_MAX, normalizeKnowledgeBases, parseKbCitationUrl } from '../../shared/knowledgeBase';
import type { KnowledgeBase } from '../../shared/knowledgeBase';
import type { KnowledgeSaveError, KnowledgeSaveRequest, KnowledgeStatus } from '../../shared/knowledgeStatus';
import { config, saveConfig } from '../config';
import { getMainWindow, sendLog, sendToRenderer } from '../helpers';
import { KB_DIR_NAME } from '../knowledge/kbPaths';
import { dropKnowledgeBase, kbStatus, onKbStatus, setKnowledgeDirectory, syncKnowledgeBase } from '../knowledge/kbStore';
import { isKbFile } from '../knowledge/kbExtract';
import { createKbWatcher, KB_STARTUP_SYNC_DELAY_MS } from '../knowledge/kbWatch';
import { resolveKbFile } from '../knowledge/kbFiles';
import { registerKnowledgeFileHandlers } from './knowledgeFiles';
import { showOpenDialogForWin } from './context';

function fold(text: string): string {
  return text.normalize('NFKC').trim().toLowerCase();
}

function isDirectory(folder: string): boolean {
  try {
    return fs.statSync(folder).isDirectory();
  } catch {
    return false;
  }
}

/** Reads what changed; the status events report it. Never rejects. */
function syncLogged(kb: KnowledgeBase): Promise<void> {
  return syncKnowledgeBase(kb, { uiLanguage: config.locale }).then(
    (result) => {
      // A watched folder's quiet re-check (nothing changed) is not worth a log line.
      if (result.added + result.updated + result.removed === 0) return;
      sendLog(`📚 Knowledge base "${kb.name}": +${result.added} ~${result.updated} -${result.removed}${result.failed ? `, ${result.failed} unreadable` : ''}`);
    },
    (err: unknown) => sendLog(`⚠️ Knowledge base "${kb.name}" could not be indexed: ${err instanceof Error ? err.message : String(err)}`),
  );
}

function syncInBackground(kb: KnowledgeBase): void {
  void syncLogged(kb);
}

const watcher = createKbWatcher({ bases: () => config.knowledgeBases, sync: syncLogged, relevant: isKbFile });

function announce(): void {
  watcher.refresh();
  sendToRenderer(IPC.KB_CHANGED, config.knowledgeBases);
}

export function saveKnowledgeBase(raw: unknown): { bases: KnowledgeBase[] } | { error: KnowledgeSaveError } {
  const request = (raw && typeof raw === 'object' ? raw : {}) as Partial<KnowledgeSaveRequest>;
  const name = typeof request.name === 'string' ? request.name.replace(/\s+/g, ' ').trim() : '';
  const folder = typeof request.folder === 'string' ? request.folder.trim() : '';
  if (!name || name.length > KB_NAME_MAX) return { error: 'name' };
  if (!folder || !path.isAbsolute(folder)) return { error: 'folder' };
  if (!isDirectory(folder)) return { error: 'notFound' };
  const existing = typeof request.id === 'string' ? config.knowledgeBases.find((kb) => kb.id === request.id) : undefined;
  if (request.id && !existing) return { error: 'name' };
  const aliases = Array.isArray(request.aliases) ? request.aliases.filter((alias): alias is string => typeof alias === 'string').slice(0, KB_ALIASES_MAX) : [];
  const others = config.knowledgeBases.filter((kb) => kb.id !== existing?.id);
  const taken = new Set(others.flatMap((kb) => [kb.name, ...kb.aliases].map(fold)));
  if (taken.has(fold(name))) return { error: 'nameTaken' };
  const id = existing?.id ?? randomUUID().replace(/-/g, '').slice(0, 12);
  const [base] = normalizeKnowledgeBases([{ id, name, folder: path.normalize(folder), aliases: aliases.filter((alias) => !taken.has(fold(alias))) }]);
  if (!base) return { error: 'name' };
  config.knowledgeBases = existing
    ? config.knowledgeBases.map((kb) => (kb.id === base.id ? base : kb))
    : [...config.knowledgeBases, base];
  saveConfig({ knowledgeBases: config.knowledgeBases });
  announce();
  if (!existing || existing.folder !== base.folder) syncInBackground(base);
  return { bases: config.knowledgeBases };
}

export function removeKnowledgeBase(id: unknown): KnowledgeBase[] {
  if (typeof id !== 'string' || !config.knowledgeBases.some((kb) => kb.id === id)) return config.knowledgeBases;
  config.knowledgeBases = config.knowledgeBases.filter((kb) => kb.id !== id);
  saveConfig({ knowledgeBases: config.knowledgeBases });
  dropKnowledgeBase(id);
  announce();
  return config.knowledgeBases;
}

/** The cited file, when the link resolves to a document inside its base's folder. */
export function resolveKbCitation(url: unknown): string | null {
  const parsed = typeof url === 'string' ? parseKbCitationUrl(url) : null;
  if (!parsed) return null;
  const kb = config.knowledgeBases.find((base) => base.id === parsed.kbId);
  return kb ? resolveKbFile(kb, parsed.rel) : null;
}

export function registerKnowledgeHandlers(): void {
  setKnowledgeDirectory(path.join(app.getPath('userData'), KB_DIR_NAME));
  onKbStatus((status) => sendToRenderer(IPC.KB_STATUS, status));
  watcher.refresh();
  setTimeout(() => watcher.syncAll(), KB_STARTUP_SYNC_DELAY_MS).unref();
  registerKnowledgeFileHandlers();

  ipcMain.handle(IPC.KB_LIST, (): { bases: KnowledgeBase[]; statuses: KnowledgeStatus[] } => ({
    bases: config.knowledgeBases,
    statuses: config.knowledgeBases.map((kb) => kbStatus(kb)),
  }));
  ipcMain.handle(IPC.KB_PICK_FOLDER, async (): Promise<string | null> => {
    const picked = await showOpenDialogForWin(getMainWindow(), { properties: ['openDirectory'] });
    return picked.canceled ? null : picked.filePaths[0] ?? null;
  });
  ipcMain.handle(IPC.KB_SAVE, (_event, request: unknown) => saveKnowledgeBase(request));
  ipcMain.handle(IPC.KB_REMOVE, (_event, id: unknown) => removeKnowledgeBase(id));
  ipcMain.handle(IPC.KB_SYNC, (_event, id: unknown): boolean => {
    const kb = config.knowledgeBases.find((base) => base.id === id);
    if (!kb) return false;
    syncInBackground(kb);
    return true;
  });
  ipcMain.handle(IPC.KB_OPEN_FOLDER, async (_event, id: unknown): Promise<boolean> => {
    const kb = typeof id === 'string' ? config.knowledgeBases.find((base) => base.id === id) : undefined;
    if (!kb || !isDirectory(kb.folder)) return false;
    return await shell.openPath(kb.folder) === '';
  });
  ipcMain.handle(IPC.KB_OPEN_CITATION, async (_event, url: unknown): Promise<boolean> => {
    const file = resolveKbCitation(url);
    if (!file) return false;
    return await shell.openPath(file) === '';
  });
}
