import type { AgentCommandResult, AgentRunState, MetricOutcome } from '../../shared/types';
import { classifyFailure } from '../metricsNormalize';

/**
 * What one agent run counts as on the stats page, or `null` when it is not counted.
 *
 * - A run that stopped to ask the user is paused, not finished: the resume that answers it is
 *   the same run and records the outcome then, so the question itself adds nothing.
 * - A run the user stopped is left out, the same as a stopped flow and a stopped model request.
 * - A partial answer (`result.completion.status === 'partial'`) counts as a success. The run
 *   delivered an answer that says what it is missing; the outcome model has no fourth bucket, and
 *   one used only by agent runs would make the success rate mean different things per domain.
 * - A failure is classified from the engine's English (`errorDetail`), not from the sentence the
 *   user was shown — `classifyFailure` reads "timed out", which a translated message never says.
 */
export function agentRunMetricOutcome(result: AgentCommandResult, state: AgentRunState): MetricOutcome | null {
  if (result.question) return null;
  if (result.success) return 'success';
  if (state.status === 'cancelled') return null;
  return classifyFailure(state.errorDetail ?? state.error ?? result.error);
}
