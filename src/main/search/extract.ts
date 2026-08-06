import { bm25Scores } from './rank';
import { charsPlusBreaks, utf8Len } from '../../shared/textBudget';
import type { SynthesisBudget } from './budgets';
import type { SourceDoc } from './types';

const MIN_PARAGRAPH_CHARS = 80;
const MAX_PARAGRAPH_CHARS = 1_200;
const ELLIPSIS = ' […] ';
const SEGMENT_JOIN_MARGIN = 8;

interface Segment {
  docIndex: number;
  order: number;
  text: string;
}

export function extractRelevant(docs: SourceDoc[], query: string, budget: SynthesisBudget): SourceDoc[] {
  const segments = docs.flatMap((doc, docIndex) =>
    splitParagraphs(doc.text).map((text, order) => ({ docIndex, order, text })),
  );
  if (segments.length === 0) return [];

  const scores = bm25Scores(segments.map((s) => s.text), query);
  const ranked = segments
    .map((segment, index) => ({ segment, score: scores[index] }))
    .sort((a, b) =>
      b.score - a.score
      || a.segment.docIndex - b.segment.docIndex
      || a.segment.order - b.segment.order);

  const chosen = new Set<Segment>();
  let usedBytes = 0;
  let usedCpb = 0;
  for (const { segment } of ranked) {
    const bytes = utf8Len(segment.text);
    const cpb = charsPlusBreaks(segment.text) + SEGMENT_JOIN_MARGIN;
    if (chosen.size > 0 && (usedBytes + bytes > budget.bytes || usedCpb + cpb > budget.charsPlusBreaks)) continue;
    chosen.add(segment);
    usedBytes += bytes;
    usedCpb += cpb;
  }

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
