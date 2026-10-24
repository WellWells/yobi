import { IPC } from '../../shared/types';
import type { ConversationMenuCommandEvent } from '../../shared/conversationMenu';
import { installAppMenu } from '../appMenu';
import type { AppMenuDeps } from '../appMenu';
import { onConversationMenuChange } from '../conversationMenu';
import { sendToRenderer, setMainWindow, setSettingsCategoryReveal } from '../helpers';
import { createMainWindow, getMainWin } from '../windows';

/**
 * The menu bar stays Yobi's after the window is closed on macOS (the app keeps running), so
 * Settings… may have no window to show. A fresh window only hears the request once its
 * renderer has loaded. `category` opens that settings page (a notification's click).
 */
function openSettings(category?: string): void {
  const navigate = (): void => {
    if (category) sendToRenderer(IPC.NAVIGATE_SETTINGS, category);
    else sendToRenderer(IPC.NAVIGATE_SETTINGS);
  };
  let win = getMainWin();
  if (!win || win.isDestroyed()) {
    createMainWindow();
    win = getMainWin();
    setMainWindow(win);
    win?.webContents.once('did-finish-load', navigate);
  } else {
    navigate();
  }
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/**
 * A Conversation menu click: the window comes forward (it may be hidden to the tray) and its
 * renderer runs the command. The items are disabled while no renderer has reported, so there is a
 * window to send to.
 */
function runConversationCommand(event: ConversationMenuCommandEvent): void {
  const win = getMainWin();
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  sendToRenderer(IPC.CONVERSATION_MENU_COMMAND, event);
}

const deps: AppMenuDeps = {
  onOpenSettings: () => openSettings(),
  onConversationCommand: runConversationCommand,
};
let rebuildOnConversationChange = false;

export function setupAppMenu(): void {
  installAppMenu(deps);
  setSettingsCategoryReveal((category) => openSettings(category));
  if (rebuildOnConversationChange) return;
  rebuildOnConversationChange = true;
  // The Conversation menu's items follow the open conversation (enabled, Pin or Unpin).
  onConversationMenuChange(() => installAppMenu(deps));
}
