import type { AgentRunState, AgentTurnRecord } from '../../../shared/types';
import type { AgentTraceTurn } from '../store/useAgentRunStore';

/** Matches the live trace's preview budget, so a reopened run reads the same as it did running. */
const PREVIEW_CHARS = 200;

function clip(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

/**
 * A saved run rendered in the same shape the live trace uses, so one row component serves both.
 * Observations are clipped here because the rows are single-line; the full text is what
 * `runAsText` is for.
 */
export function traceFromRun(
  turns: readonly AgentTurnRecord[],
  previewLimit = PREVIEW_CHARS,
): AgentTraceTurn[] {
  return turns.map((turn) => ({
    turn: turn.index,
    tool: turn.tool,
    config: turn.config,
    status: turn.status,
    ...(turn.thought ? { thought: clip(turn.thought, previewLimit) } : {}),
    ...(turn.observation ? { preview: clip(turn.observation, previewLimit) } : {}),
  }));
}

/**
 * The whole run as plain text, observations uncut. This is the actual deliverable of keeping the
 * trace: what the user copies out and hands to someone to work out why the answer and the page
 * disagreed. Nothing is summarised — a clipped observation is exactly the part that would have
 * explained it.
 */
export function runAsText(state: AgentRunState): string {
  const lines = [
    `goal: ${state.goal}`,
    `status: ${state.status}`,
    `started: ${state.createdAt}`,
    `updated: ${state.updatedAt}`,
    ...(state.error ? [`error: ${state.error}`] : []),
    '',
  ];
  for (const turn of state.turns) {
    lines.push(`[${turn.index}] ${turn.tool} — ${turn.status}`);
    if (turn.thought) lines.push(`    thought: ${turn.thought}`);
    lines.push(`    config: ${JSON.stringify(turn.config)}`);
    lines.push(`    observation: ${turn.observation || '(empty)'}`);
    lines.push('');
  }
  const actions = state.evidence?.actions ?? [];
  if (actions.length > 0) {
    // The part that answers "why did it call that": what was proposed, why it was held back or
    // allowed, and what the result check found.
    lines.push('changes:');
    for (const action of actions) {
      const reasons = action.reasons?.length ? ` (${action.reasons.map((reason) => reason.code).join(', ')})` : '';
      const confirmed = action.confirmed ? ` confirm=${action.confirmed}` : '';
      const outcome = action.outcome ? ` → ${action.outcome}` : '';
      const verified = action.verification ? ` [${action.verification.status}: ${action.verification.evidence}]` : '';
      lines.push(`  [${action.step}] ${action.server}:${action.tool} ${action.verdict}${reasons}${confirmed}${outcome}${verified}`);
      lines.push(`      ${action.label}`);
      for (const reason of action.reasons ?? []) lines.push(`      - ${reason.message}`);
    }
    lines.push('');
  }
  if (state.result) lines.push(`answer: ${state.result.title}`, state.result.content);
  return lines.join('\n').trimEnd();
}
