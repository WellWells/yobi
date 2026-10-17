import { appendTurn, stringifyMarker, withoutMarkerLines } from '../../shared/conversationDoc';
import type { ConversationTurn, TurnLabels, TurnMeta } from '../../shared/conversationDoc';
import type { TranslateLanguage } from '../../shared/translateLanguages';
import type { OneShotIo } from './oneShot';
import { translateTurnPair } from './translateRun';

/**
 * A whole conversation translated into a new file, as Google Docs and Word do: the original stays
 * as it is. One request per turn (question and answer together), so the user's own questions can
 * go in between; the file is written only once every turn is done, so a failure or a cancel
 * leaves nothing half-made.
 */

export interface TranslatedTurn {
  prompt: string;
  response: string;
  meta: TurnMeta;
}

export type ConversationTurnsResult =
  | { ok: true; turns: TranslatedTurn[]; kept: number }
  | { ok: false; reason: 'cancelled' | 'tooLong' | 'empty' | 'failed'; error?: string; turn?: number };

/**
 * What a turn of the copy keeps from the original's marker: who answered, when, and the attachment
 * names. Nothing tied to the original's run, thread, memory, recap, edits or translation.
 */
export function copiedTurnMeta(meta: TurnMeta): TurnMeta {
  const kept: TurnMeta = {};
  if (typeof meta.p === 'string' && meta.p) kept.p = meta.p;
  if (typeof meta.t === 'string' && meta.t) kept.t = meta.t;
  if (Array.isArray(meta.a)) {
    const names = meta.a.filter((name): name is string => typeof name === 'string');
    if (names.length > 0) kept.a = names;
  }
  return kept;
}

/** Each turn translated in order; `onTurn(done)` before each one starts. Stops at the first failure. */
export async function translateConversationTurns(
  turns: readonly ConversationTurn[],
  to: TranslateLanguage,
  providerUrl: string,
  io: OneShotIo,
  onTurn: (done: number) => void,
): Promise<ConversationTurnsResult> {
  const out: TranslatedTurn[] = [];
  let kept = 0;
  for (let index = 0; index < turns.length; index++) {
    if (io.signal.aborted) return { ok: false, reason: 'cancelled' };
    onTurn(index);
    if (io.signal.aborted) return { ok: false, reason: 'cancelled' };
    const turn = turns[index];
    const result = await translateTurnPair(turn.prompt, turn.response, to, providerUrl, io);
    if (!result.ok) {
      return result.reason === 'cancelled' ? result : { ...result, turn: index + 1 };
    }
    kept += result.kept;
    out.push({ prompt: result.prompt, response: result.response, meta: copiedTurnMeta(turn.meta) });
  }
  if (io.signal.aborted) return { ok: false, reason: 'cancelled' };
  return { ok: true, turns: out, kept };
}

export interface TranslatedConversationLabels extends TurnLabels {
  provider: string;
  time: string;
}

/**
 * The new file: title, an empty thread marker, provider and time sections, then the turns. The
 * marker binds the copy to no conversation on a provider's website (its first follow-up opens a
 * new one) and carries no version id; written out, it is the file's thread marker, so a stray
 * marker-shaped line in a translated turn could never become one — and those lines are dropped too.
 */
export function assembleTranslatedConversation(args: {
  title: string;
  provider: string | null;
  time: string;
  labels: TranslatedConversationLabels;
  turns: readonly TranslatedTurn[];
}): string {
  const head = [
    `# ${args.title}`,
    '',
    `<!-- yobi:thread ${stringifyMarker({ v: 1 })} -->`,
    '',
    ...(args.provider?.trim() ? [`## ${args.labels.provider}`, '', args.provider.trim(), ''] : []),
    `## ${args.labels.time}`,
    '',
    args.time,
  ].join('\n');
  return args.turns.reduce((raw, turn) => appendTurn(raw, {
    ...turn,
    prompt: withoutMarkerLines(turn.prompt),
    response: withoutMarkerLines(turn.response),
  }, args.labels), head);
}
