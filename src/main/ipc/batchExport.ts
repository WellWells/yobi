import { ipcMain } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { existsSync } from 'node:fs';
import AdmZip from 'adm-zip';
import { IPC } from '../../shared/types';
import type {
  BatchCaptureFormat,
  BatchCaptureItem,
  BatchCaptureResult,
  ZipExportResult,
} from '../../shared/types';
import { CaptureTooTallError, captureMarkdownDocument } from '../capture';
import {
  BATCH_CAPTURE_MAX_ITEMS,
  runBatchCapture,
  uniqueEntryName,
  writeUniqueFile,
} from '../batchCapture';
import { buildSafeFileNameFromTitle, getOutputDir, getUniquePath } from '../files';
import { getMainWindow, sendLog, sendWebNotification } from '../helpers';
import { getLangCache, t } from '../i18n';
import { isAllowedFilePath, showOpenDialogForWin, showSaveDialogForWin } from './context';

let activeBatch: AbortController | null = null;
/** The folder picked last time this session, so a second batch opens where the first went. */
let lastBatchFolder = '';

function parseBatchItems(raw: unknown): BatchCaptureItem[] {
  if (!Array.isArray(raw)) return [];
  const items: BatchCaptureItem[] = [];
  for (const entry of raw.slice(0, BATCH_CAPTURE_MAX_ITEMS)) {
    const item = entry as Partial<BatchCaptureItem> | null;
    if (!item || typeof item.request !== 'object' || item.request === null) continue;
    const name = typeof item.name === 'string' ? item.name : '';
    const stem = typeof item.fileStem === 'string' ? item.fileStem : name;
    items.push({ name, fileStem: buildSafeFileNameFromTitle(stem), request: item.request });
  }
  return items;
}

function todayStamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The window can be covered by the time a long batch ends; a notice then says it finished. */
function notifyIfAway(body: string, level: 'success' | 'warning'): void {
  const win = getMainWindow();
  if (win && !win.isDestroyed() && win.isFocused()) return;
  sendWebNotification(t(getLangCache(), 'batchExport.notify.title'), body, level);
}

export function registerBatchExportHandlers(): void {
  ipcMain.handle(IPC.BATCH_CAPTURE_START, async (event, format: unknown, rawItems: unknown): Promise<BatchCaptureResult> => {
    const empty: BatchCaptureResult = { status: 'canceled', saved: 0, failed: [] };
    if (event.sender !== getMainWindow()?.webContents) return empty;
    if (activeBatch) return { ...empty, status: 'busy' };
    const batchFormat: BatchCaptureFormat = format === 'png' ? 'png' : 'pdf';
    const items = parseBatchItems(rawItems);
    if (items.length === 0) return empty;

    // Claimed before the picker opens, so a second click cannot stack a second dialog.
    const job = new AbortController();
    activeBatch = job;
    try {
      const strings = getLangCache();
      const picked = await showOpenDialogForWin(getMainWindow(), {
        title: t(strings, 'batchExport.pickFolder'),
        defaultPath: lastBatchFolder || await getOutputDir(),
        properties: ['openDirectory', 'createDirectory'],
      });
      const folder = picked.filePaths[0];
      if (picked.canceled || !folder) return empty;
      lastBatchFolder = folder;

      const started = Date.now();
      sendLog(`🖼️ Batch export: ${items.length} conversation(s) as ${batchFormat.toUpperCase()} → ${folder}`);
      const outcome = await runBatchCapture(items, {
        capture: (request, signal) => captureMarkdownDocument(
          { ...request, options: { ...request.options, format: batchFormat, mode: 'save', zip: false } },
          signal,
        ),
        write: (stem, ext, buffer) => writeUniqueFile(folder, stem, ext, buffer),
        isTooTall: (err) => err instanceof CaptureTooTallError,
        onProgress: (progress) => {
          if (!event.sender.isDestroyed()) event.sender.send(IPC.BATCH_CAPTURE_PROGRESS, progress);
        },
        signal: job.signal,
      });
      const seconds = ((Date.now() - started) / 1_000).toFixed(1);
      sendLog(
        `🖼️ Batch export ${outcome.stopped ? 'stopped' : 'finished'} in ${seconds}s: `
        + `${outcome.saved.length} saved, ${outcome.failed.length} failed`,
      );
      for (const failure of outcome.failed) {
        sendLog(`⚠️ Batch export skipped "${failure.name}": ${failure.reason}${failure.detail ? ` — ${failure.detail}` : ''}`);
      }
      if (!outcome.stopped) {
        notifyIfAway(
          outcome.failed.length === 0
            ? t(strings, 'batchExport.done', { count: String(outcome.saved.length) })
            : t(strings, 'batchExport.partial', {
              count: String(outcome.saved.length),
              failed: String(outcome.failed.length),
            }),
          outcome.failed.length === 0 ? 'success' : 'warning',
        );
      }
      return {
        status: outcome.stopped ? 'stopped' : 'done',
        folder,
        saved: outcome.saved.length,
        failed: outcome.failed,
      };
    } finally {
      if (activeBatch === job) activeBatch = null;
    }
  });

  ipcMain.handle(IPC.BATCH_CAPTURE_STOP, () => {
    activeBatch?.abort();
    return true;
  });

  // The conversation files themselves, as they are on disk — the same bytes a drag-out or
  // "Copy file" hands over, just bundled into one archive.
  ipcMain.handle(IPC.EXPORT_FILES_ZIP, async (event, filePaths: unknown): Promise<ZipExportResult> => {
    if (event.sender !== getMainWindow()?.webContents || !Array.isArray(filePaths)) return { ok: false };
    const files: string[] = [];
    for (const filePath of filePaths.slice(0, BATCH_CAPTURE_MAX_ITEMS)) {
      if (typeof filePath !== 'string' || !await isAllowedFilePath(filePath) || !existsSync(filePath)) continue;
      files.push(path.resolve(filePath));
    }
    if (files.length === 0) return { ok: false };

    const strings = getLangCache();
    const outputDir = await getOutputDir();
    const stem = buildSafeFileNameFromTitle(`${t(strings, 'batchExport.zipStem')}-${todayStamp()}`);
    const picked = await showSaveDialogForWin(getMainWindow(), {
      defaultPath: await getUniquePath(path.join(lastBatchFolder || outputDir, `${stem}.zip`), ''),
      filters: [{ name: 'ZIP', extensions: ['zip'] }],
    });
    if (picked.canceled || !picked.filePath) return { ok: false, canceled: true };

    try {
      const zip = new AdmZip();
      const taken = new Set<string>();
      for (const file of files) {
        zip.addFile(uniqueEntryName(taken, path.basename(file)), await fs.readFile(file));
      }
      await fs.writeFile(picked.filePath, zip.toBuffer());
      lastBatchFolder = path.dirname(picked.filePath);
      sendLog(`🗜️ Zipped ${files.length} conversation(s): ${picked.filePath}`);
      return { ok: true, filePath: picked.filePath, count: files.length };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      sendLog(`❌ Zip export failed: ${message}`);
      return { ok: false, error: message };
    }
  });
}
