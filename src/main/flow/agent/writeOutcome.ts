/**
 * What a run actually changed in the outside world.
 *
 * The 2026-09-07 Notion runs finished with "已成功將…移至廢止" after every write had failed: the
 * model was handed a scratchpad of ERROR observations and told to "synthesize your best answer",
 * which is an invitation to write a story. Nothing tied the final answer to what happened, even
 * though the loop knew the status of every turn. This is that missing fact, kept as plain counts
 * so both the prompt (which asks the model to be honest) and the delivery path (which guarantees
 * it) can read the same thing.
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
 * The guarantee, not the request. The prompt already asks the model to own the failure; this
 * makes it true regardless of what it wrote. `notice` arrives localized because the answer is in
 * the user's language, and it is appended rather than substituted — the model's own text may
 * still hold the useful part (which page, which error), it just must not be the last word.
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
