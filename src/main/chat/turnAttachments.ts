import * as path from 'node:path';
import { stashRoot } from '../attachmentStash';
import { copyForChat, pruneChatMedia } from '../chatMedia';
import { markFromInternet } from '../internetMark';
import { telegramTempDir } from '../telegram/fileDownload';

function isDirectlyIn(folder: string, file: string): boolean {
  return path.dirname(path.resolve(file)) === path.resolve(folder);
}

/**
 * Where a turn's attachments can be opened later, in their order (`af`); `''` for one that could
 * not be kept. A file the person picked stays where it is, so "show in folder" finds it there. A
 * bot's upload is deleted when the task ends and a paste within a day, so those are copied into
 * the chat's media cache; the upload came from somebody else, so its copy says so to Windows. A
 * temporary chat copies nothing: it must leave nothing behind.
 */
export async function keptAttachmentPaths(files: readonly string[], temporary: boolean): Promise<string[]> {
  if (temporary) return [...files];
  const kept: string[] = [];
  for (const file of files) {
    const fromBot = isDirectlyIn(telegramTempDir(), file);
    if (!fromBot && !isDirectlyIn(stashRoot(), file)) {
      kept.push(file);
      continue;
    }
    const copy = await copyForChat(file);
    if (copy && fromBot) await markFromInternet(copy);
    kept.push(copy ?? '');
  }
  if (kept.some((file, index) => file !== files[index])) void pruneChatMedia().catch(() => {});
  return kept;
}
