import { bm25Scores } from './rank';
import { charsPlusBreaks, utf8Len } from '../../shared/textBudget';
import type { SynthesisBudget } from './budgets';
import type { SourceDoc } from './types';

const MIN_PARAGRAPH_CHARS = 80;
const MAX_PARAGRAPH_CHARS = 1_200;
const ELLIPSIS = ' […] ';
const SEGMENT_JOIN_MARGIN = 8;
/** While another page still has a matching paragraph, no page packs more than this share of the budget. */
export const MAX_PAGE_SHARE = 0.4;

interface Segment {
  docIndex: number;
  order: number;
  text: string;
}

/** Case, spacing and punctuation do not make a different paragraph. */
function paragraphKey(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * A paragraph already on a higher-ranked page (`docs` come best first) is not packed again: a
 * syndicated article, a mirror, a quoted post, the nav or cookie text two pages of a site share.
 */
function withoutRepeats(segments: Segment[]): Segment[] {
  const firstPage = new Map<string, number>();
  return segments.filter((segment) => {
    const key = paragraphKey(segment.text);
    if (!key) return true;
    const page = firstPage.get(key);
    if (page === undefined) firstPage.set(key, segment.docIndex);
    return page === undefined || page === segment.docIndex;
  });
}

export function extractRelevant(docs: SourceDoc[], query: string, budget: SynthesisBudget): SourceDoc[] {
  const segments = withoutRepeats(docs.flatMap((doc, docIndex) =>
    splitParagraphs(doc.text).map((text, order) => ({ docIndex, order, text })),
  ));
  if (segments.length === 0) return [];

  const scores = bm25Scores(segments.map((s) => s.text), query);
  const ranked = segments
    .map((segment, index) => ({ segment, score: scores[index] }))
    .sort((a, b) =>
      b.score - a.score
      || a.segment.docIndex - b.segment.docIndex
      || a.segment.order - b.segment.order);

  const chosen = new Set<Segment>();
  const perPage = new Map<number, { bytes: number; cpb: number }>();
  let usedBytes = 0;
  let usedCpb = 0;
  const take = (segment: Segment, capped: boolean): void => {
    if (chosen.has(segment)) return;
    const bytes = utf8Len(segment.text);
    const cpb = charsPlusBreaks(segment.text) + SEGMENT_JOIN_MARGIN;
    if (chosen.size > 0 && (usedBytes + bytes > budget.bytes || usedCpb + cpb > budget.charsPlusBreaks)) return;
    const page = perPage.get(segment.docIndex) ?? { bytes: 0, cpb: 0 };
    if (capped && chosen.size > 0
      && (page.bytes + bytes > budget.bytes * MAX_PAGE_SHARE || page.cpb + cpb > budget.charsPlusBreaks * MAX_PAGE_SHARE)) return;
    chosen.add(segment);
    perPage.set(segment.docIndex, { bytes: page.bytes + bytes, cpb: page.cpb + cpb });
    usedBytes += bytes;
    usedCpb += cpb;
  };
  // First the matching paragraphs with each page held to its share, so one long page cannot crowd
  // out the rest; then whatever is left fills by score as before — the only page that matches is
  // not capped, and the total is unchanged.
  for (const { segment, score } of ranked) if (score > 0) take(segment, true);
  for (const { segment } of ranked) take(segment, false);

  const result: SourceDoc[] = [];
  docs.forEach((doc, docIndex) => {
    const kept = segments
      .filter((s) => s.docIndex === docIndex && chosen.has(s))
      .sort((a, b) => a.order - b.order);
    if (kept.length === 0) return;
    let text = '';
    let prevOrder = -1;
    for (const seg of kept) {
      if (prevOrder >= 0 && seg.order !== prevOrder + 1) text += ELLIPSIS;
      else if (text) text += '\n\n';
      text += seg.text;
      prevOrder = seg.order;
    }
    result.push({ ...doc, id: result.length + 1, text });
  });
  return result;
}

const WINDOW_GAP = '\n\n[…]\n\n';

/**
 * A long page cut to what is about `query`: its best-scoring paragraphs, each with the paragraph
 * before and after it (the subject is often named there), in page order, within `maxChars`. A page
 * already short enough, or one where nothing scores, comes back whole.
 */
export function relevantWindows(text: string, query: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const paragraphs = splitParagraphs(text);
  const scores = bm25Scores(paragraphs, query);
  const best = paragraphs
    .map((_paragraph, index) => index)
    .filter((index) => scores[index] > 0)
    .sort((a, b) => scores[b] - scores[a] || a - b);
  if (best.length === 0) return text;

  const kept = new Set<number>();
  let used = 0;
  const keep = (index: number): void => {
    if (index < 0 || index >= paragraphs.length || kept.has(index)) return;
    const cost = paragraphs[index].length + WINDOW_GAP.length;
    if (used + cost > maxChars) return;
    kept.add(index);
    used += cost;
  };
  for (const index of best) {
    keep(index);
    if (!kept.has(index)) continue;
    keep(index - 1);
    keep(index + 1);
  }

  const order = [...kept].sort((a, b) => a - b);
  return order
    .map((index, at) => (at > 0 && index !== order[at - 1] + 1 ? `${WINDOW_GAP.trimStart()}${paragraphs[index]}` : paragraphs[index]))
    .join('\n\n');
}

function splitParagraphs(text: string): string[] {
  const rawBlocks = text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  const blocks: string[] = [];
  for (const block of rawBlocks) {
    if (block.length <= MAX_PARAGRAPH_CHARS) {
      blocks.push(block);
      continue;
    }
    for (let i = 0; i < block.length; i += MAX_PARAGRAPH_CHARS) {
      blocks.push(block.slice(i, i + MAX_PARAGRAPH_CHARS));
    }
  }

  const merged: string[] = [];
  for (const block of blocks) {
    const prev = merged[merged.length - 1];
    if (prev !== undefined && prev.length < MIN_PARAGRAPH_CHARS) {
      merged[merged.length - 1] = `${prev}\n${block}`;
    } else {
      merged.push(block);
    }
  }
  return merged;
}
