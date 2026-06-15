import { ipcMain, clipboard, nativeImage, shell } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { IPC } from '../../shared/types';
import type { MarkdownCaptureRequest, MarkdownCaptureResult } from '../../shared/types';
import { sendLog, sendToRenderer } from '../helpers';
import {
  listOutputFiles,
  searchOutputFiles,
  buildSafeFileNameFromTitle,
  buildSnapshotFileName,
  getOutputDir,
  getUniquePath,
} from '../files';
import { captureMarkdownDocument } from '../capture';
import { isAllowedFilePath } from './context';
import { isManagedPageWebContents } from '../flow/skills/browserPages';

export function registerFileHandlers(): void {
  ipcMain.handle(IPC.GET_FILE_LIST, () => listOutputFiles());
  ipcMain.handle(IPC.SEARCH_FILE_LIST, (_event, query: string) => searchOutputFiles(query));

  ipcMain.handle(IPC.GET_FILE_CONTENT, async (_event, filePath: string) => {
    if (!await isAllowedFilePath(filePath)) return null;
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  });

  ipcMain.handle(IPC.UPDATE_FILE_TITLE, async (_event, filePath: string, newTitle: string) => {
    if (!await isAllowedFilePath(filePath)) return { ok: false, updatedPath: filePath };
    const title = newTitle.trim();
    if (!title) return { ok: false, updatedPath: filePath };
    try {
      const dir = path.dirname(filePath);
      const ext = path.extname(filePath) || '.md';
      const basename = buildSafeFileNameFromTitle(title);
      const targetPath = await getUniquePath(path.join(dir, `${basename}${ext}`), filePath);
      if (targetPath !== filePath) await fs.rename(filePath, targetPath);
      sendToRenderer(IPC.FILE_LIST, await listOutputFiles());
      return { ok: true, updatedPath: targetPath };
    } catch {
      return { ok: false, updatedPath: filePath };
    }
  });

  ipcMain.handle(IPC.UPDATE_FILE_H1, async (_event, filePath: string, newTitle: string) => {
    if (!await isAllowedFilePath(filePath)) return false;
    const title = newTitle.trim();
    if (!title) return false;
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      const firstLine = lines[0]?.trim() ?? '';
      if (/^#\s+/.test(firstLine)) {
        lines[0] = `# ${title}`;
      } else {
        lines.unshift(`# ${title}`, '');
      }
      await fs.writeFile(filePath, lines.join('\n'), 'utf-8');
      sendToRenderer(IPC.FILE_LIST, await listOutputFiles());
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle(IPC.DELETE_FILE, async (_event, filePath: string) => {
    if (!await isAllowedFilePath(filePath)) return false;
    try {
      await fs.unlink(filePath);
      sendToRenderer(IPC.FILE_LIST, await listOutputFiles());
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle(IPC.DELETE_ALL_FILES, async () => {
    const files = await listOutputFiles();
    if (files.length === 0) return 0;
    let deleted = 0;
    for (const file of files) {
      try {
        await fs.unlink(file.path);
        deleted += 1;
      } catch {
      }
    }
    sendToRenderer(IPC.FILE_LIST, await listOutputFiles());
    return deleted;
  });

  ipcMain.handle(IPC.CAPTURE_MARKDOWN_IMAGE, async (_event, request: MarkdownCaptureRequest) => {
    try {
      const resultDoc = await captureMarkdownDocument(request);
      const requestedFileName = (request?.options?.fileName ?? '').trim();
      const fileStem = requestedFileName ? buildSafeFileNameFromTitle(requestedFileName) : buildSnapshotFileName();
      if (resultDoc.mode === 'copy') {
        if (resultDoc.ext === 'pdf' || resultDoc.ext === 'webp') {
          const tmpDir = os.tmpdir();
          const tmpPath = path.join(tmpDir, `${fileStem}.${resultDoc.ext}`);
          await fs.writeFile(tmpPath, resultDoc.buffer);

          if (process.platform === 'win32') {
            await new Promise<void>((resolve) => {
              execFile(
                'powershell.exe',
                ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', `Set-Clipboard -Path "${tmpPath}"`],
                () => resolve(),
              );
            });
          } else if (process.platform === 'darwin') {
            clipboard.writeBuffer('public.file-url', Buffer.from(`file://${tmpPath}`, 'utf-8'));
          } else {
            clipboard.writeBuffer('text/uri-list', Buffer.from(`file://${tmpPath}`, 'utf-8'));
          }
          sendLog(`📋 ${resultDoc.ext.toUpperCase()} copied as temp file: ${tmpPath}`);
        } else {
          const image = nativeImage.createFromBuffer(resultDoc.buffer);
          clipboard.writeImage(image);
          sendLog('📋 Image copied to clipboard');
        }
        const result: MarkdownCaptureResult = { ok: true };
        return result;
      }

      const outputDir = await getOutputDir();
      await fs.mkdir(outputDir, { recursive: true });
      const filePath = await getUniquePath(
        path.join(outputDir, `${fileStem}.${resultDoc.ext}`),
        '',
      );
      await fs.writeFile(filePath, resultDoc.buffer);
      sendLog(`🖼️ Snapshot saved: ${path.basename(filePath)}`);
      const result: MarkdownCaptureResult = { ok: true, filePath };
      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'capture failed';
      sendLog(`❌ Failed to capture snapshot: ${message}`);
      const result: MarkdownCaptureResult = { ok: false, error: message };
      return result;
    }
  });

  ipcMain.handle(IPC.COPY_TEXT_TO_CLIPBOARD, (_event, text: string) => {
    clipboard.writeText(text ?? '');
    return true;
  });

  ipcMain.handle(IPC.CAPTURE_PAGE, async (event, args: { name?: string }): Promise<string> => {
    if (!isManagedPageWebContents(event.sender)) {
      throw new Error('CAPTURE_PAGE is only available to AgentFlow browser pages');
    }
    const image = await event.sender.capturePage();
    const buffer = image.toPNG();
    const outputDir = await getOutputDir();
    await fs.mkdir(outputDir, { recursive: true });
    const rawName = args && typeof args.name === 'string' ? args.name.trim() : '';
    const fileStem = rawName ? buildSafeFileNameFromTitle(rawName) : buildSnapshotFileName();
    const filePath = await getUniquePath(path.join(outputDir, `${fileStem}.png`), '');
    await fs.writeFile(filePath, buffer);
    sendLog(`🖼️ [AgentFlow] Page screenshot saved: ${path.basename(filePath)}`);
    return filePath;
  });

  ipcMain.handle(IPC.SHOW_IN_FOLDER, (_event, filePath: string) => shell.showItemInFolder(filePath));
  ipcMain.handle(IPC.OPEN_PATH, async (_event, filePath: string) => {
    const error = await shell.openPath(filePath);
    return error === '';
  });
}
