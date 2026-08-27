import type { BrowserWindow } from 'electron';
import { IPC } from '../../shared/types';
import type { AgentConfirmChoice, AgentConfirmPayload, AgentConfirmRequestData } from '../../shared/types';
import { createEntityId } from '../flow/flowPersistence';
import { sendLog } from '../helpers';

type Pending = (choice: AgentConfirmChoice) => void;

const pending = new Map<string, Pending>();

export function resolveAgentConfirm(id: string, choice: AgentConfirmChoice): void {
  const resolve = pending.get(id);
  if (!resolve) return;
  pending.delete(id);
  resolve(choice);
}

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

    if (win.isMinimized()) win.restore();
    win.show();
    win.webContents.send(IPC.AGENT_CONFIRM_SHOW, payload);
  });
}
