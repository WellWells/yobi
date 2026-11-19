/**
 * A knowledge base's page: its files (list, add, remove, open, the indexed text) and the AI
 * description queue. Every file is named by the base's id and a path inside its folder; files to
 * add come from a drop or the file picker and are copied in (`kbFiles.ts`).
 */
import { ipcMain, shell } from 'electron';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { IPC, PROVIDER_ATTACHMENT_POLICIES, isByokTargetUrl, providerFromUrl } from '../../shared/types';
import { languageForLocale } from '../../shared/localeLanguage';
import type { KnowledgeBase } from '../../shared/knowledgeBase';
import type { KnowledgeAnalysisEvent, KnowledgeFile, KnowledgeFileDetail, KnowledgeFilePreview, KnowledgeImportResult, KnowledgeSearchResult } from '../../shared/knowledgeStatus';
import { config } from '../config';
import { rememberQuickActionModel } from '../chat/oneShotRequest';
import { getMainWindow, sendLog, sendToRenderer } from '../helpers';
import { getLangCache, localizeUserFacingError, t } from '../i18n';
import { preparePromptForProvider, runAutomation } from '../providers';
import { byokTargetTakesImages, runByokCompletion } from '../providers/byokClient';
import { loadByokImages, withByokImages } from '../providers/byokImages';
import { clickStopGeneration } from '../providers/stopGeneration';
import { llmLane } from '../flow/lanes';
import { FlowAbortError } from '../flow/runtime';
import { ensureWorkerWindow } from '../windows';
import { workerWindowUnavailable } from '../workerWindowError';
import { KbAnalyzeQueue, KB_ANALYZE_ERROR_KEYS } from '../knowledge/kbAnalyze';
import type { AnalyzeInput } from '../knowledge/kbAnalyze';
import { deleteKbFiles, importIntoKb, joinKbFiles, readKbPreview, resolveKbFile } from '../knowledge/kbFiles';
import { ocrAvailable, renderPdfPages } from '../knowledge/kbOcr';
import { knowledgeBaseIndex, refreshKbStatus } from '../knowledge/kbStore';
import { searchKbContent } from '../knowledge/kbContentSearch';
import { listKbFolder } from '../knowledge/kbSync';
import { showOpenDialogForWin } from './context';

/** One description's longest wait: idle for a website, in total for an API key. */
const KB_ANALYZE_TIMEOUT_MS = 5 * 60_000;
/** The indexed text the page shows for a file, at most. */
const DETAIL_TEXT_MAX = 20_000;
/** A content search is a few words; anything longer is cut before it reaches the index. */
const KB_SEARCH_QUERY_MAX = 200;

function findKb(id: unknown): KnowledgeBase | undefined {
  return typeof id === 'string' ? config.knowledgeBases.find((kb) => kb.id === id) : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

async function askModel(model: string, prompt: string, input: AnalyzeInput, signal: AbortSignal): Promise<string> {
  if (isByokTargetUrl(model)) {
    const images = input.kind === 'images' ? await loadByokImages(input.files) : [];
    const { response } = await runByokCompletion(model, withByokImages(prompt, images), KB_ANALYZE_TIMEOUT_MS, signal);
    return response;
  }
  const attachments = input.kind === 'file' ? input.attachments : undefined;
  const result = await llmLane.runExclusive(async () => {
    if (signal.aborted) throw new FlowAbortError();
    const prepared = preparePromptForProvider(prompt, model);
    const win = await ensureWorkerWindow(model, 'automation');
    if (!win || win.isDestroyed()) throw workerWindowUnavailable();
    const stopPage = (): void => {
      if (!win.isDestroyed()) void clickStopGeneration(win.webContents, model);
    };
    signal.addEventListener('abort', stopPage, { once: true });
    try {
      // A one-off send: it follows the user's temporary-chat setting, like a translation.
      return await runAutomation(win, prepared.prompt, KB_ANALYZE_TIMEOUT_MS, model, attachments);
    } finally {
      signal.removeEventListener('abort', stopPage);
    }
  });
  if (signal.aborted) throw new FlowAbortError();
  return result.response;
}

function describeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if ((KB_ANALYZE_ERROR_KEYS as readonly string[]).includes(message)) return t(getLangCache(), message);
  return localizeUserFacingError(message, getLangCache());
}

const queue = new KbAnalyzeQueue({
  findKb,
  index: (kb) => knowledgeBaseIndex(kb),
  resolve: resolveKbFile,
  abilities: (model) => {
    const web = !isByokTargetUrl(model);
    return {
      web,
      uploads: web && PROVIDER_ATTACHMENT_POLICIES[providerFromUrl(model)].maxFiles > 0,
      images: !web && byokTargetTakesImages(model),
      renderPdf: ocrAvailable(),
    };
  },
  renderPages: async (file, maxPages, signal) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yobi-kb-pages-'));
    const cleanup = (): void => fs.rmSync(dir, { recursive: true, force: true });
    try {
      return { ...await renderPdfPages(file, dir, maxPages, signal), cleanup };
    } catch (err) {
      cleanup();
      throw err;
    }
  },
  ask: askModel,
  language: () => languageForLocale(config.locale),
  describeError,
  emit: (event: KnowledgeAnalysisEvent) => sendToRenderer(IPC.KB_ANALYSIS, event),
  stored: (kb) => refreshKbStatus(kb),
  log: sendLog,
});

export async function listKnowledgeFiles(id: unknown): Promise<{ files: KnowledgeFile[]; analysis: KnowledgeAnalysisEvent[] }> {
  const kb = findKb(id);
  if (!kb) return { files: [], analysis: [] };
  const { files } = await listKbFolder(kb.folder).catch(() => ({ files: [] }));
  return { files: joinKbFiles(files, knowledgeBaseIndex(kb).files()), analysis: queue.pending(kb.id) };
}

export function registerKnowledgeFileHandlers(): void {
  ipcMain.handle(IPC.KB_FILES, (_event, id: unknown) => listKnowledgeFiles(id));

  ipcMain.handle(IPC.KB_FILE_DETAIL, (_event, id: unknown, rel: unknown): KnowledgeFileDetail | null => {
    const kb = findKb(id);
    if (!kb || typeof rel !== 'string') return null;
    const index = knowledgeBaseIndex(kb);
    const row = index.fileByPath(rel);
    return {
      text: index.ownText(rel, DETAIL_TEXT_MAX),
      ai: index.aiText(rel),
      aiModel: row?.aiModel ?? '',
      ...(row?.cut ? { cut: row.cut } : {}),
      ...(row?.aiCut ? { aiCut: row.aiCut } : {}),
    };
  });

  ipcMain.handle(IPC.KB_SEARCH, (_event, id: unknown, query: unknown): KnowledgeSearchResult | null => {
    const kb = findKb(id);
    if (!kb || typeof query !== 'string') return null;
    return searchKbContent(knowledgeBaseIndex(kb), query.slice(0, KB_SEARCH_QUERY_MAX));
  });

  // Read-only preview: only a path inside the base's folder (`resolveKbFile`), never one from the page.
  ipcMain.handle(IPC.KB_FILE_PREVIEW, async (_event, id: unknown, rel: unknown): Promise<KnowledgeFilePreview | null> => {
    const kb = findKb(id);
    const file = kb ? resolveKbFile(kb, rel) : null;
    return file ? readKbPreview(file).catch(() => null) : null;
  });

  ipcMain.handle(IPC.KB_PICK_FILES, async (): Promise<string[]> => {
    const picked = await showOpenDialogForWin(getMainWindow(), { properties: ['openFile', 'multiSelections'] });
    return picked.canceled ? [] : picked.filePaths;
  });

  ipcMain.handle(IPC.KB_IMPORT, async (_event, id: unknown, paths: unknown): Promise<KnowledgeImportResult | null> => {
    const kb = findKb(id);
    if (!kb) return null;
    const result = await importIntoKb(kb, strings(paths));
    sendLog(`📚 [KB] "${kb.name}": ${result.added} file(s) added${result.skipped ? `, ${result.skipped} skipped` : ''}${result.failed ? `, ${result.failed} failed` : ''}`);
    return result;
  });

  ipcMain.handle(IPC.KB_DELETE_FILES, async (_event, id: unknown, rels: unknown): Promise<number> => {
    const kb = findKb(id);
    if (!kb) return 0;
    const list = strings(rels);
    queue.cancel(kb.id, list);
    return deleteKbFiles(kb, list, (file) => shell.trashItem(file));
  });

  ipcMain.handle(IPC.KB_OPEN_FILE, async (_event, id: unknown, rel: unknown): Promise<boolean> => {
    const kb = findKb(id);
    const file = kb ? resolveKbFile(kb, rel) : null;
    return file ? await shell.openPath(file) === '' : false;
  });
  ipcMain.handle(IPC.KB_REVEAL_FILE, (_event, id: unknown, rel: unknown): boolean => {
    const kb = findKb(id);
    const file = kb ? resolveKbFile(kb, rel) : null;
    if (!file) return false;
    shell.showItemInFolder(file);
    return true;
  });

  ipcMain.handle(IPC.KB_ANALYZE, (_event, id: unknown, rels: unknown, model: unknown): boolean => {
    const kb = findKb(id);
    if (!kb || typeof model !== 'string' || !/^(https?|byok|byokgroup):\/\//.test(model)) return false;
    // The menu it was picked from ticks the shared quick-action model: the next time ticks this one.
    rememberQuickActionModel(model);
    queue.add(kb.id, strings(rels), model);
    return true;
  });

  ipcMain.handle(IPC.KB_ANALYZE_CANCEL, (_event, id: unknown, rels: unknown): void => {
    const kb = findKb(id);
    if (kb) queue.cancel(kb.id, strings(rels));
  });

  ipcMain.handle(IPC.KB_AI_CLEAR, (_event, id: unknown, rels: unknown): number => {
    const kb = findKb(id);
    if (!kb) return 0;
    const index = knowledgeBaseIndex(kb);
    const cleared = strings(rels).filter((rel) => index.setAi(rel, '', [], '', 0)).length;
    refreshKbStatus(kb);
    return cleared;
  });
}
