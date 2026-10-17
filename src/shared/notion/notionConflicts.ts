import { fnv1a } from '../fnv1a';
import { diffBlocks, mapIndex, nearestRun, rangesTouch, runAt, type BlockHunk, type MergeConflict } from './notionDiff';

/*
 * Conflicts between a Notion document and its page, told apart by place. A conflict sits at `at`
 * in Notion's text (the base) and near `localAt` in the local text; text alone would match the
 * first copy of a repeated list item or "<empty-block/>" anywhere on the page.
 */

/** A conflict's id for the renderer: its place and its three texts, so a stale list cannot pick another. */
export function conflictKey(conflict: MergeConflict): string {
  return `${conflict.at}-${fnv1a([conflict.base, conflict.local, conflict.remote].map((side) => side.join('\n')).join('\u0000'))}`;
}

/** The base range a conflict holds in Notion's text. */
function remoteRange(conflict: MergeConflict): { start: number; end: number } {
  return { start: conflict.at, end: conflict.at + conflict.remote.length };
}

/**
 * Conflicts still standing: Notion's side is still where it was, and the user's side is still in
 * the local text (found nearest its old place, which edits above it move). One the user edited
 * away (merging by hand) is settled and dropped.
 */
export function liveConflicts(conflicts: readonly MergeConflict[], local: readonly string[], base: readonly string[]): MergeConflict[] {
  const live: MergeConflict[] = [];
  for (const conflict of conflicts) {
    if (!runAt(base, conflict.remote, conflict.at)) continue;
    if (conflict.local.length === 0) {
      live.push({ ...conflict, localAt: Math.min(conflict.localAt, local.length) });
      continue;
    }
    const localAt = nearestRun(local, conflict.local, conflict.localAt);
    if (localAt >= 0) live.push({ ...conflict, localAt });
  }
  return live;
}

/** Whether a pending change reaches into a conflict: such a change waits until the user decides. */
export function hunkInConflict(hunk: BlockHunk, conflicts: readonly MergeConflict[]): boolean {
  return conflicts.some((conflict) => rangesTouch(hunk, remoteRange(conflict)));
}

/**
 * Conflicts from before a merge, carried over to Notion's new text: kept where their place in
 * Notion's text was left alone, moved by what changed above it. One whose place Notion changed
 * again is dropped (the merge raises it anew if the user's side still differs).
 */
export function carryConflicts(
  conflicts: readonly MergeConflict[],
  oldBase: readonly string[],
  newBase: readonly string[],
  merged: readonly string[],
): MergeConflict[] {
  if (conflicts.length === 0) return [];
  const changes = diffBlocks(oldBase, newBase);
  const carried: MergeConflict[] = [];
  for (const conflict of conflicts) {
    const at = mapIndex(conflict.at, conflict.remote.length, changes);
    if (at === null || !runAt(newBase, conflict.remote, at)) continue;
    if (conflict.local.length === 0) {
      carried.push({ ...conflict, at, localAt: Math.min(conflict.localAt, merged.length) });
      continue;
    }
    const localAt = nearestRun(merged, conflict.local, conflict.localAt);
    if (localAt >= 0) carried.push({ ...conflict, at, localAt });
  }
  return carried;
}

/** The local blocks with Notion's side of a conflict in place of the user's; null if it cannot be placed. */
export function withTheirs(local: readonly string[], conflict: MergeConflict): string[] | null {
  if (conflict.local.length === 0) {
    const at = Math.min(Math.max(conflict.localAt, 0), local.length);
    return [...local.slice(0, at), ...conflict.remote, ...local.slice(at)];
  }
  if (!runAt(local, conflict.local, conflict.localAt)) return null;
  const at = conflict.localAt;
  return [...local.slice(0, at), ...conflict.remote, ...local.slice(at + conflict.local.length)];
}

/** Conflicts listed once each (a merge may raise one that was carried over too). */
export function uniqueConflicts(conflicts: readonly MergeConflict[]): MergeConflict[] {
  const seen = new Set<string>();
  return conflicts.filter((conflict) => {
    const key = conflictKey(conflict);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
