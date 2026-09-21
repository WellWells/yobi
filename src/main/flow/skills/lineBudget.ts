/**
 * Laying several chats out inside one provider input budget, for the `line_read` skill.
 *
 * Split out of lineTranscript.ts, which owns the message-level rendering this builds on.
 * The dependency runs one way only — nothing here is imported back — so the two stay
 * separately readable and separately testable.
 */
import { budgetedTranscript, renderTranscript, type TranscriptLabels } from './lineTranscript';
import type { ParsedMessage } from '../../line/schema';

const SECTION_PREFIX = '## ';

export interface ChatBatch {
  name: string;
  messages: ParsedMessage[];
}

export interface ChatSection {
  name: string;
  text: string;
}

export interface PlannedSection extends ChatSection {
  kept: number;
  dropped: number;
}

export interface TranscriptPlan {
  text: string;
  sections: PlannedSection[];
  kept: number;
  dropped: number;
  /** There were messages, and the budget could not carry a single one of them. */
  starved: boolean;
}

/** What the heading of a section costs against the budget, its newline included. */
export function sectionHeadingCost(name: string): number {
  return `${SECTION_PREFIX}${name}\n`.length;
}

/**
 * Splits one character budget across several chats: equal shares, with whatever a quiet chat
 * does not need flowing to the ones that were capped. A single pass suffices because visiting
 * the smallest need first means every later share is computed from the true remainder.
 *
 * Grants come back in the order the needs were given, not in sorted order.
 */
export function allocateBudget(needs: number[], total: number): number[] {
  const grants = new Array<number>(needs.length).fill(0);
  let remaining = Math.max(0, total);
  const ascending = needs
    .map((need, index) => ({ need: Math.max(0, need), index }))
    .sort((a, b) => a.need - b.need);
  ascending.forEach(({ need, index }, position) => {
    const grant = Math.min(need, Math.floor(remaining / (ascending.length - position)));
    grants[index] = grant;
    remaining -= grant;
  });
  return grants;
}

/**
 * Joins per-chat transcripts under `## <chat name>` headings, dropping the ones that produced
 * nothing. With `headings: false` — which is what a step reading a single chat passes — the
 * output is byte-identical to what the one-chat step has always produced, so existing flows
 * and templates are untouched.
 */
export function renderChatSections(sections: ChatSection[], options: { headings: boolean }): string {
  const filled = sections.filter((section) => section.text.length > 0);
  if (filled.length === 0) return '';
  if (!options.headings) return filled.map((section) => section.text).join('\n');
  return filled.map((section) => `${SECTION_PREFIX}${section.name}\n${section.text}`).join('\n');
}

/** The smallest spend that still shows something: this chat's newest message under its date. */
function cheapestShowing(messages: ParsedMessage[], labels: TranscriptLabels): number {
  if (messages.length === 0) return 0;
  return renderTranscript(messages.slice(-1), labels).length;
}

/**
 * Fits the batches into `maxChars`.
 *
 * An even split can leave EVERY chat with less than one message, and this step's empty output
 * already means "there were no messages" — so rather than hand back a silent blank, chats are
 * dropped from the end of the selection until what remains can actually be shown. The user
 * picked that order; honouring it makes "the budget covered the first few" predictable.
 */
export function planTranscript(
  batches: ChatBatch[],
  maxChars: number,
  labels: TranscriptLabels,
  options: { headings: boolean },
): TranscriptPlan {
  const needs = batches.map((batch) => renderTranscript(batch.messages, labels).length);
  const minimums = batches.map((batch) => cheapestShowing(batch.messages, labels));

  let carried = batches.length;
  let grants = new Array<number>(batches.length).fill(0);
  while (carried > 0) {
    const overhead = options.headings
      ? batches.slice(0, carried).reduce((sum, batch, i) => sum + (needs[i] > 0 ? sectionHeadingCost(batch.name) : 0), 0)
      : 0;
    const share = allocateBudget(needs.slice(0, carried), maxChars - overhead);
    grants = [...share, ...new Array(batches.length - carried).fill(0)];
    if (carried === 1 || !share.some((grant, i) => minimums[i] > 0 && grant < minimums[i])) break;
    carried -= 1;
  }

  const sections = batches.map((batch, index) => ({
    name: batch.name,
    ...budgetedTranscript(batch.messages, grants[index], labels),
  }));
  const kept = sections.reduce((sum, section) => sum + section.kept, 0);
  const dropped = sections.reduce((sum, section) => sum + section.dropped, 0);

  return {
    text: renderChatSections(sections, options),
    sections,
    kept,
    dropped,
    starved: kept === 0 && batches.some((batch) => batch.messages.length > 0),
  };
}
