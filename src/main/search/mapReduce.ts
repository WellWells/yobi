import { byokConcurrencyCeiling, runByokCompletion } from '../providers/byokClient';
import { Semaphore } from '../flow/lanes';
import { sendLog } from '../helpers';
import { isByokTargetUrl } from '../../shared/types';
import { charsPlusBreaks, truncateToCharsPlusBreaks } from '../../shared/textBudget';
import { languageForLocale, runWorkerCompletion } from './synthesize';
import { mapDocInputChars } from './budgets';
import type { SourceDoc } from './types';

const MAP_IDLE_TIMEOUT_MS = 90_000;
const WEB_MAP_TIMEOUT_MS = 300_000;
const IRRELEVANT_MARKER = 'NONE';

const MAP_CONCURRENCY_CAP = 8;

/**
 * A web provider has ONE worker window and `llmLane` is a Mutex, so its map phase is serial
 * however many slots we hand out. Saying 1 here keeps the log honest and stops eight documents
 * from queueing behind each other on the lane while their timeouts run down.
 */
export function mapConcurrency(targetUrl: string): number {
  if (!isByokTargetUrl(targetUrl)) return 1;
  return Math.min(MAP_CONCURRENCY_CAP, byokConcurrencyCeiling(targetUrl));
}

export const MAP_MIN_DOC_CHARS = 1_500;

/**
 * A very long page still has to be read whole, so it is split into provider-sized pieces and
 * summarized piece by piece. Capped because each piece is a round trip: on a web provider those
 * are serial at ~10 s, and a runaway page would eat the whole run's wall clock.
 */
const MAX_CHUNKS_PER_DOC = 3;

export interface DocumentMapper {
  enqueue(doc: SourceDoc): void;
  collect(docs: SourceDoc[]): Promise<SourceDoc[]>;
}

/**
 * Splits text into pieces that each fit `budget` (measured in chars+breaks, the tightest of the
 * two provider measures). Prefers a paragraph, then a line, then a sentence boundary, so a piece
 * does not start mid-sentence and lose the subject of what it is summarizing.
 */
export function splitForBudget(text: string, budget: number, maxPieces: number): string[] {
  if (budget <= 0 || maxPieces <= 0) return [];
  if (charsPlusBreaks(text) <= budget) return [text];

  const pieces: string[] = [];
  let rest = text;
  while (rest.length > 0 && pieces.length < maxPieces) {
    if (charsPlusBreaks(rest) <= budget || pieces.length === maxPieces - 1) {
      pieces.push(truncateToCharsPlusBreaks(rest, budget));
      break;
    }
    const head = truncateToCharsPlusBreaks(rest, budget);
    const cut = lastBoundary(head);
    pieces.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  return pieces.map((piece) => piece.trim()).filter(Boolean);
}

/** Where to cut a piece so the next one starts cleanly; never earlier than half of it. */
function lastBoundary(head: string): number {
  const floor = Math.floor(head.length / 2);
  for (const marker of ['\n\n', '\n', '。', '. ']) {
    const at = head.lastIndexOf(marker);
    if (at > floor) return at + marker.length;
  }
  return head.length;
}

function runMapCompletion(targetUrl: string, prompt: string): Promise<string> {
  if (isByokTargetUrl(targetUrl)) {
    return runByokCompletion(targetUrl, prompt, MAP_IDLE_TIMEOUT_MS).then(({ response }) => response);
  }
  return runWorkerCompletion(prompt, targetUrl, WEB_MAP_TIMEOUT_MS, 'map');
}

export function createDocumentMapper(query: string, targetUrl: string, locale: string): DocumentMapper {
  const language = languageForLocale(locale);
  const semaphore = new Semaphore(mapConcurrency(targetUrl));
  const started = new Map<number, Promise<SourceDoc | null>>();
  const chunkBudget = mapDocInputChars(targetUrl);

  const summarize = async (doc: SourceDoc): Promise<SourceDoc | null> => {
    const pieces = splitForBudget(doc.text, chunkBudget, MAX_CHUNKS_PER_DOC);
    if (pieces.length === 0) return null;
    if (pieces.length > 1) {
      sendLog(`🔎 [Search] map ✂️ [${doc.id}] ${doc.url} — ${doc.text.length} chars over ${chunkBudget}, ${pieces.length} pieces`);
    }
    const summaries: string[] = [];
    for (const [index, piece] of pieces.entries()) {
      try {
        // Serial even on BYOK: the pieces of ONE document share a concurrency slot, so a long
        // page cannot starve the other documents of the map phase.
        const response = await runMapCompletion(targetUrl, buildMapPrompt(query, doc, piece, language));
        const summary = response.trim();
        if (summary && !isIrrelevant(summary)) summaries.push(summary);
      } catch (err) {
        const label = pieces.length > 1 ? `[${doc.id}.${index + 1}]` : `[${doc.id}]`;
        sendLog(`🔎 [Search] map ✗ ${label} ${doc.url} — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (summaries.length === 0) {
      sendLog(`🔎 [Search] map – [${doc.id}] no relevant content — dropped`);
      return null;
    }
    const text = summaries.join('\n');
    sendLog(`🔎 [Search] map ✓ [${doc.id}] ${doc.url} (${text.length} chars)`);
    return { ...doc, text };
  };

  const run = (doc: SourceDoc): Promise<SourceDoc | null> => {
    if (doc.text.length <= MAP_MIN_DOC_CHARS) {
      sendLog(`🔎 [Search] map ⤳ [${doc.id}] ${doc.url} (${doc.text.length} chars — carried whole)`);
      return Promise.resolve(doc);
    }
    return semaphore.runExclusive(() => summarize(doc));
  };

  const start = (doc: SourceDoc): Promise<SourceDoc | null> => {
    const existing = started.get(doc.id);
    if (existing) return existing;
    const fresh = run(doc);
    started.set(doc.id, fresh);
    return fresh;
  };

  return {
    enqueue(doc) {
      start(doc);
    },
    async collect(docs) {
      const settled = await Promise.all(docs.map(start));
      return settled
        .filter((doc): doc is SourceDoc => doc !== null)
        .map((doc, index) => ({ ...doc, id: index + 1 }));
    },
  };
}

export async function mapDocuments(
  docs: SourceDoc[],
  query: string,
  targetUrl: string,
  locale: string,
): Promise<SourceDoc[]> {
  const mapper = createDocumentMapper(query, targetUrl, locale);
  for (const doc of docs) mapper.enqueue(doc);
  return mapper.collect(docs);
}

function isIrrelevant(summary: string): boolean {
  return summary.replace(/[.。\s]/g, '').toUpperCase() === IRRELEVANT_MARKER;
}

function buildMapPrompt(query: string, doc: SourceDoc, body: string, language: string): string {
  return [
    `Extract from the source below only the facts, figures and quotes that help answer the question. Write them as concise bullet points in ${language}.`,
    'Use ONLY the source content — never add outside knowledge.',
    `If the source is irrelevant to the question, reply with exactly ${IRRELEVANT_MARKER} and nothing else.`,
    '',
    `## Question`,
    query,
    '',
    `## Source: ${doc.title}${doc.publishedAt ? ` (published ${doc.publishedAt})` : ''}`,
    body,
  ].join('\n');
}
