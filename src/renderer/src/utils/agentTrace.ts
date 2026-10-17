import type { AgentRunState, AgentTurnRecord } from '../../../shared/types';
import type { ResearchProgress } from '../../../shared/researchProgress';
import { clipLine } from '../../../shared/textBudget';
import type { AgentTraceTurn } from '../store/useAgentRunStore';

/** Matches the live trace's preview budget, so a reopened run reads the same as it did running. */
const PREVIEW_CHARS = 200;

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
    ...(turn.thought ? { thought: clipLine(turn.thought, previewLimit) } : {}),
    ...(turn.observation ? { preview: clipLine(turn.observation, previewLimit) } : {}),
    ...(turn.research ? { research: turn.research } : {}),
  }));
}

/** `research: read 6/8, unreadable 2 (a.com, b.com) · summarized 6, irrelevant 3 · sources 3`. */
export function researchAsText(progress: ResearchProgress): string {
  const parts = progress.phases.map((phase) => {
    const count = phase.total !== undefined ? ` ${phase.done ?? 0}/${phase.total}` : '';
    const failed = phase.failed ? `, unreadable ${phase.failed} (${(phase.failedHosts ?? []).join(', ')})` : '';
    const dropped = phase.dropped ? `, irrelevant ${phase.dropped}` : '';
    return `${phase.id}${count} ${phase.status}${failed}${dropped}`;
  });
  if (progress.sources !== undefined) parts.push(`sources ${progress.sources}`);
  return `research: ${parts.join(' · ')}`;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** `+12.3s · model 4.1s · tool 38.2s`, from what the record has; empty for records without timings. */
function stepTiming(turn: AgentTurnRecord, startMs: number): string {
  const parts: string[] = [];
  const at = turn.at ? Date.parse(turn.at) : NaN;
  if (Number.isFinite(at) && Number.isFinite(startMs)) parts.push(`+${seconds(at - startMs)}`);
  if (turn.modelMs !== undefined) parts.push(`model ${seconds(turn.modelMs)}`);
  if (turn.toolMs !== undefined) parts.push(`tool ${seconds(turn.toolMs)}`);
  return parts.length > 0 ? ` · ${parts.join(' · ')}` : '';
}

/**
 * The time from the last step's end to the run's last write — on a finished run, the model writing
 * the answer. Not stored: it falls out of the step timings, and a guess is worse than nothing when
 * the last record has none.
 */
function answerTiming(state: AgentRunState): string[] {
  const last = state.turns.at(-1);
  if (!state.result || !last?.at || last.toolMs === undefined) return [];
  const ms = Date.parse(state.updatedAt) - (Date.parse(last.at) + last.toolMs);
  return Number.isFinite(ms) && ms >= 0 ? [`answer written in: ${seconds(ms)}`] : [];
}

/**
 * The whole run as plain text, observations uncut: a clipped observation is often the part that
 * explains why the answer and the page disagreed.
 */
export function runAsText(state: AgentRunState): string {
  const startMs = Date.parse(state.createdAt);
  const elapsedMs = Date.parse(state.updatedAt) - startMs;
  const lines = [
    `goal: ${state.goal}`,
    `status: ${state.status}`,
    `started: ${state.createdAt}`,
    `updated: ${state.updatedAt}`,
    ...(Number.isFinite(elapsedMs) ? [`elapsed: ${seconds(elapsedMs)}`] : []),
    ...answerTiming(state),
    ...(state.error ? [`error: ${state.error}`] : []),
    ...(state.errorDetail ? [`detail: ${state.errorDetail}`] : []),
    ...(state.result?.completion?.status === 'partial'
      ? [`completion: partial (${state.result.completion.reason})${state.result.completion.missing ? ` — missing: ${state.result.completion.missing}` : ''}`]
      : []),
    '',
  ];
  for (const turn of state.turns) {
    lines.push(`[${turn.index}] ${turn.tool} — ${turn.status}${stepTiming(turn, startMs)}`);
    if (turn.thought) lines.push(`    thought: ${turn.thought}`);
    lines.push(`    config: ${JSON.stringify(turn.config)}`);
    if (turn.research) lines.push(`    ${researchAsText(turn.research)}`);
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
