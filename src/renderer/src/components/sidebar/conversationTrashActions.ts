import type { OutputFile, TrashBusyFile, TrashResult } from '../../../../shared/types';
import { conversationMoveKey } from '../../../../shared/conversationMove';
import type { ConversationBusyReason } from '../../../../shared/conversationMove';
import { fillTemplate } from '../../../../shared/fillTemplate';
import type { AppNotice } from '../../hooks/useUiNotifications';

/*
 * Deleting a conversation moves it to Recently Deleted without asking; a notice offers to take it
 * back for a moment, and the undo restores exactly that batch. The parts here take their
 * boundaries as arguments.
 */

export interface TrashActionDeps {
  trash: (paths: string[]) => Promise<TrashResult>;
  restore: (trashIds: string[]) => Promise<string[]>;
  notify: (notice: AppNotice) => unknown;
  t: (key: string) => string;
}

const DAY_MS = 24 * 60 * 60_000;

/** Puts a batch back. Says so when some of it could not come back. Resolves to the restored paths. */
export async function undoTrash(trashIds: readonly string[], deps: TrashActionDeps): Promise<string[]> {
  const restored = await deps.restore([...trashIds]).catch((): string[] => []);
  if (restored.length < trashIds.length) deps.notify({ level: 'error', message: deps.t('trash.restoreFailed') });
  return restored;
}

/** One notice per reason a file was left in place, in the order they first appear. */
export function busyNoticeReasons(busy: readonly TrashBusyFile[]): ConversationBusyReason[] {
  return [...new Set(busy.map((item) => item.reason))];
}

/**
 * The paths that actually went to Recently Deleted: none when nothing moved, else every asked
 * path that main did not report as failed or busy. Only these close or lose focus in the list.
 */
export function trashedPaths(paths: readonly string[], result: TrashResult): string[] {
  if (result.trashIds.length === 0) return [];
  const kept = new Set([...result.failed, ...result.busy.map((item) => item.path)].map(conversationMoveKey));
  return paths.filter((filePath) => !kept.has(conversationMoveKey(filePath)));
}

/**
 * Moves conversations to Recently Deleted and raises the notice whose undo restores this batch.
 * `failed` lists what could not be moved: the caller asks before deleting those for good. A file
 * something is still writing to stays where it is, with a notice saying to wait for it; the undo
 * covers only what moved.
 */
export async function moveConversationsToTrash(paths: readonly string[], deps: TrashActionDeps): Promise<TrashResult> {
  const result = await deps.trash([...paths]).catch((): TrashResult | null => null);
  if (!result) {
    deps.notify({ level: 'error', message: deps.t('trash.moveFailed') });
    return { trashIds: [], failed: [], busy: [] };
  }
  for (const reason of busyNoticeReasons(result.busy)) {
    deps.notify({ level: 'warning', message: deps.t(`trash.busy.${reason}`) });
  }
  if (result.trashIds.length === 0) return result;
  const batch = [...result.trashIds];
  deps.notify({
    level: 'success',
    message: batch.length === 1 ? deps.t('trash.moved') : fillTemplate(deps.t('trash.movedMany'), { count: batch.length }),
    undo: { label: deps.t('trash.undo'), run: () => { void undoTrash(batch, deps); } },
  });
  return result;
}

/** The row after `path` that is not being removed, else the one before; null when none is left. */
export function neighbourAfterRemoval(
  files: readonly OutputFile[],
  path: string,
  removed: ReadonlySet<string>,
): OutputFile | null {
  const index = files.findIndex((file) => file.path === path);
  if (index < 0) return null;
  for (let i = index + 1; i < files.length; i += 1) if (!removed.has(files[i].path)) return files[i];
  for (let i = index - 1; i >= 0; i -= 1) if (!removed.has(files[i].path)) return files[i];
  return null;
}

/**
 * What to show once conversations are removed: `undefined` when the open one stays, otherwise the
 * neighbour to open (one row deleted) or null to close it (a batch).
 */
export function openAfterRemoval(
  files: readonly OutputFile[],
  openPath: string | null | undefined,
  removed: ReadonlySet<string>,
  openNeighbour: boolean,
): OutputFile | null | undefined {
  if (!openPath || !removed.has(openPath)) return undefined;
  return openNeighbour ? neighbourAfterRemoval(files, openPath, removed) : null;
}

/** Whole days until the sweep deletes it, never below 1 while it is still listed. */
export function daysUntilPurge(expiresAt: string, now: number): number {
  const left = Date.parse(expiresAt) - now;
  if (Number.isNaN(left)) return 1;
  return Math.max(1, Math.ceil(left / DAY_MS));
}
