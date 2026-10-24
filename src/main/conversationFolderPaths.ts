import * as path from 'node:path';
import { getFlowDataDir } from './flow/paths';

/**
 * Notes about conversation folders that outlive a run: whether the bot conversations from before
 * folders existed were filed into `Telegram/` and `LINE/` (see `conversationFolderMigration.ts`).
 */
export const FOLDER_STATE_FILE = 'conversation-folders.json';

export function folderStatePath(): string {
  return path.join(getFlowDataDir(), FOLDER_STATE_FILE);
}
