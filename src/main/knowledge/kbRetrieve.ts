/**
 * The passages one question reads from the knowledge bases, packed into what the answering model
 * can take, as the research pipeline's `SourceDoc`s — one per file, so a citation `[n]` names a
 * file the user can open.
 *
 * A base small enough to fit is sent whole (Anthropic's Contextual Retrieval guidance: under the
 * model's window, skip retrieval); otherwise the best-ranked chunks come first, each with the chunk
 * before and after it (a passage often names its subject one paragraph earlier), until the budget
 * is spent. Within a file the passages keep the file's order.
 */
import { charsPlusBreaks, utf8Len } from '../../shared/textBudget';
import { kbCitationUrl } from '../../shared/knowledgeBase';
import type { KnowledgeBase } from '../../shared/knowledgeBase';
import type { SynthesisBudget } from '../search/budgets';
import type { SourceDoc } from '../search/types';
import { KB_AI_ORD_BASE } from './kbIndex';
import type { KbChunkRow, KbIndex } from './kbIndex';

/** Chunks ranked per question before packing; more than any budget takes. */
export const KB_SEARCH_LIMIT = 40;
const NEIGHBOURS = 1;
const GAP = '\n\n[…]\n\n';

export interface KbSource {
  kb: KnowledgeBase;
  index: KbIndex;
  /** The question is limited to these files of the base (the user's pick); absent = every file. */
  only?: readonly string[];
}

interface Passage {
  kb: KnowledgeBase;
  chunk: KbChunkRow;
  score: number;
}

function cost(text: string): { bytes: number; cpb: number } {
  return { bytes: utf8Len(text) + 16, cpb: charsPlusBreaks(text) + 8 };
}

/**
 * One chunk as the model reads it: where it sits (headings, PDF page), then its text. The header
 * starts with the file's name, which the source's title already gives; only that is dropped — a PDF
 * without headings keeps its `p.N`, which must not be cut with the name. A passage from the
 * AI description says so: it is a model's reading of the file, not the file's words.
 */
function passageText(chunk: KbChunkRow): string {
  const name = chunk.path.split('/').pop() ?? chunk.path;
  const head = chunk.head.startsWith(name) ? chunk.head.slice(name.length) : chunk.head;
  const at = head.replace(/^\s*[›·]\s*/, '').trim();
  if (chunk.ord >= KB_AI_ORD_BASE) return `(Model-written summary of this file, not its own words)\n${chunk.body}`;
  return at ? `(${at})\n${chunk.body}` : chunk.body;
}

function toDocs(chosen: readonly Passage[]): SourceDoc[] {
  const byFile = new Map<string, { kb: KnowledgeBase; path: string; best: number; chunks: Map<number, KbChunkRow> }>();
  for (const { kb, chunk, score } of chosen) {
    const key = `${kb.id}\n${chunk.path}`;
    const entry = byFile.get(key) ?? { kb, path: chunk.path, best: score, chunks: new Map<number, KbChunkRow>() };
    entry.best = Math.max(entry.best, score);
    entry.chunks.set(chunk.ord, chunk);
    byFile.set(key, entry);
  }
  return [...byFile.values()]
    .sort((a, b) => b.best - a.best)
    .map((file, i) => {
      const ordered = [...file.chunks.values()].sort((a, b) => a.ord - b.ord);
      let text = '';
      ordered.forEach((chunk, at) => {
        if (at > 0) text += chunk.ord === ordered[at - 1].ord + 1 ? '\n\n' : GAP;
        text += passageText(chunk);
      });
      const name = file.path.split('/').pop() ?? file.path;
      return { id: i + 1, title: `${file.kb.name} › ${name}`, url: kbCitationUrl(file.kb.id, file.path), text };
    });
}

/**
 * A quick bound before building the whole base: everything a question could be handed — AI
 * descriptions included (left out, a base of analysed scans counts 0 characters and
 * 361,606 bytes go out against a 240,000 budget).
 */
function wholeBaseMayFit(sources: readonly KbSource[], budget: SynthesisBudget): boolean {
  let cpb = 0;
  for (const { index, only } of sources) {
    const { chars, chunks } = index.liveSize(only);
    cpb += chars + chunks * 8;
  }
  return cpb <= budget.charsPlusBreaks;
}

/** The whole bases as sources, or null when what would really be sent is past the budget. */
function wholeBase(sources: readonly KbSource[], hits: readonly Passage[], budget: SynthesisBudget): SourceDoc[] | null {
  if (!wholeBaseMayFit(sources, budget)) return null;
  const best = new Map(hits.map((hit) => [`${hit.kb.id}\n${hit.chunk.path}`, hit.score]));
  const all: Passage[] = sources.flatMap(({ kb, index, only }) => index.files().filter((file) => !only || only.includes(file.path)).flatMap((file) =>
    index.liveChunks(file.id).map((chunk) => ({ kb, chunk, score: best.get(`${kb.id}\n${chunk.path}`) ?? 0 }))));
  const docs = toDocs(all);
  let bytes = 0;
  let cpb = 0;
  for (const doc of docs) {
    const size = cost(`${doc.title}\n${doc.text}`);
    bytes += size.bytes;
    cpb += size.cpb;
  }
  return bytes <= budget.bytes && cpb <= budget.charsPlusBreaks ? docs : null;
}

/**
 * The cited material for `queries` (the person's words first, then any keywords written for them).
 * Empty when nothing in the bases matches.
 */
export function retrieveKbDocs(sources: readonly KbSource[], queries: readonly string[], budget: SynthesisBudget): SourceDoc[] {
  if (sources.length === 0) return [];
  const hits: Passage[] = sources
    .flatMap(({ kb, index, only }) => index.search(queries, KB_SEARCH_LIMIT, only).map((chunk) => ({ kb, chunk, score: chunk.score })))
    .sort((a, b) => b.score - a.score);

  const whole = wholeBase(sources, hits, budget);
  if (whole) return whole;
  if (hits.length === 0) return [];

  const chosen: Passage[] = [];
  const taken = new Set<string>();
  let bytes = 0;
  let cpb = 0;
  const take = (passage: Passage): boolean => {
    const key = `${passage.kb.id}:${passage.chunk.id}`;
    if (taken.has(key)) return true;
    const size = cost(passageText(passage.chunk));
    if (bytes + size.bytes > budget.bytes || cpb + size.cpb > budget.charsPlusBreaks) return false;
    taken.add(key);
    chosen.push(passage);
    bytes += size.bytes;
    cpb += size.cpb;
    return true;
  };
  const indexOf = new Map(sources.map((source) => [source.kb.id, source.index]));
  for (const hit of hits) {
    if (!take(hit)) {
      if (chosen.length > 0) continue;
      break;
    }
    const index = indexOf.get(hit.kb.id);
    if (!index) continue;
    for (const neighbour of index.fileChunks(hit.chunk.file, hit.chunk.ord - NEIGHBOURS, hit.chunk.ord + NEIGHBOURS)) {
      if (neighbour.id !== hit.chunk.id) take({ kb: hit.kb, chunk: neighbour, score: hit.score });
    }
  }
  return toDocs(chosen);
}
