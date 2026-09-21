import { isByokGroupUrl, isByokTargetUrl } from '../../shared/types';
import type { SearchMode } from '../../shared/types';
import { sendLog } from '../helpers';
import { planQuery } from './router';
import { planQueryLlm, planQueryWeb } from './planner';
import { searchDdg, SerpChallengeError } from './serp';
import { harvest, selectTargets, DEFAULT_MAX_SOURCES, HARVEST_SPARE_TARGETS } from './harvest';
import { rankHits, rankSourcesScored } from './rank';
import type { ScoredSource } from './rank';
import { extractRelevant } from './extract';
import { createDocumentMapper, mapConcurrency, mapDocuments } from './mapReduce';
import type { DocumentMapper } from './mapReduce';
import { isLeanPromptProvider, quickSynthesisBudget, reserveForHistory, synthesisBudget, UNBOUNDED } from './budgets';
import type { SynthesisBudget } from './budgets';
import { charsPlusBreaks, utf8Len } from '../../shared/textBudget';
import { isFetchableWebUrl } from '../../shared/webUrl';
import { buildCitedPrompt, linkifyCitations, synthesize } from './synthesize';
import type { QueryPlan, SearchOutcome, SerpHit, SourceDoc, TemporalFilter } from './types';

export type { SearchOutcome, SerpHit, SourceDoc } from './types';
export { buildSearchHistory } from './history';

export type SearchProgress =
  | { stage: 'planning'; queries: string[] }
  | { stage: 'fetching'; count: number }
  | { stage: 'read'; host: string }
  | { stage: 'analyzing' }
  | { stage: 'synthesizing' };

export class SearchPipelineError extends Error {
  readonly i18nKey: string;

  constructor(i18nKey: string, fallback: string) {
    super(fallback);
    this.i18nKey = i18nKey;
  }
}

const BYOK_MAX_SOURCES = 12;
const BYOK_MAP_MAX_SINGLE_KEY = 8;
const QUICK_MAX_SOURCES = 2;

function preview(text: string): string {
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function interleave<T>(lists: T[][]): T[] {
  const merged: T[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let i = 0; i < longest; i++) {
    for (const list of lists) {
      if (i < list.length) merged.push(list[i]);
    }
  }
  return merged;
}

type PlannerChannel = 'byok' | 'web' | 'none';

/*
 * Who pays for a planner, and what it buys.
 *
 * A key makes it a cheap side call on its own connection, so every standard search gets one and
 * quick mode joins in as soon as there is a thread to read. A browser interface has no side
 * channel: the planner is a second full navigate-fill-wait on the same exclusive lane the answer
 * needs, so it is not overlapped with the search, it is added to it. Follow-ups need subject
 * resolution; long research instructions need concrete queries instead of a verbatim search.
 * Short first questions remain free, as does quick mode without conversation history.
 */
function plannerChannel(targetUrl: string, mode: SearchMode, history: string, query: string): PlannerChannel {
  if (isByokTargetUrl(targetUrl)) return mode === 'standard' || history ? 'byok' : 'none';
  return history || (mode === 'standard' && query.length > 120) ? 'web' : 'none';
}

async function buildPlan(
  channel: PlannerChannel,
  query: string,
  targetUrl: string,
  locale: string,
  history: string,
): Promise<QueryPlan> {
  if (channel === 'byok') return planQueryLlm(query, targetUrl, locale, history);
  if (channel === 'web') return planQueryWeb(query, targetUrl, locale, history);
  return planQuery(query);
}

function challengeError(): SearchPipelineError {
  return new SearchPipelineError(
    'search.error.ddgChallenge',
    'DuckDuckGo is temporarily asking for human verification — try again in a few minutes',
  );
}

async function runQueries(
  queries: string[],
  temporal: TemporalFilter,
  locale: string,
): Promise<{ hits: SerpHit[]; challenged: boolean }> {
  let challenged = false;
  const perQuery = await Promise.all(
    queries.map((q) => searchDdg(q, temporal, locale).catch((err) => {
      if (err instanceof SerpChallengeError) {
        challenged = true;
        sendLog(`🔎 [Search] ${err.message}`);
      } else {
        sendLog(`🔎 [Search] ddg query failed (${err instanceof Error ? err.message : String(err)})`);
      }
      return [] as SerpHit[];
    })),
  );
  return { hits: interleave(perQuery), challenged };
}

async function collectHits(plan: QueryPlan, locale: string): Promise<SerpHit[]> {
  const first = await runQueries(plan.queries, plan.temporal, locale);
  if (first.hits.length > 0) return first.hits;
  if (first.challenged) throw challengeError();
  if (plan.temporal === 'none') return [];

  sendLog(`🔎 [Search] the "${plan.temporal}" recency filter left no results — retrying without it`);
  const retry = await runQueries(plan.queries, 'none', locale);
  if (retry.hits.length === 0 && retry.challenged) throw challengeError();
  return retry.hits;
}

export async function searchSourceList(query: string, locale: string, limit: number): Promise<SerpHit[]> {
  const plan = planQuery(query);
  sendLog(`🔎 [Search] list mode temporal=${plan.temporal} — "${preview(query)}"`);
  const hits = await collectHits(plan, locale);
  return selectTargets(rankHits(hits, query, plan.temporal !== 'none'), limit);
}

async function buildSources(
  scored: ScoredSource[],
  query: string,
  plan: QueryPlan,
  targetUrl: string,
  locale: string,
  mapper: DocumentMapper | null,
  history: string,
  mapFactor: number = SEARCH_MAP_OVERFLOW_FACTOR,
): Promise<SourceDoc[]> {
  const budget = reserveForHistory(synthesisBudget(targetUrl), history);
  if (!isByokTargetUrl(targetUrl)) {
    const relevant = scored.map((entry) => entry.doc);
    // A web provider has no cheap side channel, so mapping costs one serial round trip per
    // page. When the sources already fit, extracting keeps the wording the summaries would lose.
    const mapped = overflowsBudget(relevant, budget, mapFactor)
      ? await mapOnWebProvider(relevant, query, targetUrl, locale)
      : relevant;
    const sources = extractRelevant(mapped, plan.queries.join(' '), budget);
    sendLog(`🔎 [Search] Extracted ${sources.length} sources (${describeUsage(sources, budget)}) for single-shot synthesis`);
    return sources;
  }
  const relevant = scored.filter((entry, index) => index === 0 || entry.score > 0).map((entry) => entry.doc);
  const mapInputs = isByokGroupUrl(targetUrl) ? relevant : relevant.slice(0, BYOK_MAP_MAX_SINGLE_KEY);
  if (mapInputs.length < scored.length) {
    sendLog(`🔎 [Search] map input pruned ${scored.length} → ${mapInputs.length} (zero-relevance / single-key cap)`);
  }
  sendLog(mapper
    ? `🔎 [Search] Collecting ${mapInputs.length} summaries (started as pages arrived)...`
    : `🔎 [Search] Summarizing ${mapInputs.length} sources (${mapConcurrency(targetUrl)} at a time)...`);
  return fitToBudget(
    mapper ? await mapper.collect(mapInputs) : await mapDocuments(mapInputs, query, targetUrl, locale),
    budget.bytes,
  );
}

/**
 * How far over the prompt budget the sources must run before summarizing them page by page is
 * worth it. On a web provider each page is a serial round trip of ~10 s, so this is spending
 * real time to stop `extractRelevant` throwing text away.
 *
 * Two thresholds, because the two callers are asking different questions:
 *
 * - A SEARCH found these pages itself and the user wants an answer, quickly. Gemini's budget is
 *   ~28,700 chars over 3 sources, so a 1.5x rule would fire at ~14k chars a page — an ordinary
 *   long article — and quietly add 30 s to every search. At 3x two thirds of the text would be
 *   dropped, which is when reading it properly earns the wait.
 * - GIVEN URLS are pages the user named and asked to have read. Dropping any of them to fit one
 *   prompt is the failure being fixed, so anything that does not fit gets summarized.
 */
const SEARCH_MAP_OVERFLOW_FACTOR = 3;
const GIVEN_URLS_MAP_OVERFLOW_FACTOR = 1;

function overflowsBudget(docs: SourceDoc[], budget: SynthesisBudget, factor: number): boolean {
  if (budget.charsPlusBreaks !== UNBOUNDED) {
    const total = docs.reduce((sum, doc) => sum + charsPlusBreaks(doc.text), 0);
    if (total > budget.charsPlusBreaks * factor) return true;
  }
  if (budget.bytes !== UNBOUNDED) {
    const total = docs.reduce((sum, doc) => sum + utf8Len(doc.text), 0);
    if (total > budget.bytes * factor) return true;
  }
  return false;
}

async function mapOnWebProvider(
  docs: SourceDoc[],
  query: string,
  targetUrl: string,
  locale: string,
): Promise<SourceDoc[]> {
  sendLog(`🔎 [Search] Sources overflow the prompt — summarizing ${docs.length} page(s) one at a time first...`);
  const mapped = await mapDocuments(docs, query, targetUrl, locale);
  // Every page can come back irrelevant; handing synthesis nothing would turn a slow answer
  // into no answer, so fall back to the extractive path over the originals.
  if (mapped.length === 0) {
    sendLog('🔎 [Search] map returned nothing — falling back to extraction over the raw sources');
    return docs;
  }
  return mapped;
}

function buildQuickSources(
  scored: ScoredSource[],
  plan: QueryPlan,
  targetUrl: string,
  history: string,
): SourceDoc[] {
  const budget = reserveForHistory(quickSynthesisBudget(targetUrl), history);
  const sources = extractRelevant(scored.map((entry) => entry.doc), plan.queries.join(' '), budget);
  sendLog(`🔎 [Search] Quick mode packed ${sources.length} sources (${describeUsage(sources, budget)})`);
  return sources;
}

function describeUsage(sources: SourceDoc[], budget: SynthesisBudget): string {
  const parts: string[] = [];
  if (budget.bytes !== UNBOUNDED) {
    parts.push(`${sources.reduce((sum, doc) => sum + utf8Len(doc.text), 0)}/${budget.bytes} bytes`);
  }
  if (budget.charsPlusBreaks !== UNBOUNDED) {
    parts.push(`${sources.reduce((sum, doc) => sum + charsPlusBreaks(doc.text), 0)}/${budget.charsPlusBreaks} chars+breaks`);
  }
  return parts.join(', ') || 'unbounded';
}

function fitToBudget(sources: SourceDoc[], budgetBytes: number): SourceDoc[] {
  const kept: SourceDoc[] = [];
  let used = 0;
  for (const doc of sources) {
    const size = utf8Len(doc.text);
    if (kept.length > 0 && used + size > budgetBytes) break;
    kept.push({ ...doc, id: kept.length + 1 });
    used += size;
  }
  return kept;
}

export async function runWebSearch(
  query: string,
  targetUrl: string,
  locale: string,
  onProgress?: (progress: SearchProgress) => void,
  mode: SearchMode = 'standard',
  maxSourcesOverride?: number,
  history = '',
  urls: readonly string[] = [],
): Promise<SearchOutcome> {
  if (urls.length > 0) return runOverGivenUrls(query, targetUrl, locale, onProgress, maxSourcesOverride, history, urls);
  const isByok = isByokTargetUrl(targetUrl);
  // Quick mode skips the planner to stay quick — but a follow-up without it is searched
  // verbatim, and no amount of speed saves an answer to the wrong question.
  const channel = plannerChannel(targetUrl, mode, history, query);
  // Tens of seconds pass here on a browser provider; without this the UI sits on the previous
  // stage for all of them and reads as a hang.
  if (channel === 'web') onProgress?.({ stage: 'planning', queries: [] });
  const plan = await buildPlan(channel, query, targetUrl, locale, history);
  sendLog(`🔎 [Search] mode=${mode} temporal=${plan.temporal} queries=${plan.queries.length} — "${preview(query)}"`);
  if (channel !== 'none') sendLog(`🔎 [Search] planned queries: ${JSON.stringify(plan.queries)}`);

  // Everything downstream — ranking, extraction, the answer itself — reads the question, so a
  // follow-up must arrive here already carrying its subject.
  const question = plan.resolved?.trim() || query;
  if (question !== query) sendLog(`🔎 [Search] follow-up resolved to "${preview(question)}"`);

  onProgress?.({ stage: 'planning', queries: plan.queries });

  const hits = await collectHits(plan, locale);
  if (hits.length === 0) {
    throw new SearchPipelineError('search.error.noResults', 'No search results found');
  }
  sendLog(`🔎 [Search] ${hits.length} results from DuckDuckGo — fetching top pages...`);

  const orderedHits = rankHits(hits, question, plan.temporal !== 'none');
  const defaultMaxSources = mode === 'quick' ? QUICK_MAX_SOURCES : isByok ? BYOK_MAX_SOURCES : DEFAULT_MAX_SOURCES;
  const maxSources = maxSourcesOverride ?? defaultMaxSources;
  const targets = selectTargets(orderedHits, maxSources + HARVEST_SPARE_TARGETS);
  onProgress?.({ stage: 'fetching', count: Math.min(targets.length, maxSources) });
  const mapper = isByok && mode === 'standard' && isByokGroupUrl(targetUrl)
    ? createDocumentMapper(question, targetUrl, locale)
    : null;
  if (mapper) sendLog(`🔎 [Search] Summarizing as pages arrive (${mapConcurrency(targetUrl)} at a time)...`);
  const docs = await harvest(
    targets,
    maxSources,
    (url) => onProgress?.({ stage: 'read', host: hostOf(url) }),
    mapper ? (doc) => mapper.enqueue(doc) : undefined,
  );
  if (docs.length === 0) {
    throw new SearchPipelineError('search.error.noSources', 'No source pages could be read');
  }

  onProgress?.({ stage: 'analyzing' });
  const scored = rankSourcesScored(docs, question);
  const sources = mode === 'quick'
    ? buildQuickSources(scored, plan, targetUrl, history)
    : await buildSources(scored, question, plan, targetUrl, locale, mapper, history);
  if (sources.length === 0) {
    throw new SearchPipelineError('search.error.noRelevant', 'No sources were relevant to the query');
  }

  onProgress?.({ stage: 'synthesizing' });
  sendLog('🔎 [Search] Synthesizing cited answer...');
  const raw = await synthesize(
    buildCitedPrompt({
      query: question,
      docs: sources,
      locale,
      concise: mode === 'quick',
      lean: isLeanPromptProvider(targetUrl),
      history,
    }),
    targetUrl,
  );
  return { answer: linkifyCitations(raw, sources), sources };
}

/**
 * The caller already knows which pages to read, so there is nothing to plan and nothing to
 * search: harvest exactly these, then reuse the same map/extract/synthesize tail. Used by
 * `research`'s `urls` field — "summarize these five articles for me".
 */
async function runOverGivenUrls(
  query: string,
  targetUrl: string,
  locale: string,
  onProgress: ((progress: SearchProgress) => void) | undefined,
  maxSourcesOverride: number | undefined,
  history: string,
  urls: readonly string[],
): Promise<SearchOutcome> {
  // Regex-only plan: its queries are the extraction keywords, and a planner round trip buys
  // nothing when the pages are already chosen.
  const plan = planQuery(query);
  // Defence in depth: the skill already filtered, but this function is the last stop before a
  // URL reaches a page loader, and a `file://` here would read a local file as a "source".
  const unique = [...new Set(urls.map((url) => url.trim()).filter(Boolean))].filter(isFetchableWebUrl);
  if (unique.length === 0) {
    throw new SearchPipelineError('search.error.noSources', 'No readable page URLs were given');
  }
  const maxSources = maxSourcesOverride ?? unique.length;
  sendLog(`🔎 [Search] reading ${unique.length} given page(s) — "${preview(query)}"`);
  onProgress?.({ stage: 'fetching', count: Math.min(unique.length, maxSources) });

  // No `selectTargets`: it caps hits per host, and five pages the user named from one site are
  // five pages they want read.
  const docs = await harvest(
    unique.map((url) => ({ title: url, url })),
    maxSources,
    (url) => onProgress?.({ stage: 'read', host: hostOf(url) }),
  );
  if (docs.length === 0) {
    throw new SearchPipelineError('search.error.noSources', 'No source pages could be read');
  }

  onProgress?.({ stage: 'analyzing' });
  const sources = await buildSources(
    rankSourcesScored(docs, query), query, plan, targetUrl, locale, null, history,
    GIVEN_URLS_MAP_OVERFLOW_FACTOR,
  );
  if (sources.length === 0) {
    throw new SearchPipelineError('search.error.noRelevant', 'No sources were relevant to the query');
  }

  onProgress?.({ stage: 'synthesizing' });
  sendLog('🔎 [Search] Synthesizing cited answer...');
  const raw = await synthesize(
    buildCitedPrompt({
      query,
      docs: sources,
      locale,
      concise: false,
      lean: isLeanPromptProvider(targetUrl),
      history,
    }),
    targetUrl,
  );
  return { answer: linkifyCitations(raw, sources), sources };
}
