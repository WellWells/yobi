import type { BrowserWindow } from 'electron';
import { IPC } from '../../shared/types';
import type { AgentConfirmChoice, AgentConfirmPayload, AgentConfirmRequestData } from '../../shared/types';
import { createEntityId } from '../flow/flowPersistence';
import { sendLog } from '../helpers';

type Pending = (choice: AgentConfirmChoice, fromRenderer?: boolean) => void;

const pending = new Map<string, Pending>();

/**
 * A prompt nobody answers used to park the run forever: `askRenderer` resolved only on a reply
 * or on the window closing, an agent run holds one of only two FlowQueue slots, and `cancelQueued`
 * refuses an entry that is already running. Denying after a long wait is the safe direction — the
 * model is told the user declined and moves on.
 */
const CONFIRM_TIMEOUT_MS = 10 * 60_000;

/**
 * SETTLING IS OWNED BY THE ENTRY, NOT BY THE CALLER. Every resolver stored here already deletes
 * its own map entry, deduplicates itself, clears its timer and detaches its window listener — so
 * a caller that deleted the entry first would leave the resolver's own guard looking at a map
 * that no longer holds it, and the promise would never settle at all.
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
      // Detached on EVERY exit, not just a window close. Left attached it leaked one listener
      // per confirmation — noise at one per run, not at one per shell command.
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
