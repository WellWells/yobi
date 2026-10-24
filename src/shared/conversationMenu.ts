/*
 * The macOS menu bar's Conversation menu (Apple HIG: every context-menu command is also in the
 * menu bar). The renderer reports which conversation is open; main builds the menu from that and
 * sends a clicked command back, and the renderer runs the sidebar's own handler for it. Pure.
 */

export const CONVERSATION_MENU_COMMANDS = [
  'new',
  'togglePin',
  'editTitle',
  'reveal',
  'exportPdf',
  'exportPng',
  'exportMarkdown',
  'moveToFolder',
  'moveToNewFolder',
  'delete',
] as const;

export type ConversationMenuCommand = typeof CONVERSATION_MENU_COMMANDS[number];

/** A folder the open conversation can move into: its name on disk and the name the sidebar shows. */
export interface ConversationMenuFolder {
  name: string;
  label: string;
}

/** The conversation open in the main window: what the menu's items act on. */
export interface ConversationMenuTarget {
  path: string;
  pinned: boolean;
  /** The folder it is in, null at the top level. */
  folder: string | null;
  /** Every folder, in the sidebar's order (Move to Folder ▸ lists the others). */
  folders: ConversationMenuFolder[];
}

/** A click on the menu, sent back to the renderer with the path the menu was built for. */
export interface ConversationMenuCommandEvent {
  command: ConversationMenuCommand;
  /** Null for commands that need no conversation (New Conversation). */
  path: string | null;
  /** `moveToFolder`'s destination: a folder name, '' for the top level. */
  folder?: string;
}

/** More folders than a menu should list; the sidebar's own menu is the place for those. */
export const CONVERSATION_MENU_FOLDER_CAP = 100;

function parseMenuFolders(value: unknown): ConversationMenuFolder[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  const folders: ConversationMenuFolder[] = [];
  for (const entry of value.slice(0, CONVERSATION_MENU_FOLDER_CAP)) {
    if (!entry || typeof entry !== 'object') return undefined;
    const { name, label } = entry as Record<string, unknown>;
    if (typeof name !== 'string' || !name || typeof label !== 'string') return undefined;
    folders.push({ name, label: label || name });
  }
  return folders;
}

export function isConversationMenuCommand(value: unknown): value is ConversationMenuCommand {
  return typeof value === 'string' && (CONVERSATION_MENU_COMMANDS as readonly string[]).includes(value);
}

/** The renderer's report: a target, null for "none open", undefined when it makes no sense. */
export function parseConversationMenuTarget(value: unknown): ConversationMenuTarget | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== 'object') return undefined;
  const { path, pinned, folder, folders } = value as Record<string, unknown>;
  if (typeof path !== 'string' || !path || typeof pinned !== 'boolean') return undefined;
  if (folder !== undefined && folder !== null && typeof folder !== 'string') return undefined;
  const parsedFolders = parseMenuFolders(folders);
  if (!parsedFolders) return undefined;
  return { path, pinned, folder: typeof folder === 'string' && folder ? folder : null, folders: parsedFolders };
}
