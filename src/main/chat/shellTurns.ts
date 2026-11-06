import { buildOutputMarkdown, titleFromPrompt } from '../output';
import { appendConversationTurn } from './conversationStore';
import { resolveConversationPath } from '../conversationIndex';
import { deliverTempChatResult } from '../tempChat';
import { getLangCache, stripSystemInstruction, t } from '../i18n';
import { sendLog } from '../helpers';
import type { TurnMeta, TurnShell } from '../../shared/conversationDoc';

/*
 * A `!` command's turn stays in the conversation even when no answer comes (stopped, the model
 * failed, the analysis was cancelled in the queue): the user ran it, and a later question has to
 * be able to refer to its output. Replay keeps such a turn (`packReplayPrompt`).
 */

export interface UnansweredShellTurn {
  /** The record: the command line and its output. */
  prompt: string;
  /** What the model would have been sent, when that differs from the record. */
  sent?: string;
  shell: TurnShell;
  /** The open conversation; absent for a temporary chat. */
  conversationPath?: string;
  temporary: boolean;
}

function labelOf(key: string, fallback: string): string {
  const value = t(getLangCache(), key);
  return value && value !== key ? value : fallback;
}

/** Writes the turn with no answer; returns the file it went into ('' for a temporary chat), or null when it could not be kept. */
export async function keepUnansweredShellTurn(turn: UnansweredShellTurn): Promise<string | null> {
  const sent = turn.sent ? stripSystemInstruction(turn.sent) : '';
  const meta: TurnMeta = {
    t: new Date().toISOString(),
    sh: turn.shell,
    ...(sent && sent !== turn.prompt ? { sent } : {}),
  };
  try {
    if (turn.temporary) {
      deliverTempChatResult({
        content: buildOutputMarkdown({
          prompt: turn.prompt,
          response: '',
          title: titleFromPrompt(turn.prompt),
          promptLabel: labelOf('md.prompt', 'Prompt'),
          responseLabel: labelOf('md.response', 'Response'),
          timestampLabel: labelOf('md.timestamp', 'Time'),
          turnMeta: meta,
        }),
        turn: { prompt: turn.prompt, response: '', meta },
      });
      return '';
    }
    if (!turn.conversationPath) return null;
    // Moved into a folder while the command ran: found again by its id.
    const target = await resolveConversationPath({ path: turn.conversationPath }) ?? turn.conversationPath;
    await appendConversationTurn(target, { prompt: turn.prompt, response: '', meta });
    return target;
  } catch (err: unknown) {
    sendLog(`⚠️ [Shell] Could not keep the command's turn (${err instanceof Error ? err.message : String(err)})`);
    return null;
  }
}
