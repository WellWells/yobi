import type { FolderActionError, FolderActionResult } from './conversationFolders';
import { FOLDER_NAME_MAX, folderKey, normalizeFolderName } from './conversationFolders';
import type { FlowDefinition } from './types';

/*
 * Flow folders: one level of folders in the flow sidebar, like the chat sidebar's. They are not
 * folders on disk: which flow is in which folder is kept in `flow-folders.json` beside
 * `flows.json`, never in the flow itself (the editor's unsaved copy of a flow would carry a stale
 * folder back on Save). The order inside a folder is `flows.json`'s order. Pure.
 */

export const FLOW_FOLDERS_FILE = 'flow-folders.json';

export interface FlowFolder {
  /** As the user typed it (trimmed, NFC). Unique ignoring case. */
  name: string;
  /** The flows in it. Their order means nothing: the flows are drawn in `flows.json` order. */
  flowIds: string[];
}

export type FlowFolderResult = FolderActionResult;

export interface FlowFolderDeleteResult {
  ok: boolean;
  /** The flows that were in it, now at the top level; filing exactly these back undoes the delete. */
  flowIds: string[];
  error?: 'missing' | 'failed';
}

export interface FlowFolderMoveResult {
  ok: boolean;
  /** Every flow in its new order, when the move changed `flows.json`'s order. */
  flows?: FlowDefinition[];
  error?: FolderActionError;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * The folders in a parsed `flow-folders.json`, or null when it is not that file's shape. Entries
 * with an unusable name, a name already taken (any case) or no list are dropped; an id already
 * filed in an earlier folder stays there.
 */
export function parseFlowFolders(raw: unknown): FlowFolder[] | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const list = (raw as { folders?: unknown }).folders;
  if (!Array.isArray(list)) return null;
  const names = new Set<string>();
  const filed = new Set<string>();
  const folders: FlowFolder[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const { name: rawName, flowIds: rawIds } = entry as { name?: unknown; flowIds?: unknown };
    const name = isString(rawName) ? normalizeFolderName(rawName) : '';
    if (!name || [...name].length > FOLDER_NAME_MAX || names.has(folderKey(name))) continue;
    names.add(folderKey(name));
    const flowIds: string[] = [];
    for (const id of Array.isArray(rawIds) ? rawIds : []) {
      if (!isString(id) || !id || filed.has(id)) continue;
      filed.add(id);
      flowIds.push(id);
    }
    folders.push({ name, flowIds });
  }
  return folders;
}

/**
 * `order` (every flow id, `flows.json`'s order) with `moving` placed for its new home `target`
 * (a folder's name, `''` = the top level). `folderOf` answers for after the move. With `before`
 * (a flow not moving), they go right before it — a drop on that row. Otherwise they go after the
 * last flow already there; into an empty folder nothing needs to move, so `order` is returned as
 * it was. The moving flows keep their own order.
 */
export function placeFlows(
  order: readonly string[],
  folderOf: (id: string) => string,
  moving: readonly string[],
  target: string,
  before?: string,
): string[] {
  const movingSet = new Set(moving);
  const moved = order.filter((id) => movingSet.has(id));
  if (moved.length === 0) return [...order];
  const rest = order.filter((id) => !movingSet.has(id));
  const beforeIndex = before === undefined ? -1 : rest.indexOf(before);
  if (beforeIndex >= 0) return [...rest.slice(0, beforeIndex), ...moved, ...rest.slice(beforeIndex)];
  const targetKey = folderKey(target);
  let lastIndex = -1;
  rest.forEach((id, index) => { if (folderKey(folderOf(id)) === targetKey) lastIndex = index; });
  if (lastIndex >= 0) return [...rest.slice(0, lastIndex + 1), ...moved, ...rest.slice(lastIndex + 1)];
  return target === '' ? [...rest, ...moved] : [...order];
}
