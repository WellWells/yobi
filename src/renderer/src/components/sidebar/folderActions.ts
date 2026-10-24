import type { OutputFile } from '../../../../shared/types';
import type {
  ConversationFolder,
  FolderActionError,
  FolderActionResult,
  FolderDeleteResult,
} from '../../../../shared/conversationFolders';
import { folderKey, systemFolderLabelKey } from '../../../../shared/conversationFolders';
import type { ConversationMoveResult } from '../../../../shared/conversationMove';
import { fillTemplate } from '../../../../shared/fillTemplate';
import type { AppNotice } from '../../hooks/useUiNotifications';
import type { SidebarRow } from '../../utils/timeGroups';

/*
 * The sidebar's folder actions, with their boundaries (main, notices, translations) passed in.
 * Moving and deleting do not ask, as in Apple Notes: a refusal or failure says why in a notice,
 * and deleting a folder raises the same undo notice deleting a conversation does.
 */

type Translate = (key: string) => string;

/** What a folder is shown as: Yobi's flow results under a translated name, every other one as named. */
export function folderLabel(name: string, t: Translate): string {
  const key = systemFolderLabelKey(name);
  return key ? t(key) : name;
}

/** `base`, else `base 2`, `base 3`… — the first one no folder has (any case), as Finder names a new folder. */
export function uniqueFolderName(base: string, existing: readonly string[]): string {
  const taken = new Set(existing.map(folderKey));
  if (!taken.has(folderKey(base))) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base} ${n}`;
    if (!taken.has(folderKey(candidate))) return candidate;
  }
}

/** The message for a folder change main refused or could not do. */
export function folderErrorMessage(error: FolderActionError | undefined, t: Translate): string {
  switch (error) {
    case 'missing': return t('sidebar.folder.missing');
    case 'busy': return t('sidebar.folder.renameBusy');
    case 'failed':
    case undefined: return t('sidebar.folder.failed');
    default: return t(`sidebar.folder.invalid.${error}`);
  }
}

/**
 * The notice for a move that did not fully happen, or null when every file moved (or was already
 * there). A busy file says what it is busy with; failures only say they failed (the cause is in the log).
 */
export function moveResultNotice(result: ConversationMoveResult, t: Translate): AppNotice | null {
  if (result.error) return { level: 'error', message: t('chat.move.failed') };
  const refused = result.outcomes.filter((outcome) => outcome.status !== 'moved' && outcome.status !== 'unchanged');
  if (refused.length === 0) return null;
  const busy = refused.filter((outcome) => outcome.status === 'busy');
  if (busy.length === refused.length) {
    const [first] = busy;
    if (busy.length === 1 && first?.status === 'busy') return { level: 'error', message: t(`chat.move.busy.${first.reason}`) };
    return { level: 'error', message: fillTemplate(t('chat.move.busyMany'), { count: busy.length }) };
  }
  if (refused.every((outcome) => outcome.status === 'missing')) return { level: 'error', message: t('chat.move.missing') };
  return { level: 'error', message: fillTemplate(t('chat.move.failedMany'), { count: refused.length }) };
}

export interface MoveMenuModel {
  /** Folders the conversations can go to. */
  targets: ConversationFolder[];
  /** 「移出資料夾」: some of them are in a folder. */
  canMoveOut: boolean;
}

/**
 * What 「移至資料夾 ▸」 offers for these conversations: every folder except the one they are all
 * already in, and 「移出資料夾」 when any of them is in one.
 */
export function moveMenuModel(files: readonly Pick<OutputFile, 'folder'>[], folders: readonly ConversationFolder[]): MoveMenuModel {
  const keys = new Set(files.map((file) => (file.folder ? folderKey(file.folder) : '')));
  const sharedFolder = keys.size === 1 ? [...keys][0] : null;
  return {
    targets: folders.filter((folder) => folderKey(folder.name) !== sharedFolder),
    canMoveOut: files.some((file) => Boolean(file.folder)),
  };
}

/**
 * Where a drop on a row files the dragged conversations: a folder row or a conversation shown
 * inside a folder = that folder, a top-level conversation or time group = the top level (`''`).
 * The pinned group belongs to no folder: dropping there does nothing (null).
 */
export function dropTargetForRow(row: SidebarRow | undefined): string | null {
  if (!row) return null;
  if (row.kind === 'folder') return row.folder.name;
  if (row.kind === 'header') return row.key === 'pinned' ? null : '';
  if (row.file.pinned && !row.inFolder) return null;
  return row.inFolder ?? '';
}

/** The dragged conversations that a drop on `target` would actually move: those not already there. */
export function pathsToMove(dragged: readonly Pick<OutputFile, 'path' | 'folder'>[], target: string): string[] {
  const key = target ? folderKey(target) : '';
  return dragged.filter((file) => (file.folder ? folderKey(file.folder) : '') !== key).map((file) => file.path);
}

export interface FolderDeleteDeps {
  remove: (name: string) => Promise<FolderDeleteResult>;
  /** Makes the deleted folder again: the undo of an empty one, which may be a system folder. */
  create: (name: string) => Promise<FolderActionResult>;
  restore: (trashIds: string[]) => Promise<string[]>;
  notify: (notice: AppNotice) => unknown;
  t: Translate;
}

/**
 * Deletes a folder without asking. Its conversations go to Recently Deleted and the notice's undo
 * brings that batch back — the folder with them (restoring makes it again), or on its own when it
 * was empty. What stayed behind (busy conversations, other files) is said in the same notice.
 */
export async function deleteFolderWithNotice(name: string, label: string, deps: FolderDeleteDeps): Promise<FolderDeleteResult | null> {
  const result = await deps.remove(name).catch((): null => null);
  if (!result || !result.ok) {
    deps.notify({ level: 'error', message: deps.t(result?.error === 'missing' ? 'sidebar.folder.missing' : 'sidebar.folder.failed') });
    return result;
  }
  const batch = [...result.trashIds];
  const notes: string[] = [];
  if (result.busy > 0) notes.push(fillTemplate(deps.t('sidebar.folder.deleteBusy'), { count: result.busy }));
  if (result.failed > 0) notes.push(fillTemplate(deps.t('sidebar.folder.deleteFailed'), { count: result.failed }));
  if (!result.removed && result.busy === 0 && result.failed === 0) notes.push(deps.t('sidebar.folder.keptOtherFiles'));
  const canUndo = batch.length > 0 || result.removed;
  deps.notify({
    level: notes.length > 0 ? 'warning' : 'success',
    title: fillTemplate(deps.t('sidebar.folder.deleted'), { name: label }),
    message: notes.length > 0 ? notes.join(' ') : deps.t('sidebar.folder.deletedDetail'),
    ...(canUndo ? {
      undo: {
        label: deps.t('trash.undo'),
        run: () => {
          void (async () => {
            if (batch.length === 0) {
              const made = await deps.create(name).catch((): null => null);
              if (!made?.ok) deps.notify({ level: 'error', message: folderErrorMessage(made?.error, deps.t) });
              return;
            }
            const restored = await deps.restore(batch).catch((): string[] => []);
            if (restored.length < batch.length) deps.notify({ level: 'error', message: deps.t('trash.restoreFailed') });
          })();
        },
      },
    } : {}),
  });
  return result;
}
