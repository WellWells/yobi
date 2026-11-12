/**
 * Sends the user stopped from the composer. Their ending arrives later and by several roads (a chat
 * turn marked stopped, an agent run or a chat command that failed as cancelled); each road asks
 * here, so a stop is never announced as an error and its question goes back into the composer, the
 * way Claude puts a stopped message back for editing.
 */
import type { PendingTurn } from '../store/appStore';

export type StopTarget =
  | { kind: 'shell'; sendId: string }
  | { kind: 'agent'; sendId: string; runId: string }
  | { kind: 'command'; sendId: string }
  | { kind: 'chat'; sendId: string };

/** What the composer's Stop acts on for the newest unanswered send; null when nothing is waiting. */
export function stopTargetFor(turn: PendingTurn | undefined): StopTarget | null {
  if (!turn) return null;
  const { sendId } = turn;
  // A `!` command still running is stopped as a command; once it is done the model reading its
  // output is an ordinary chat send under the same id.
  if (turn.shell?.running) return { kind: 'shell', sendId };
  if (turn.runId) return { kind: 'agent', sendId, runId: turn.runId };
  if (turn.command) return { kind: 'command', sendId };
  return { kind: 'chat', sendId };
}

const stopped = new Set<string>();
let onPromptBack: ((prompt: string) => void) | null = null;

export function markSendStopped(sendId: string): void {
  stopped.add(sendId);
}

/** True once for a send the user stopped; the caller then says nothing about how it ended. */
export function consumeSendStopped(sendId: string): boolean {
  return stopped.delete(sendId);
}

/** The composer takes the stopped question back; one listener, the open chat's composer. */
export function onStoppedPrompt(listener: (prompt: string) => void): () => void {
  onPromptBack = listener;
  return () => {
    if (onPromptBack === listener) onPromptBack = null;
  };
}

export function giveBackStoppedPrompt(prompt: string): void {
  if (prompt.trim()) onPromptBack?.(prompt);
}
