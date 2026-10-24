import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { SYSTEM_FOLDERS } from '../shared/conversationFolders';
import { writeFileAtomic } from './atomicWrite';
import { FOLDER_STATE_FILE, folderStatePath } from './conversationFolderPaths';
import { moveConversations } from './conversationMove';
import { getOutputDir } from './files';
import { getFlowDataDir } from './flow/paths';
import { sendLog } from './helpers';

/*
 * Once, at start-up: the bot chats' conversations written before folders existed (`tg-….md`,
 * `line-….md` at the top of outputs) are filed into `Telegram/` and `LINE/`, where new ones now go.
 * Through `moveConversations`, so a busy one is left and tried again at the next start; the flag is
 * written only when nothing was left. Flow results from before carry no sign of being one: they stay.
 * The flag lives in the flow data folder (`conversation-folders.json`): a factory reset deletes it
 * with the outputs, and restoring conversations from a backup clears it, since that can bring old
 * top-level bot files back.
 */

export { FOLDER_STATE_FILE, folderStatePath };

const BOT_FILE_RE = /^(tg|line)-.+\.md$/i;

async function botFilesFiled(): Promise<boolean> {
  try {
    const parsed = JSON.parse(await fs.readFile(folderStatePath(), 'utf-8')) as { botFilesFiled?: unknown } | null;
    return parsed?.botFilesFiled === true;
  } catch {
    return false;
  }
}

/** The folder a top-level bot conversation file belongs in, by its name, or null. */
export function botFolderForFileName(fileName: string): string | null {
  const match = BOT_FILE_RE.exec(fileName);
  if (!match) return null;
  return match[1].toLowerCase() === 'tg' ? SYSTEM_FOLDERS.telegram : SYSTEM_FOLDERS.line;
}

/**
 * Files the top-level bot conversations, once. Resolves to how many moved and how many were left
 * (busy, or failed), or null when it had already run.
 */
export async function fileBotConversationsOnce(): Promise<{ moved: number; left: number } | null> {
  if (await botFilesFiled()) return null;
  const root = await getOutputDir();
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const byFolder = new Map<string, string[]>();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const folder = botFolderForFileName(entry.name);
    if (folder) byFolder.set(folder, [...(byFolder.get(folder) ?? []), path.join(root, entry.name)]);
  }

  let moved = 0;
  let left = 0;
  for (const [folder, paths] of byFolder) {
    const result = await moveConversations(paths, folder);
    if (result.error) {
      left += paths.length;
      continue;
    }
    for (const outcome of result.outcomes) {
      if (outcome.status === 'moved') moved += 1;
      else if (outcome.status !== 'unchanged' && outcome.status !== 'missing') left += 1;
    }
  }
  if (left === 0) {
    await fs.mkdir(getFlowDataDir(), { recursive: true });
    await writeFileAtomic(folderStatePath(), `${JSON.stringify({ v: 1, botFilesFiled: true }, null, 2)}\n`);
  }
  if (moved > 0 || left > 0) sendLog(`📁 Filed ${moved} bot conversation(s) into their folders${left > 0 ? `, ${left} left for next start` : ''}`);
  return { moved, left };
}
