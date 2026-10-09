/**
 * What a run actually changed in the outside world, as plain counts, so the prompt (which asks the
 * model to report failures honestly) and the delivery path (which guarantees it) read the same fact.
 */
export interface AgentWriteOutcome {
  attempted: number;
  succeeded: number;
}

export const NO_WRITES: AgentWriteOutcome = { attempted: 0, succeeded: 0 };

/** Writes were tried and not one of them landed — the case where a success claim is a lie. */
export function writesAllFailed(writes: AgentWriteOutcome | undefined): boolean {
  return writes !== undefined && writes.attempted > 0 && writes.succeeded === 0;
}

/**
 * Appends the localized failure notice whenever every write failed, whatever the model wrote. The
 * model's text is kept because it may still name the page or the error.
 */
export function withWriteFailureNotice(
  answer: string,
  writes: AgentWriteOutcome | undefined,
  notice: string,
): string {
  if (!writesAllFailed(writes) || !notice.trim()) return answer;
  const trimmed = answer.trimEnd();
  return trimmed.includes(notice) ? trimmed : `${trimmed}\n\n${notice}`;
}
