import { preparePromptForProvider, runAutomation } from '../providers';
import { runByokCompletion } from '../providers/byokClient';
import { isByokTargetUrl } from '../../shared/types';
import { promptAsSent } from '../../shared/conversationDoc';
import type { ConversationTurn } from '../../shared/conversationDoc';
import { TAG_HISTORY, TAG_SUMMARY, formatExchange, wrapTag } from './conversationFrame';
import { getLangCache, t } from '../i18n';
import { sendLog } from '../helpers';
import { llmLane } from '../flow/lanes';
import { ensureWorkerWindow } from '../windows';
import { workerWindowUnavailable } from '../workerWindowError';

function buildSummaryPrompt(turns: ConversationTurn[], previousSummary: string): string {
  const strings = getLangCache();
  const instruction = t(strings, 'chat.summarize.prompt');
  const transcript = wrapTag(TAG_HISTORY, turns.map((turn) => formatExchange(promptAsSent(turn), turn.response)).join('\n\n'));
  const previous = previousSummary.trim()
    ? `${wrapTag(TAG_SUMMARY, previousSummary.trim())}\n\n`
    : '';
  return `${instruction}\n\n${previous}${transcript}`;
}

export interface SummaryResult {
  summary: string;
  /** How many of the supplied turns the summary actually covers. */
  covered: number;
}

/**
 * Fits the transcript to the provider's limit by covering fewer turns, never by sending a truncated
 * one (the caller advances its offset by `covered`). A single turn too large to fit is still sent
 * truncated and counted, or the same chunk would come back forever.
 */
function fitSummaryPrompt(
  turns: ConversationTurn[],
  previousSummary: string,
  targetUrl: string,
): { prompt: string; covered: number } {
  if (isByokTargetUrl(targetUrl)) {
    return { prompt: buildSummaryPrompt(turns, previousSummary), covered: turns.length };
  }
  for (let count = turns.length; count > 1; count--) {
    const prepared = preparePromptForProvider(buildSummaryPrompt(turns.slice(0, count), previousSummary), targetUrl);
    if (!prepared.truncated) return { prompt: prepared.prompt, covered: count };
  }
  const single = preparePromptForProvider(buildSummaryPrompt(turns.slice(0, 1), previousSummary), targetUrl);
  if (single.truncated) {
    sendLog('⚠️ A single conversation turn exceeds the provider prompt limit — summarizing it truncated');
  }
  return { prompt: single.prompt, covered: 1 };
}

export async function summarizeTurns(args: {
  turns: ConversationTurn[];
  previousSummary: string;
  targetUrl: string;
  timeoutMs: number;
}): Promise<SummaryResult | null> {
  const { turns, previousSummary, targetUrl, timeoutMs } = args;
  // Nothing to fold in: keep the summary as it stands and consume nothing. A null return is
  // reserved for "this failed, drop the oldest turns instead".
  if (turns.length === 0) return { summary: previousSummary.trim(), covered: 0 };

  const { prompt, covered } = fitSummaryPrompt(turns, previousSummary, targetUrl);
  if (covered < turns.length) {
    sendLog(`🧵 Summarizing ${covered} of ${turns.length} evicted turn(s) — the rest stay in the replay for now`);
  }

  try {
    if (isByokTargetUrl(targetUrl)) {
      const { response } = await runByokCompletion(targetUrl, prompt, timeoutMs);
      const summary = response.trim();
      return summary ? { summary, covered } : null;
    }

    const response = await llmLane.runExclusive(async () => {
      const worker = await ensureWorkerWindow(targetUrl, 'automation');
      if (!worker || worker.isDestroyed()) throw workerWindowUnavailable();
      const result = await runAutomation(worker, prompt, timeoutMs, targetUrl);
      return result.response;
    });
    const summary = response.trim();
    return summary ? { summary, covered } : null;
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    sendLog(`⚠️ Conversation summary failed, falling back to dropping the oldest turns — ${detail}`);
    return null;
  }
}
