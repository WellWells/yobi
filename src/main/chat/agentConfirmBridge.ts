import type { BrowserWindow } from 'electron';
import { IPC } from '../../shared/types';
import type { AgentConfirmChoice, AgentConfirmPayload, AgentConfirmRequestData } from '../../shared/types';
import { createEntityId } from '../flow/flowPersistence';
import { sendLog } from '../helpers';

/*
 * Asks the RENDERER for an approval instead of raising Electron's native message box. A native
 * dialog is an OS window with none of the app's typography, theme or spacing, and next to Yobi's
 * UI it reads as something else entirely — so every user-facing prompt round-trips to the
 * renderer and is drawn with the app's own components.
 */

type Pending = (choice: AgentConfirmChoice) => void;

const pending = new Map<string, Pending>();

/** Records the renderer's answer. Unknown ids are ignored — a late reply is not an error. */
export function resolveAgentConfirm(id: string, choice: AgentConfirmChoice): void {
  const resolve = pending.get(id);
  if (!resolve) return;
  pending.delete(id);
  resolve(choice);
}

/**
 * Fails every waiting prompt closed. Called when the window that was asked goes away: a prompt
 * whose dialog no longer exists can never be answered, and leaving the agent blocked on it would
 * hold the serial queue open behind a question nobody can see.
 */
export function cancelAllAgentConfirms(reason: string): void {
  if (pending.size === 0) return;
  sendLog(`🔒 [Agent] ${pending.size} pending confirmation(s) denied — ${reason}`);
  for (const [id, resolve] of [...pending]) {
    pending.delete(id);
    resolve('deny');
  }
}

export function askRenderer(
  win: BrowserWindow | null,
  request: AgentConfirmRequestData,
): Promise<AgentConfirmChoice> {
  // Fail closed: with no window there is nobody to ask, and inventing an approval is the one
  // outcome a confirmation exists to prevent.
  if (!win || win.isDestroyed()) return Promise.resolve('deny');

  const id = createEntityId();
  const payload = { ...request, id } as AgentConfirmPayload;

  return new Promise<AgentConfirmChoice>((resolve) => {
    pending.set(id, resolve);

    const onClosed = (): void => {
      if (!pending.delete(id)) return;
      resolve('deny');
    };
    win.once('closed', onClosed);

    // The dialog is inside the app window, so an unfocused or minimized window would leave the
    // agent waiting on a question the user never sees.
    if (win.isMinimized()) win.restore();
    win.show();
    win.webContents.send(IPC.AGENT_CONFIRM_SHOW, payload);
  });
}
