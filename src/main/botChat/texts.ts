import { summarizeFlowError } from '../../shared/flowErrorReason';
import type { FlowExecutionResult } from '../../shared/types';
import { localizeUserFacingError, t } from '../i18n';

/**
 * A bare "the flow failed" leaves the sender with nowhere to go — the run's real complaint lives
 * in the app's log, which is not where they are. The reason rides back with it when there is one,
 * in the sender's language when the run worded it. Every platform's flow commands say it this way.
 */
export function botFlowFailedText(strings: Record<string, string>, result: Pick<FlowExecutionResult, 'error' | 'displayError'>): string {
  const reason = summarizeFlowError(result.displayError ?? localizeUserFacingError(result.error ?? '', strings));
  return reason ? t(strings, 'bot.chat.flowFailedReason', { reason }) : t(strings, 'bot.chat.flowFailed');
}

/** What a flow command that did not succeed tells its sender: stopped in Yobi, or why it failed. */
export function botFlowEndText(strings: Record<string, string>, result: Pick<FlowExecutionResult, 'error' | 'displayError' | 'aborted'>): string {
  return result.aborted ? t(strings, 'bot.chat.flowStopped') : botFlowFailedText(strings, result);
}
