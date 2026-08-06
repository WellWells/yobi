import { byokConcurrencyCeiling, runByokCompletion } from '../providers/byokClient';
import { Semaphore } from '../flow/lanes';
import { sendLog } from '../helpers';
import { languageForLocale } from './synthesize';
import { MAP_DOC_INPUT_CHARS } from './budgets';
import type { SourceDoc } from './types';

const MAP_IDLE_TIMEOUT_MS = 90_000;
const IRRELEVANT_MARKER = 'NONE';

/**
 * Upper bound on summaries in flight, whatever the key group's size. Past this the wall-clock
 * win flattens out — the stage is already down to its slowest single document — while the
 * burst of simultaneous requests keeps growing.
 */
const MAP_CONCURRENCY_CAP = 8;

/**
 * How many summaries this provider may run at once.
 *
 * It used to be a flat 4 for a group and 1 for a single key. The 4 was the whole reason a
 * 12-source research step spent 34 of its 60 seconds here: three waves of four, each wave
 * waiting on its slowest document. Rotation hands every concurrent call a different key, so
 * the honest ceiling is how many keys there are — one key stays at one, because there is
 * nothing to rotate across and a burst would race that key's own rate limit.
 */
export function mapConcurrency(targetUrl: string): number {
  return Math.min(MAP_CONCURRENCY_CAP, byokConcurrencyCeiling(targetUrl));
}

/**
 * Below this a document is carried whole instead of summarized.
 *
 * Summarizing a 1,100-character page into 400 characters spends a model call — and a slot in
 * the concurrency window — to save 700 characters of a budget measured in hundreds of
 * thousands. The synthesis prompt already reads raw extracted text on every non-BYOK search,
 * so a short source going in untouched is the normal case, not a degraded one.
 *
 * Kept deliberately low, because this call is not only a summariser: it is also the relevance
 * filter, and the only one that can tell a page about "Signal" from a page about "SignalPro"
 * — BM25 cannot. A skipped page is therefore a page that can no longer be dropped, and it
 * would reach both the answer and the source list the user sees. An observed run had an
 * off-topic source filtered out at 2,056 characters, so the threshold sits below that: it
 * buys back the calls that could never have paid for themselves and no others.
 */
export const MAP_MIN_DOC_CHARS = 1_500;

export interface DocumentMapper {
  /**
   * Starts a document's summary. Called the moment a page is fetched, so the map stage runs
   * underneath the remaining fetches instead of after all of them. Repeat calls for the same
   * document are ignored.
   */
  enqueue(doc: SourceDoc): void;
  /**
   * Awaits the summaries for `docs` in that order, dropping the ones with nothing relevant
   * and renumbering what survives. Documents never enqueued are mapped here.
   */
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

  // The short-document check happens BEFORE the semaphore: a page that needs no model call
  // must not hold a slot that a long one is waiting for.
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

/** The all-at-once form, for callers with every document already in hand. */
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
