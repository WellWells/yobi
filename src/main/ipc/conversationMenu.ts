import { ipcMain } from 'electron';
import type { WebContents } from 'electron';
import { IPC } from '../../shared/types';
import { parseConversationMenuTarget } from '../../shared/conversationMenu';
import { detachConversationMenu, setConversationMenuState } from '../conversationMenu';

/*
 * The renderer reports the conversation open in the main window, for the macOS menu bar's
 * Conversation menu. Only what it needs: the path the commands go back with, and whether it is
 * pinned (the label). A malformed report changes nothing; a renderer that goes away disables it.
 */

const watched = new WeakSet<WebContents>();

function detachWhenGone(sender: WebContents | undefined): void {
  if (!sender || typeof sender.once !== 'function' || watched.has(sender)) return;
  watched.add(sender);
  // A closed window has nothing to act on; a reloaded page simply reports again once it mounts.
  sender.once('destroyed', detachConversationMenu);
}

export function reportConversationMenuTarget(raw: unknown, sender?: WebContents): boolean {
  const open = parseConversationMenuTarget(raw);
  if (open === undefined) return false;
  detachWhenGone(sender);
  setConversationMenuState({ attached: true, open });
  return true;
}

export function registerConversationMenuHandlers(): void {
  ipcMain.handle(IPC.CONVERSATION_MENU_STATE, (event, raw: unknown) => reportConversationMenuTarget(raw, event.sender));
}
