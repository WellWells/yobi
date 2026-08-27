import { byokConcurrencyCeiling, runByokCompletion } from '../providers/byokClient';
import { Semaphore } from '../flow/lanes';
import { sendLog } from '../helpers';
import { languageForLocale } from './synthesize';
import { MAP_DOC_INPUT_CHARS } from './budgets';
import type { SourceDoc } from './types';

const MAP_IDLE_TIMEOUT_MS = 90_000;
const IRRELEVANT_MARKER = 'NONE';

const MAP_CONCURRENCY_CAP = 8;

export function mapConcurrency(targetUrl: string): number {
  return Math.min(MAP_CONCURRENCY_CAP, byokConcurrencyCeiling(targetUrl));
}

export const MAP_MIN_DOC_CHARS = 1_500;

export interface DocumentMapper {
  enqueue(doc: SourceDoc): void;
  collect(docs: SourceDoc[]): Promise<SourceDoc[]>;
}

export function createDocumentMapper(query: string, targetUrl: string, locale: string): DocumentMapper {
  const language = languageForLocale(locale);
  const semaphore = new Semaphore(mapConcurrency(targetUrl));
  const started = new Map<number, Promise<SourceDoc | null>>();

  const summarize = async (doc: SourceDoc): Promise<SourceDoc | null> => {
    try {
      const { response } = await runByokCompletion(
        targetUrl,
        buildMapPrompt(query, doc, language),
        MAP_IDLE_TIMEOUT_MS,
      );
      const summary = response.trim();
      if (!summary || isIrrelevant(summary)) {
        sendLog(`🔎 [Search] map – [${doc.id}] no relevant content — dropped`);
        return null;
      }
      sendLog(`🔎 [Search] map ✓ [${doc.id}] ${doc.url} (${summary.length} chars)`);
      return { ...doc, text: summary };
    } catch (err) {
      sendLog(`🔎 [Search] map ✗ [${doc.id}] ${doc.url} — ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
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

function buildMapPrompt(query: string, doc: SourceDoc, language: string): string {
  const body = doc.text.length > MAP_DOC_INPUT_CHARS ? doc.text.slice(0, MAP_DOC_INPUT_CHARS) : doc.text;
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
