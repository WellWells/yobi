import type { BrowserWindow } from 'electron';
import { IPC } from '../../shared/types';
import type { AgentConfirmChoice, AgentConfirmPayload, AgentConfirmRequestData } from '../../shared/types';
import { createEntityId } from '../flow/flowPersistence';
import { sendLog } from '../helpers';

type Pending = (choice: AgentConfirmChoice, fromRenderer?: boolean) => void;

const pending = new Map<string, Pending>();

/**
 * An unanswered prompt is denied after this long; otherwise the run would hold one of the two
 * FlowQueue slots forever (a running entry cannot be cancelled from the queue).
 */
const CONFIRM_TIMEOUT_MS = 10 * 60_000;

/**
 * Settling is owned by the stored resolver (it deletes its own entry, clears its timer, detaches
 * its listener); a caller that deleted the entry first would leave the promise unsettled.
 */
export function resolveAgentConfirm(id: string, choice: AgentConfirmChoice): void {
  pending.get(id)?.(choice, true);
}

export function cancelAllAgentConfirms(reason: string): void {
  if (pending.size === 0) return;
  sendLog(`🔒 [Agent] ${pending.size} pending confirmation(s) denied — ${reason}`);
  for (const settle of [...pending.values()]) settle('deny');
}

export function askRenderer(
  win: BrowserWindow | null,
  request: AgentConfirmRequestData,
): Promise<AgentConfirmChoice> {
  if (!win || win.isDestroyed()) return Promise.resolve('deny');

  const id = createEntityId();
  const payload = { ...request, id } as AgentConfirmPayload;

  return new Promise<AgentConfirmChoice>((resolve) => {
    const onClosed = (): void => settle('deny');

    let timer: NodeJS.Timeout | undefined;
    function settle(choice: AgentConfirmChoice, fromRenderer = false): void {
      if (!pending.delete(id)) return;
      if (timer) clearTimeout(timer);
      // Detached on every exit, not just a window close, or each confirmation leaks a listener.
      win!.removeListener('closed', onClosed);
      // The renderer already dropped the one it answered itself; anything settled HERE (timeout,
      // run cancelled) is still on screen and has to be taken down, or the next request inherits
      // an open modal and the click aimed at this one.
      if (!fromRenderer && !win!.isDestroyed()) {
        win!.webContents.send(IPC.AGENT_CONFIRM_DISMISS, id);
      }
      resolve(choice);
    }

    pending.set(id, settle);
    win.once('closed', onClosed);
    timer = setTimeout(() => {
      sendLog('🔒 [Agent] a confirmation went unanswered — denied');
      settle('deny');
    }, CONFIRM_TIMEOUT_MS);

    if (win.isMinimized()) win.restore();
    win.show();
    win.webContents.send(IPC.AGENT_CONFIRM_SHOW, payload);
  });
}
