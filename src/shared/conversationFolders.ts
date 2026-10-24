/*
 * Conversation folders: real folders directly inside outputs, one level, like Apple Notes'. Main
 * makes and changes them (`src/main/conversationFolders.ts`); this module holds what both sides
 * need to agree on. Pure.
 */

/**
 * Folders Yobi files conversations into by itself. The names on disk are fixed; only `Flows` is
 * shown under a translated label (Telegram and LINE are brand names).
 */
export const SYSTEM_FOLDERS = {
  telegram: 'Telegram',
  line: 'LINE',
  discord: 'Discord',
  slack: 'Slack',
  flows: 'Flows',
} as const;

export type SystemFolderName = typeof SYSTEM_FOLDERS[keyof typeof SYSTEM_FOLDERS];

export interface ConversationFolder {
  /** The folder's name on disk. */
  name: string;
  /** One of `SYSTEM_FOLDERS`: Yobi writes into it, so it cannot be renamed. */
  system: boolean;
}

export const FOLDER_NAME_MAX = 64;

/** Why a folder name cannot be used. Each has its own message (`sidebar.folder.invalid.<problem>`). */
export type FolderNameProblem =
  | 'empty'
  | 'tooLong'
  | 'invalidChars'
  | 'leadingDot'
  | 'trailingDotOrSpace'
  | 'reserved'
  | 'system'
  | 'duplicate';

/** What a folder change ran into; a name problem, or the reasons main itself refuses. */
export type FolderActionError = FolderNameProblem | 'missing' | 'busy' | 'failed';

export interface FolderActionResult {
  ok: boolean;
  /** The folder's name afterwards (create, rename). */
  name?: string;
  error?: FolderActionError;
}

export interface FolderDeleteResult {
  ok: boolean;
  /** The conversations now in Recently Deleted; restoring exactly these undoes the delete. */
  trashIds: string[];
  /** Conversations left in the folder because something was about to write to them. */
  busy: number;
  /** Conversations that could not be moved to Recently Deleted. */
  failed: number;
  /** The folder itself is gone. False when something is left in it (other files, busy ones). */
  removed: boolean;
  error?: 'missing' | 'failed';
}

// Characters Windows refuses in a name, and control characters.
const INVALID_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** How a typed name is stored: trimmed, in one Unicode form. */
export function normalizeFolderName(raw: string): string {
  return typeof raw === 'string' ? raw.normalize('NFC').trim() : '';
}

/** One spelling per folder: names on Windows and macOS ignore case. */
export function folderKey(name: string): string {
  return name.normalize('NFC').toLowerCase();
}

export function isSystemFolder(name: string): boolean {
  const key = folderKey(name);
  return Object.values(SYSTEM_FOLDERS).some((system) => folderKey(system) === key);
}

/**
 * The problem with `raw` as a folder name among `existing`, or null when it can be used.
 * `renaming` is the folder being renamed: it does not collide with itself (a change of case is fine).
 */
export function folderNameProblem(
  raw: string,
  existing: readonly string[],
  renaming?: string,
): FolderNameProblem | null {
  const name = normalizeFolderName(raw);
  if (!name) return 'empty';
  if ([...name].length > FOLDER_NAME_MAX) return 'tooLong';
  if (INVALID_CHARS.test(name)) return 'invalidChars';
  if (name.startsWith('.')) return 'leadingDot';
  if (/[. ]$/.test(name)) return 'trailingDotOrSpace';
  if (WINDOWS_RESERVED.test(name)) return 'reserved';
  const key = folderKey(name);
  const own = renaming === undefined ? null : folderKey(renaming);
  if (isSystemFolder(name) && key !== own) return 'system';
  if (existing.some((other) => folderKey(other) === key && folderKey(other) !== own)) return 'duplicate';
  return null;
}

/**
 * The system folder a bot chat's new conversation goes into, from the name label the bot gives it
 * (`tg-Alice`, `line-Bob`; see `botFileLabel`), or null for any other file.
 */
export function botConversationFolder(fileLabel: string | undefined): SystemFolderName | null {
  if (!fileLabel) return null;
  if (fileLabel === 'tg' || fileLabel.startsWith('tg-')) return SYSTEM_FOLDERS.telegram;
  if (fileLabel === 'line' || fileLabel.startsWith('line-')) return SYSTEM_FOLDERS.line;
  if (fileLabel === 'discord' || fileLabel.startsWith('discord-')) return SYSTEM_FOLDERS.discord;
  if (fileLabel === 'slack' || fileLabel.startsWith('slack-')) return SYSTEM_FOLDERS.slack;
  return null;
}

/**
 * The folder a conversation belongs to, from its path relative to outputs (either separator): the
 * first segment, so a file nested deeper (made in Explorer/Finder) belongs to its top folder.
 * Undefined at the top level.
 */
export function folderOfRelativePath(relative: string): string | undefined {
  const segments = relative.split(/[\\/]+/).filter(Boolean);
  return segments.length > 1 ? segments[0] : undefined;
}

/** The i18n key of a system folder's shown name, or null when it is shown as it is named. */
export function systemFolderLabelKey(name: string): string | null {
  return folderKey(name) === folderKey(SYSTEM_FOLDERS.flows) ? 'sidebar.folder.system.flows' : null;
}
