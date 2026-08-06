import { preparePromptForProvider, runAutomation } from '../providers';
import { runByokCompletion } from '../providers/byokClient';
import { isByokTargetUrl } from '../../shared/types';
import type { ConversationTurn } from '../../shared/conversationDoc';
import { TAG_HISTORY, TAG_SUMMARY, formatExchange, wrapTag } from './conversationFrame';
import { getLangCache, t } from '../i18n';
import { sendLog } from '../helpers';
import { llmLane } from '../flow/lanes';
import { ensureWorkerWindow } from '../windows';

function buildSummaryPrompt(turns: ConversationTurn[], previousSummary: string): string {
  const strings = getLangCache();
  const instruction = t(strings, 'chat.summarize.prompt');
  const transcript = wrapTag(TAG_HISTORY, turns.map((turn) => formatExchange(turn.prompt, turn.response)).join('\n\n'));
  const previous = previousSummary.trim()
    ? `${wrapTag(TAG_SUMMARY, previousSummary.trim())}\n\n`
    : '';
  return `${instruction}\n\n${previous}${transcript}`;
}

export async function summarizeTurns(args: {
  turns: ConversationTurn[];
  previousSummary: string;
  targetUrl: string;
  timeoutMs: number;
}): Promise<string | null> {
  const { turns, previousSummary, targetUrl, timeoutMs } = args;
  if (turns.length === 0) return previousSummary.trim() || null;

  const prompt = buildSummaryPrompt(turns, previousSummary);

  try {
    if (isByokTargetUrl(targetUrl)) {
      const { response } = await runByokCompletion(targetUrl, prompt, timeoutMs);
      return response.trim() || null;
    }

    const prepared = preparePromptForProvider(prompt, targetUrl);
    const response = await llmLane.runExclusive(async () => {
      const worker = await ensureWorkerWindow(targetUrl, 'automation');
      if (!worker || worker.isDestroyed()) {
        throw new Error('Worker window unavailable for summarization');
      }
      const result = await runAutomation(worker, prepared.prompt, timeoutMs, targetUrl);
      return result.response;
    });
    return response.trim() || null;
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    sendLog(`⚠️ Conversation summary failed, falling back to dropping the oldest turns — ${detail}`);
    return null;
  }
}
