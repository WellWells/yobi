import type { MenuItemConstructorOptions } from 'electron';
import type { ConversationMenuCommand, ConversationMenuTarget } from '../shared/conversationMenu';

/*
 * The macOS menu bar's Conversation menu. Apple's HIG puts every context-menu command in the menu
 * bar too, where it can be found by browsing and by Help's search. The items act on the
 * conversation open in the main window, which the renderer reports (`IPC.CONVERSATION_MENU_STATE`);
 * a click only names the command, and the renderer runs the sidebar's own handler for it, so
 * nothing here duplicates what a delete or a pin does. No item carries an accelerator: the keys
 * belong to the shortcut registry (see `appMenu.ts`).
 */

export interface ConversationMenuState {
  /** A main window renderer is there to run commands (and has reported at least once). */
  attached: boolean;
  open: ConversationMenuTarget | null;
}

export interface ConversationMenuContext {
  label: (key: string) => string;
  state: ConversationMenuState;
  /** `folder` only for `moveToFolder`: the destination name, '' for the top level. */
  run: (command: ConversationMenuCommand, folder?: string) => void;
}

/** One group of items; the menu puts a separator between groups and drops empty ones. */
export type ConversationMenuSection = (ctx: ConversationMenuContext) => MenuItemConstructorOptions[];

const DETACHED: ConversationMenuState = { attached: false, open: null };

let state: ConversationMenuState = DETACHED;
const listeners = new Set<() => void>();

export function getConversationMenuState(): ConversationMenuState {
  return state;
}

/** Records what the renderer reported; listeners (the menu rebuild) hear only real changes. */
export function setConversationMenuState(next: ConversationMenuState): void {
  const same = next.attached === state.attached
    && next.open?.path === state.open?.path
    && next.open?.pinned === state.open?.pinned
    && next.open?.folder === state.open?.folder
    && JSON.stringify(next.open?.folders ?? []) === JSON.stringify(state.open?.folders ?? []);
  if (same) return;
  state = next;
  for (const listener of listeners) listener();
}

/** The renderer went away (window closed or reloading): nothing to act on until it reports again. */
export function detachConversationMenu(): void {
  setConversationMenuState(DETACHED);
}

export function onConversationMenuChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function item(ctx: ConversationMenuContext, key: string, command: ConversationMenuCommand, enabled: boolean): MenuItemConstructorOptions {
  return { label: ctx.label(key), enabled, click: () => ctx.run(command) };
}

const newSection: ConversationMenuSection = (ctx) => [
  item(ctx, 'menu.conversation.new', 'new', ctx.state.attached),
];

const pinSection: ConversationMenuSection = (ctx) => {
  const open = ctx.state.open;
  return [
    item(ctx, open?.pinned ? 'menu.conversation.unpin' : 'menu.conversation.pin', 'togglePin', open !== null),
    item(ctx, 'menu.conversation.editTitle', 'editTitle', open !== null),
  ];
};

const fileSection: ConversationMenuSection = (ctx) => {
  const enabled = ctx.state.open !== null;
  return [
    item(ctx, 'menu.conversation.reveal', 'reveal', enabled),
    {
      label: ctx.label('menu.conversation.export'),
      enabled,
      submenu: [
        item(ctx, 'menu.conversation.export.pdf', 'exportPdf', enabled),
        item(ctx, 'menu.conversation.export.png', 'exportPng', enabled),
        item(ctx, 'menu.conversation.export.markdown', 'exportMarkdown', enabled),
      ],
    },
  ];
};

/** Move to Folder ▸: the other folders, Move Out when in one, then New Folder… (as in the sidebar). */
const folderSection: ConversationMenuSection = (ctx) => {
  const open = ctx.state.open;
  const others = (open?.folders ?? []).filter((folder) => folder.name !== open?.folder);
  const submenu: MenuItemConstructorOptions[] = others.map((folder) => ({
    label: folder.label,
    click: () => ctx.run('moveToFolder', folder.name),
  }));
  if (open?.folder) submenu.push({ label: ctx.label('context.moveOutOfFolder'), click: () => ctx.run('moveToFolder', '') });
  if (submenu.length > 0) submenu.push({ type: 'separator' });
  submenu.push(item(ctx, 'context.newFolderEllipsis', 'moveToNewFolder', open !== null));
  return [{ label: ctx.label('context.moveToFolder'), enabled: open !== null, submenu }];
};

const deleteSection: ConversationMenuSection = (ctx) => [
  item(ctx, 'menu.conversation.delete', 'delete', ctx.state.open !== null),
];

/**
 * The menu's groups, top to bottom. This is the extension point: a new group of commands on the
 * open conversation is one more section here, before the delete group.
 */
export const CONVERSATION_MENU_SECTIONS: readonly ConversationMenuSection[] = [
  newSection,
  pinSection,
  folderSection,
  fileSection,
  deleteSection,
];

export function buildConversationMenuItems(
  ctx: ConversationMenuContext,
  sections: readonly ConversationMenuSection[] = CONVERSATION_MENU_SECTIONS,
): MenuItemConstructorOptions[] {
  const groups = sections.map((section) => section(ctx)).filter((group) => group.length > 0);
  return groups.flatMap((group, index) => (index === 0 ? group : [{ type: 'separator' as const }, ...group]));
}
