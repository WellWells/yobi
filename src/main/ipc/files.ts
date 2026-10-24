import { app, ipcMain, clipboard, nativeImage, shell } from 'electron';
import type { NativeImage } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { IPC } from '../../shared/types';
import { withLeadingBom } from '../../shared/conversationDoc';
import type {
  AttachmentStashRequest,
  ConversationImportResult,
  MarkdownCaptureRequest,
  MarkdownCaptureResult,
  ResponseEditResult,
  StartedConversation,
  StashedAttachment,
} from '../../shared/types';
import { writeFileAtomic } from '../atomicWrite';
import { editConversationResponse, parseResponseEditRequest, withConversationFile } from '../chat/conversationStore';
import { attachmentFromClipboard, stashAttachmentBytes } from '../attachmentStash';
import { getAssetPath, getMainWindow, sendLog, sendToRenderer } from '../helpers';
import {
  listOutputFiles,
  searchOutputFiles,
  buildSafeFileNameFromTitle,
  buildSnapshotFileName,
  getOutputDir,
  getUniquePath,
  loadMarkdownHeadingAliases,
} from '../files';
import { IMPORT_MAX_FILES, importConversationFiles } from '../conversationImport';
import { createConversationPlaceholder } from '../output';
import { captureMarkdownDocument } from '../capture';
import { writeCaptureToClipboard, writeFilesToClipboard, zipSingleFile } from '../captureClipboard';
import { openWithChooser } from '../openWith';
import { isAllowedFilePath, showSaveDialogForWin } from './context';
import { isManagedPageWebContents } from '../flow/skills/browserPages';

let appIconCache: NativeImage | null = null;
const fileIconCache = new Map<string, NativeImage>();

/** macOS refuses a drag with an empty image, so the app icon is the last resort. */
function appDragIcon(): NativeImage {
  if (appIconCache && !appIconCache.isEmpty()) return appIconCache;
  const source = nativeImage.createFromPath(getAssetPath(process.platform === 'darwin' ? 'icon-mac.png' : 'icon-win.png'));
  appIconCache = source.isEmpty() ? source : source.resize({ width: 32, height: 32 });
  return appIconCache;
}

/**
 * The icon the OS shows for this file type, so the drag looks like one from Explorer or
 * Finder. On Windows and Linux Electron still prints the path beside it — that label is
 * drawn inside Electron and no option removes it; macOS draws the icon alone.
 */
async function dragIcon(filePath: string): Promise<NativeImage> {
  const ext = path.extname(filePath).toLowerCase();
  const cached = fileIconCache.get(ext);
  if (cached) return cached;
  const icon = await app.getFileIcon(filePath, { size: 'normal' }).catch(() => null);
  if (!icon || icon.isEmpty()) return appDragIcon();
  fileIconCache.set(ext, icon);
  return icon;
}

export function registerFileHandlers(): void {
  // Rows dragged out of the conversation list: the OS gets the .md itself, as a copy.
  ipcMain.on(IPC.START_FILE_DRAG, (event, filePaths: unknown) => {
    if (event.sender !== getMainWindow()?.webContents || !Array.isArray(filePaths)) return;
    void (async () => {
      const files: string[] = [];
      for (const filePath of filePaths.slice(0, IMPORT_MAX_FILES)) {
        if (typeof filePath !== 'string' || !await isAllowedFilePath(filePath) || !existsSync(filePath)) continue;
        files.push(path.resolve(filePath));
      }
      if (files.length === 0) return;
      const icon = await dragIcon(files[0]);
      if (event.sender.isDestroyed()) return;
      event.sender.startDrag({ file: files[0], files, icon });
    })();
  });

  ipcMain.handle(IPC.IMPORT_CONVERSATIONS, async (_event, filePaths: unknown): Promise<ConversationImportResult> => {
    const outcome = await importConversationFiles(filePaths, await getOutputDir(), await loadMarkdownHeadingAliases());
    if (outcome.failed > 0) sendLog(`⚠️ Conversation import: ${outcome.failed} file(s) could not be read`);
    if (outcome.imported.length > 0) sendLog(`📥 Imported ${outcome.imported.length} conversation file(s)`);
    const files = await listOutputFiles();
    if (outcome.imported.length > 0) sendToRenderer(IPC.FILE_LIST, files);
    return { ...outcome, files };
  });

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

  ipcMain.handle(IPC.UPDATE_FILE_H1, async (_event, filePath: string, newTitle: string) => {
    if (typeof newTitle !== 'string' || !await isAllowedFilePath(filePath)) return false;
    // One line: a title with a line break would put whatever follows on line 2, where a
    // conversation's (or a Notion document's) marker lives.
    const title = newTitle.replace(/\s+/g, ' ').trim();
    if (!title) return false;
    try {
      const written = await withConversationFile(filePath, async () => {
        const content = await fs.readFile(filePath, 'utf-8');
        const heading = `# ${title}`;
        // A leading BOM stays the first character: the heading goes after it, not in front.
        const next = withLeadingBom(content, (body) => {
          const lines = body.split('\n');
          const firstLine = lines[0]?.trim() ?? '';
          // The same title again is not an edit: no write, no watcher event, no list broadcast.
          if (firstLine === heading) return null;
          if (/^#\s+/.test(firstLine)) {
            // Keep a CRLF file's line ending on the line that changes.
            lines[0] = lines[0]?.endsWith('\r') ? `${heading}\r` : heading;
          } else {
            lines.unshift(heading, '');
          }
          return lines.join('\n');
        });
        if (next === null) return false;
        await writeFileAtomic(filePath, next);
        return true;
      });
      if (written) sendToRenderer(IPC.FILE_LIST, await listOutputFiles());
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle(IPC.EDIT_TURN_RESPONSE, async (_event, request: unknown): Promise<ResponseEditResult> => {
    const parsed = parseResponseEditRequest(request);
    if (!parsed || !await isAllowedFilePath(parsed.filePath)) return { ok: false, reason: 'failed' };
    try {
      const result = await editConversationResponse(parsed);
      if (result.ok) sendLog(`✏️ Edited answer ${parsed.turnIndex + 1} in ${path.basename(parsed.filePath)}`);
      return result;
    } catch (err: unknown) {
      sendLog(`⚠️ Could not edit the answer: ${err instanceof Error ? err.message : String(err)}`);
      return { ok: false, reason: 'failed' };
    }
  });

  ipcMain.handle(IPC.START_CONVERSATION, async (_event, prompt: string): Promise<StartedConversation | null> => {
    try {
      const { path: filePath, content } = await createConversationPlaceholder({
        outputDir: await getOutputDir(),
        prompt,
      });
      const files = await listOutputFiles();
      const file = files.find((candidate) => candidate.path === filePath);
      if (!file) return null;
      sendToRenderer(IPC.FILE_LIST, files);
      return { path: filePath, file, content, files };
    } catch (err: unknown) {
      sendLog(`⚠️ Could not open a conversation file up front: ${(err as Error).message}`);
      return null;
    }
  });

  ipcMain.handle(IPC.CAPTURE_MARKDOWN_IMAGE, async (_event, request: MarkdownCaptureRequest) => {
    try {
      const requestedFileName = (request?.options?.fileName ?? '').trim();
      const fileStem = requestedFileName ? buildSafeFileNameFromTitle(requestedFileName) : buildSnapshotFileName();
      const resultDoc = await captureMarkdownDocument({
        ...request,
        options: { ...request.options, fileName: fileStem },
      });
      if (resultDoc.mode === 'copy') {
        // The outcome is logged rather than surfaced: this dialog lives inside the main
        // window, where the copy button's own feedback already tells the user it ran.
        const outcome = await writeCaptureToClipboard(
          resultDoc.buffer,
          resultDoc.ext,
          fileStem,
          request?.options?.zip === true,
        );
        if (outcome !== 'ok') sendLog(`⚠️ Snapshot copy landed as: ${outcome}`);
        const result: MarkdownCaptureResult = { ok: true };
        return result;
      }

      const outputDir = await getOutputDir();
      await fs.mkdir(outputDir, { recursive: true });
      const zipped = request?.options?.zip === true;
      const ext = zipped ? 'zip' : resultDoc.ext;
      const dialogResult = await showSaveDialogForWin(getMainWindow(), {
        defaultPath: await getUniquePath(path.join(outputDir, `${fileStem}.${ext}`), ''),
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
      });
      if (dialogResult.canceled || !dialogResult.filePath) {
        const canceledResult: MarkdownCaptureResult = { ok: false, canceled: true };
        return canceledResult;
      }
      const filePath = dialogResult.filePath;
      await fs.writeFile(
        filePath,
        zipped ? zipSingleFile(resultDoc.buffer, `${fileStem}.${resultDoc.ext}`) : resultDoc.buffer,
      );
      sendLog(`🖼️ Snapshot saved: ${filePath}`);
      const result: MarkdownCaptureResult = { ok: true, filePath };
      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'capture failed';
      sendLog(`❌ Failed to capture snapshot: ${message}`);
      const result: MarkdownCaptureResult = { ok: false, error: message };
      return result;
    }
  });

  ipcMain.handle(IPC.COPY_TEXT_TO_CLIPBOARD, async (_event, text: string) => {
    await clipboard.writeText(text ?? '');
    return true;
  });

  ipcMain.handle(
    IPC.ATTACHMENT_STASH_BYTES,
    (_event, request: AttachmentStashRequest): Promise<StashedAttachment> => stashAttachmentBytes(request),
  );

  ipcMain.handle(IPC.ATTACHMENT_FROM_CLIPBOARD, (): Promise<StashedAttachment | null> =>
    attachmentFromClipboard());

  ipcMain.handle(IPC.CAPTURE_PAGE, async (event, args: { name?: string }): Promise<string> => {
    if (!isManagedPageWebContents(event.sender)) {
      throw new Error('CAPTURE_PAGE is only available to flow browser pages');
    }
    const image = await event.sender.capturePage();
    const buffer = image.toPNG();
    const outputDir = await getOutputDir();
    await fs.mkdir(outputDir, { recursive: true });
    const rawName = args && typeof args.name === 'string' ? args.name.trim() : '';
    const fileStem = rawName ? buildSafeFileNameFromTitle(rawName) : buildSnapshotFileName();
    const filePath = await getUniquePath(path.join(outputDir, `${fileStem}.png`), '');
    await fs.writeFile(filePath, buffer);
    sendLog(`🖼️ [Flow] Page screenshot saved: ${path.basename(filePath)}`);
    return filePath;
  });

  ipcMain.handle(IPC.SHOW_IN_FOLDER, (_event, filePath: string) => shell.showItemInFolder(filePath));
  ipcMain.handle(IPC.OPEN_PATH, async (_event, filePath: string) => {
    const error = await shell.openPath(filePath);
    return error === '';
  });
  ipcMain.handle(IPC.OPEN_FILE_WITH, async (_event, filePath: unknown) => {
    if (typeof filePath !== 'string' || !await isAllowedFilePath(filePath) || !existsSync(filePath)) return false;
    return openWithChooser(path.resolve(filePath));
  });
  // Returns how many files landed on the clipboard: missing or outside files are skipped silently,
  // so the renderer's "N files copied" counts this, not what it asked for.
  ipcMain.handle(IPC.COPY_FILES_TO_CLIPBOARD, async (_event, filePaths: unknown) => {
    if (!Array.isArray(filePaths)) return 0;
    const files: string[] = [];
    for (const filePath of filePaths) {
      if (typeof filePath !== 'string' || !await isAllowedFilePath(filePath) || !existsSync(filePath)) continue;
      files.push(path.resolve(filePath));
    }
    if (files.length === 0) return 0;
    await writeFilesToClipboard(files);
    return files.length;
  });
}
