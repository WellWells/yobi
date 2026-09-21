import { PROVIDER_PROMPT_POLICIES, detectProvider } from '../providers';
import { isByokTargetUrl } from '../../shared/types';
import { charsPlusBreaks, utf8Len } from '../../shared/textBudget';
import type { ConversationTurn, ThreadMeta } from '../../shared/conversationDoc';
import { TAG_CURRENT, TAG_HISTORY, TAG_SUMMARY, formatExchange, wrapTag } from './conversationFrame';

export type ContextMode = 'native' | 'replay';

export interface PackedReplay {
  prompt: string;
  history: string;
  includedTurns: number;
  droppedTurns: number;
  overflow: ConversationTurn[];
  summaryUsed: boolean;
}

const SUMMARY_SHARE = 0.15;

const CONTEXT_SHARE = 0.7;

export const EVICTION_CHUNK_TURNS = 4;

export function resolveContextMode(
  thread: ThreadMeta,
  targetUrl: string,
  turnCount: number,
): ContextMode {
  if (!thread.threadUrl?.trim()) return 'replay';
  if (isByokTargetUrl(targetUrl)) return 'replay';
  if (detectProvider(targetUrl) !== thread.provider) return 'replay';
  return thread.threadTurns === turnCount ? 'native' : 'replay';
}

export function measureFor(targetUrl: string): (text: string) => number {
  if (isByokTargetUrl(targetUrl)) return (text: string) => text.length;
  const policy = PROVIDER_PROMPT_POLICIES[detectProvider(targetUrl)];
  return typeof policy.maxCharsPlusBreaks === 'number' ? charsPlusBreaks : utf8Len;
}

export function promptCapFor(targetUrl: string): number {
  if (isByokTargetUrl(targetUrl)) return 0;
  const policy = PROVIDER_PROMPT_POLICIES[detectProvider(targetUrl)];
  return policy.maxCharsPlusBreaks ?? policy.maxBytes ?? 0;
}

export function contextBudgetFor(
  targetUrl: string,
  byokBudgetChars: number,
): { budget: number; measure: (text: string) => number } {
  const measure = measureFor(targetUrl);
  if (isByokTargetUrl(targetUrl)) return { budget: byokBudgetChars, measure };
  return { budget: Math.floor(promptCapFor(targetUrl) * CONTEXT_SHARE), measure };
}

export function inlineBudgetFor(
  targetUrl: string,
  byokBudgetChars: number,
): { budget: number; measure: (text: string) => number } {
  const measure = measureFor(targetUrl);
  const cap = isByokTargetUrl(targetUrl) ? byokBudgetChars : promptCapFor(targetUrl);
  return { budget: Math.floor(cap * (1 - CONTEXT_SHARE)), measure };
}

export function truncateByMeasure(text: string, max: number, measure: (text: string) => number): string {
  if (max <= 0) return '';
  if (measure(text) <= max) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(text.slice(0, mid)) <= max) lo = mid;
    else hi = mid - 1;
  }
  const last = lo > 0 ? text.charCodeAt(lo - 1) : 0;
  if (last >= 0xd8_00 && last <= 0xdb_ff) lo--;
  return text.slice(0, lo);
}

/**
 * How many of `turns` sit behind a summary that covered `covered` of the overflow.
 *
 * The overflow only holds turns worth replaying — one with an empty response (an image-only
 * reply, or an answer that was nothing but a title marker) is filtered out before it. Counting
 * the overflow therefore under-counts the document, and the offset persisted as
 * `summarizedTurns` shifts: a turn ends up both summarised AND replayed, for good.
 */
export function turnsConsumedBySummary(
  turns: ConversationTurn[],
  overflow: ConversationTurn[],
  covered: number,
): number {
  const last = overflow[covered - 1];
  if (!last) return 0;
  const index = turns.indexOf(last);
  return index < 0 ? covered : index + 1;
}

export function packReplayPrompt(args: {
  turns: ConversationTurn[];
  summary: string;
  newPrompt: string;
  budget: number;
  measure: (text: string) => number;
}): PackedReplay {
  const { turns, summary, newPrompt, budget, measure } = args;

  const usable = turns.filter((turn) => turn.prompt.trim() !== '' && turn.response.trim() !== '');

  const summaryText = summary.trim()
    ? truncateByMeasure(summary.trim(), Math.floor(budget * SUMMARY_SHARE), measure)
    : '';
  const summaryBlock = summaryText ? wrapTag(TAG_SUMMARY, summaryText) : '';

  const turnBlock = (turn: ConversationTurn): string => formatExchange(turn.prompt, turn.response);

  const historyBlock = (summaryPart: string, blocks: string[]): string => {
    const parts = summaryPart ? [summaryPart, ...blocks] : blocks;
    return parts.length === 0 ? '' : wrapTag(TAG_HISTORY, parts.join('\n\n'));
  };

  const assemble = (summaryPart: string, blocks: string[]): string => {
    const history = historyBlock(summaryPart, blocks);
    if (!history) return newPrompt;
    return [history, '', wrapTag(TAG_CURRENT, newPrompt)].join('\n');
  };

  const summaryFits = Boolean(summaryBlock) && measure(assemble(summaryBlock, [])) <= budget;
  const basePart = summaryFits ? summaryBlock : '';

  const fill = (limit: number): string[] => {
    let kept: string[] = [];
    for (let index = usable.length - 1; index >= 0; index--) {
      const candidate = [turnBlock(usable[index]), ...kept];
      if (measure(assemble(basePart, candidate)) > limit) break;
      kept = candidate;
    }
    return kept;
  };

  let blocks = fill(budget);

  if (blocks.length < usable.length) {
    const minStart = usable.length - blocks.length;
    const chunkedStart = Math.ceil(minStart / EVICTION_CHUNK_TURNS) * EVICTION_CHUNK_TURNS;
    if (chunkedStart < usable.length) {
      blocks = usable.slice(chunkedStart).map(turnBlock);
    }
  }

  const overflow = usable.slice(0, usable.length - blocks.length);
  return {
    prompt: assemble(basePart, blocks),
    history: historyBlock(basePart, blocks),
    includedTurns: blocks.length,
    droppedTurns: overflow.length,
    overflow,
    summaryUsed: summaryFits,
  };
}
