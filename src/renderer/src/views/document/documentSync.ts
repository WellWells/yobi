import type { NotionDocStatus, NotionPendingChange, NotionSyncError } from '../../../../shared/notion/notionSyncTypes';

/** How often an open document asks Notion whether the page changed. */
export const NOTION_PULL_INTERVAL_MS = 120_000;

/** The window coming back to the front reads the page again, but not more often than this. */
export const NOTION_FOCUS_PULL_GAP_MS = 30_000;

/** The one line the header shows about the document's sync. */
export type SyncLine =
  | { kind: 'busy' }
  | { kind: 'notConnected' }
  | { kind: 'unsynced' }
  | { kind: 'conflicts'; count: number }
  | { kind: 'locked'; count: number }
  | { kind: 'error'; error: NotionSyncError }
  | { kind: 'synced'; at: string | null };

/** Changes a sync sends: not a table or child page, not waiting on a conflict. */
export function sendableChanges(status: NotionDocStatus | null): NotionPendingChange[] {
  return status?.pending.filter((change) => !change.locked && !change.conflict) ?? [];
}

/** How many places the header's sync button sends (the page title counts as one); 0 hides it. */
export function sendCount(status: NotionDocStatus | null): number {
  if (!status?.connected || status.unsynced) return 0;
  return sendableChanges(status).length + (status.titleChange ? 1 : 0);
}

/**
 * The header's line beside the title. Changes that can be sent are the sync button's to tell, so
 * there is no line for them; changes that cannot (a table, a child page) are said here.
 */
export function syncLine(status: NotionDocStatus | null, busy: boolean): SyncLine | null {
  if (busy) return { kind: 'busy' };
  if (!status) return null;
  if (!status.connected) return { kind: 'notConnected' };
  if (status.conflicts.length > 0) return { kind: 'conflicts', count: status.conflicts.length };
  if (status.unsynced) return { kind: 'unsynced' };
  if (sendCount(status) > 0) return null;
  const locked = status.pending.filter((change) => change.locked).length;
  if (locked > 0) return { kind: 'locked', count: locked };
  if (status.lastError) return { kind: 'error', error: status.lastError };
  return { kind: 'synced', at: status.syncedAt };
}

/**
 * Whether reading the page now is safe. Not while the user edits (the merge would move the text
 * under their caret) and not while a sync runs (it reads the page itself when done).
 */
export function canPull(state: { editing: boolean; busy: boolean; visible: boolean }): boolean {
  return state.visible && !state.editing && !state.busy;
}
