import * as path from 'node:path';
import { getFlowDataDir } from './flow/paths';

/*
 * Recently Deleted lives beside the version history and never in the outputs folder: every .md
 * under outputs is a conversation to the list, the search, the file watcher, the backup and the
 * agent's file tools. A conversation in the trash must be none of those.
 */
export const TRASH_DIR_NAME = 'trash';

export function conversationTrashDir(): string {
  return path.join(getFlowDataDir(), TRASH_DIR_NAME, 'conversations');
}
