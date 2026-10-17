import { app, ipcMain } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { IPC } from '../../shared/types';
import type { MarkdownExportResult } from '../../shared/types';
import { conversationPlainMarkdown } from '../../shared/conversationPlain';
import type { NotionDisplayLabels } from '../../shared/notion/notionDisplay';
import { getMainWindow, sendLog } from '../helpers';
import { getLangCache, t } from '../i18n';
import { isAllowedFilePath, showSaveDialogForWin } from './context';

export interface MarkdownExportIo {
  isAllowed: (filePath: string) => Promise<boolean>;
  read: (filePath: string) => Promise<string>;
  pickTarget: (defaultPath: string) => Promise<string | null>;
  write: (target: string, text: string) => Promise<void>;
  defaultDir: () => string;
  /** How a Notion document writes a block Yobi cannot show, in the app's language. */
  notionLabels: () => NotionDisplayLabels;
}

/**
 * Saves a conversation as plain Markdown, without Yobi's hidden markers, where the user picks.
 * Only a file inside outputs is read; the renderer never hands over the text itself.
 */
export async function exportConversationMarkdown(filePath: unknown, io: MarkdownExportIo): Promise<MarkdownExportResult> {
  if (typeof filePath !== 'string' || !await io.isAllowed(filePath)) return { ok: false, error: 'invalid' };
  try {
    const text = conversationPlainMarkdown(await io.read(filePath), io.notionLabels());
    const target = await io.pickTarget(path.join(io.defaultDir(), path.basename(filePath)));
    if (!target) return { ok: false, canceled: true };
    await io.write(target, `${text}\n`);
    return { ok: true, filePath: target };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const electronIo: MarkdownExportIo = {
  isAllowed: isAllowedFilePath,
  read: (filePath) => fs.readFile(filePath, 'utf-8'),
  pickTarget: async (defaultPath) => {
    const picked = await showSaveDialogForWin(getMainWindow(), {
      defaultPath,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    return picked.canceled || !picked.filePath ? null : picked.filePath;
  },
  write: (target, text) => fs.writeFile(target, text, 'utf-8'),
  defaultDir: () => app.getPath('documents'),
  notionLabels: () => ({ unsupported: t(getLangCache(), 'notion.block.unsupported') }),
};

export function registerMarkdownExportHandlers(): void {
  ipcMain.handle(IPC.EXPORT_CONVERSATION_MARKDOWN, async (_event, filePath: unknown) => {
    const result = await exportConversationMarkdown(filePath, electronIo);
    if (result.ok) sendLog(`📄 Markdown exported: ${result.filePath}`);
    else if (result.error) sendLog(`❌ Markdown export failed: ${result.error}`);
    return result;
  });
}
