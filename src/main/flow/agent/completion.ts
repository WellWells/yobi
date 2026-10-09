import type { AgentCompletion } from '../../../shared/types';

/**
 * Whether an answer achieved the whole goal or was cut off by a limit. Pure, so the engine and the
 * chat delivery share one definition.
 */

export const COMPLETE: AgentCompletion = { status: 'complete' };

/**
 * A `finish` the model chose. Its own `done` decides, because only it knows whether what it wrote
 * covers the goal; a missing claim counts as done, since an answer must never be marked partial
 * for a field the model forgot. On the forced last turn a "not done" means the limit cut it short.
 */
export function finishCompletion(done: boolean | undefined, missing: string | undefined, forced: boolean): AgentCompletion {
  if (done !== false) return COMPLETE;
  return { status: 'partial', reason: forced ? 'limit' : 'unfinished', ...(missing ? { missing } : {}) };
}

/**
 * An answer written by synthesis, which only runs when the loop ended WITHOUT the model choosing to
 * finish — out of steps, time or tokens, or out of usable actions. So the default flips: partial
 * unless the model, looking at everything it gathered, says the goal is in fact covered.
 */
export function synthesisCompletion(done: boolean | undefined, missing: string | undefined): AgentCompletion {
  if (done === true) return COMPLETE;
  return { status: 'partial', reason: 'limit', ...(missing ? { missing } : {}) };
}

/**
 * The line for an answer the run's limit cut short, or null. An answer the model itself marked
 * unfinished already says so; a cut-off run may not know it was stopped. The status is recorded in
 * the run file either way.
 */
export function completionNotice(
  completion: AgentCompletion | undefined,
  translate: (key: string, vars?: Record<string, string>) => string,
): string | null {
  if (!completion || completion.status === 'complete' || completion.reason !== 'limit') return null;
  return completion.missing
    ? translate('agent.completion.limit', { missing: completion.missing })
    : translate('agent.completion.limitNoDetail');
}

/**
 * Appended, never substituted, like the write-failure notice: the model's text usually still holds
 * the useful part.
 */
export function withCompletionNotice(answer: string, notice: string | null): string {
  if (!notice?.trim()) return answer;
  const trimmed = answer.trimEnd();
  return trimmed.includes(notice) ? trimmed : `${trimmed}\n\n${notice}`;
}
