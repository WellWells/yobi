import { ipcMain } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { IPC } from '../../shared/types';
import type { ConversationPinRequest, OutputFile } from '../../shared/types';
import { setConversationPinned } from '../../shared/conversationPin';
import { writeFileAtomic } from '../atomicWrite';
import { withConversationFile } from '../chat/conversationStore';
import { listOutputFiles } from '../files';
import { sendToRenderer } from '../helpers';
import { isAllowedFilePath } from './context';

/** Far above any selection the sidebar can make; it only stops a runaway payload. */
const PIN_MAX_PATHS = 10_000;

export interface ConversationPinIo {
  isAllowed: (filePath: string) => Promise<boolean>;
  /** One read-modify-write, queued behind every other write to the same file. */
  update: (filePath: string, change: (raw: string) => string | null) => Promise<boolean>;
  list: () => Promise<OutputFile[]>;
  broadcast: (files: OutputFile[]) => void;
}

/** The renderer's request, or null when any field is off. */
export function parsePinRequest(value: unknown): ConversationPinRequest | null {
  if (!value || typeof value !== 'object') return null;
  const { paths, pinned } = value as Record<string, unknown>;
  if (typeof pinned !== 'boolean' || !Array.isArray(paths) || paths.length > PIN_MAX_PATHS) return null;
  if (!paths.every((entry): entry is string => typeof entry === 'string' && entry.length > 0)) return null;
  return { paths: [...new Set(paths)], pinned };
}

/**
 * Pins or unpins conversations in outputs. Paths outside outputs, files that are not Markdown and
 * files that are gone are skipped; a file already in the asked state is not rewritten. Answers with
 * the number of files changed, and broadcasts the list when there is one.
 */
export async function setConversationsPinned(request: unknown, io: ConversationPinIo): Promise<number> {
  const parsed = parsePinRequest(request);
  if (!parsed) return 0;
  let changed = 0;
  for (const filePath of parsed.paths) {
    if (path.extname(filePath).toLowerCase() !== '.md' || !await io.isAllowed(filePath)) continue;
    try {
      if (await io.update(filePath, (raw) => setConversationPinned(raw, parsed.pinned))) changed += 1;
    } catch {
      // Gone or unreadable: nothing to pin.
    }
  }
  if (changed > 0) io.broadcast(await io.list());
  return changed;
}

const electronIo: ConversationPinIo = {
  isAllowed: isAllowedFilePath,
  update: (filePath, change) => withConversationFile(filePath, async () => {
    const next = change(await fs.readFile(filePath, 'utf-8'));
    if (next === null) return false;
    await writeFileAtomic(filePath, next);
    return true;
  }),
  list: listOutputFiles,
  broadcast: (files) => sendToRenderer(IPC.FILE_LIST, files),
};

export function registerConversationPinHandlers(io: ConversationPinIo = electronIo): void {
  ipcMain.handle(IPC.CONVERSATION_SET_PINNED, (_event, request: unknown) => setConversationsPinned(request, io));
}
