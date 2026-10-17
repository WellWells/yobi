import * as path from 'node:path';
import { getFlowDataDir } from '../flow/paths';

/**
 * Version history, for conversations and flows alike, lives beside the flow data and never in the
 * outputs folder: every .md under outputs is read as a conversation (the list, search, stats, the
 * backup). One folder, so factory reset and the backup take or drop all of it at once.
 */
export const HISTORY_DIR_NAME = 'history';

export function historyRoot(): string {
  return path.join(getFlowDataDir(), HISTORY_DIR_NAME);
}

export function conversationHistoryRoot(): string {
  return path.join(historyRoot(), 'conversations');
}

export function flowHistoryRoot(): string {
  return path.join(historyRoot(), 'flows');
}
