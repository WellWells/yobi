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

/**
 * Once the history stops fitting, evict in chunks of this many turns instead of shaving off
 * exactly as many as the budget requires.
 *
 * The retained window is always anchored to the newest turn, so its START index is what has
 * to hold still for a prefix to repeat — lowering the byte limit does not help, because the
 * newest-N window slides forward regardless. Rounding the start up to a multiple of this
 * chunk pins it for several turns at the cost of dropping up to `chunk - 1` extra turns.
 * Exported for the test suite.
 */
export const EVICTION_CHUNK_TURNS = 4;

export function resolveContextMode(
  thread: ThreadMeta,
  targetUrl: string,
  turnCount: number,
): ContextMode {
  if (!thread.threadUrl?.trim()) return 'replay';
  if (isByokTargetUrl(targetUrl)) return 'replay';
  const provider = detectProvider(targetUrl);
  if (provider === 'duckai') return 'replay';
  if (provider !== thread.provider) return 'replay';
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

function truncateByMeasure(text: string, max: number, measure: (text: string) => number): string {
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

  // Packing to exactly the budget moves the start of the history forward by one turn on
  // every later turn, so the prompt prefix never repeats twice and the server-side prefix
  // caches (automatic on the OpenAI-compatible providers, and the only discount available
  // to a stateless replay) can never hit. Quantizing the start index pins it for a run of
  // turns, during which each turn is a pure append onto a byte-identical prefix.
  if (blocks.length < usable.length) {
    const minStart = usable.length - blocks.length;
    const chunkedStart = Math.ceil(minStart / EVICTION_CHUNK_TURNS) * EVICTION_CHUNK_TURNS;
    // Dropping every remaining turn to land on a chunk boundary would trade the whole
    // history for a cache hit with nothing left to cache.
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
