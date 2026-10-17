import { isByokGroupUrl, isByokTargetUrl } from '../../shared/types';
import type { SearchMode } from '../../shared/types';
import { sendLog } from '../helpers';
import { planQuery } from './router';
import { planQueryLlm, planQueryWeb } from './planner';
import { searchDdg, SerpChallengeError } from './serp';
import { SEARCH_BLOCKED_KEY } from './blocked';
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
import { citationHost } from '../../shared/citations';
import { buildCitedPrompt, linkifyCitations, synthesize } from './synthesize';
import type { QueryPlan, SearchOutcome, SerpHit, SourceDoc, TemporalFilter } from './types';
import type { ResearchPhaseId } from '../../shared/researchProgress';

export type { SearchOutcome, SerpHit, SourceDoc } from './types';
export { buildSearchHistory } from './history';

export type SearchProgress =
  /** The phases this search will go through, sent first so the whole checklist shows at once. */
  | { stage: 'outline'; phases: ResearchPhaseId[] }
  | { stage: 'planning'; queries: string[] }
  | { stage: 'searched'; hits: number }
  | { stage: 'fetching'; count: number }
  | { stage: 'read'; host: string }
  | { stage: 'readFailed'; host: string }
  | { stage: 'analyzing' }
  | { stage: 'summarizing'; total: number }
  | { stage: 'summarized'; kept: boolean }
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
 * On BYOK the planner is a cheap side call: every standard search gets one, quick mode only with a
 * thread. On a browser provider it is a full extra round trip on the answer's lane, so it runs only
 * for follow-ups and long standard requests that need concrete queries.
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
    SEARCH_BLOCKED_KEY,
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

interface CollectedHits {
  hits: SerpHit[];
  /** Some queries got the verification page while others answered: fewer sources than the plan would have found. */
  partiallyBlocked: boolean;
}

async function collectHits(plan: QueryPlan, locale: string): Promise<CollectedHits> {
  const first = await runQueries(plan.queries, plan.temporal, locale);
  if (first.hits.length > 0) return { hits: first.hits, partiallyBlocked: first.challenged };
  if (first.challenged) throw challengeError();
  if (plan.temporal === 'none') return { hits: [], partiallyBlocked: false };

  sendLog(`🔎 [Search] the "${plan.temporal}" recency filter left no results — retrying without it`);
  const retry = await runQueries(plan.queries, 'none', locale);
  if (retry.hits.length === 0 && retry.challenged) throw challengeError();
  return { hits: retry.hits, partiallyBlocked: retry.challenged };
}

export async function searchSourceList(query: string, locale: string, limit: number): Promise<SerpHit[]> {
  const plan = planQuery(query);
  sendLog(`🔎 [Search] list mode temporal=${plan.temporal} — "${preview(query)}"`);
  const { hits } = await collectHits(plan, locale);
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
  onProgress: ((progress: SearchProgress) => void) | undefined,
  mapFactor: number = SEARCH_MAP_OVERFLOW_FACTOR,
): Promise<SourceDoc[]> {
  const budget = reserveForHistory(synthesisBudget(targetUrl), history);
  if (!isByokTargetUrl(targetUrl)) {
    const relevant = scored.map((entry) => entry.doc);
    // A web provider has no cheap side channel, so mapping costs one serial round trip per
    // page. When the sources already fit, extracting keeps the wording the summaries would lose.
    const mapped = overflowsBudget(relevant, budget, mapFactor)
      ? await mapOnWebProvider(relevant, query, targetUrl, locale, summaryReporter(onProgress, relevant.length))
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
  const onEach = summaryReporter(onProgress, mapInputs.length);
  return fitToBudget(
    mapper ? await mapper.collect(mapInputs, onEach) : await mapDocuments(mapInputs, query, targetUrl, locale, onEach),
    budget.bytes,
  );
}

/** Opens the summarize phase with its count, and returns what reports each page as it finishes. */
function summaryReporter(
  onProgress: ((progress: SearchProgress) => void) | undefined,
  total: number,
): ((kept: boolean) => void) | undefined {
  if (!onProgress) return undefined;
  onProgress({ stage: 'summarizing', total });
  return (kept) => onProgress({ stage: 'summarized', kept });
}

/**
 * How far over the prompt budget the sources must run before summarizing them page by page (a
 * serial ~10 s round trip each on a web provider) is worth it. A search wants a quick answer, so it
 * waits until two thirds of the text would be dropped; pages the user named must all be read, so
 * anything that does not fit gets summarized.
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
  onEach: ((kept: boolean) => void) | undefined,
): Promise<SourceDoc[]> {
  sendLog(`🔎 [Search] Sources overflow the prompt — summarizing ${docs.length} page(s) one at a time first...`);
  const mapped = await mapDocuments(docs, query, targetUrl, locale, onEach);
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
  // Summarizing page by page is certain only on BYOK standard; a web provider decides once it sees
  // whether the pages overflow, and the phase joins the list then.
  onProgress?.({
    stage: 'outline',
    phases: [
      ...(channel === 'none' ? [] : ['plan' as const]),
      'search', 'read',
      ...(isByok && mode === 'standard' ? ['summarize' as const] : []),
      'write',
    ],
  });
  // Tens of seconds can pass here; without this the UI sits on the previous stage and reads as a hang.
  if (channel !== 'none') onProgress?.({ stage: 'planning', queries: [] });
  const plan = await buildPlan(channel, query, targetUrl, locale, history);
  sendLog(`🔎 [Search] mode=${mode} temporal=${plan.temporal} queries=${plan.queries.length} — "${preview(query)}"`);
  if (channel !== 'none') sendLog(`🔎 [Search] planned queries: ${JSON.stringify(plan.queries)}`);

  // Everything downstream — ranking, extraction, the answer itself — reads the question, so a
  // follow-up must arrive here already carrying its subject.
  const question = plan.resolved?.trim() || query;
  if (question !== query) sendLog(`🔎 [Search] follow-up resolved to "${preview(question)}"`);

  onProgress?.({ stage: 'planning', queries: plan.queries });

  const { hits, partiallyBlocked } = await collectHits(plan, locale);
  if (hits.length === 0) {
    throw new SearchPipelineError('search.error.noResults', 'No search results found');
  }
  sendLog(`🔎 [Search] ${hits.length} results from DuckDuckGo${partiallyBlocked ? ' (some queries were challenged)' : ''} — fetching top pages...`);
  onProgress?.({ stage: 'searched', hits: hits.length });

  const orderedHits = rankHits(hits, question, plan.temporal !== 'none');
  const defaultMaxSources = mode === 'quick' ? QUICK_MAX_SOURCES : isByok ? BYOK_MAX_SOURCES : DEFAULT_MAX_SOURCES;
  const maxSources = maxSourcesOverride ?? defaultMaxSources;
  const targets = selectTargets(orderedHits, maxSources + HARVEST_SPARE_TARGETS, true);
  onProgress?.({ stage: 'fetching', count: Math.min(targets.length, maxSources) });
  const mapper = isByok && mode === 'standard' && isByokGroupUrl(targetUrl)
    ? createDocumentMapper(question, targetUrl, locale)
    : null;
  if (mapper) sendLog(`🔎 [Search] Summarizing as pages arrive (${mapConcurrency(targetUrl)} at a time)...`);
  const docs = await harvest(
    targets,
    maxSources,
    (url) => onProgress?.({ stage: 'read', host: citationHost(url) }),
    mapper ? (doc) => mapper.enqueue(doc) : undefined,
    (url) => onProgress?.({ stage: 'readFailed', host: citationHost(url) }),
  );
  if (docs.length === 0) {
    throw new SearchPipelineError('search.error.noSources', 'No source pages could be read');
  }

  onProgress?.({ stage: 'analyzing' });
  const scored = rankSourcesScored(docs, question);
  const sources = mode === 'quick'
    ? buildQuickSources(scored, plan, targetUrl, history)
    : await buildSources(scored, question, plan, targetUrl, locale, mapper, history, onProgress);
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
  return { answer: linkifyCitations(raw, sources), sources, ...(partiallyBlocked ? { partiallyBlocked } : {}) };
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
  onProgress?.({ stage: 'outline', phases: ['read', 'write'] });
  onProgress?.({ stage: 'fetching', count: Math.min(unique.length, maxSources) });

  // No `selectTargets`: it caps hits per host, and five pages the user named from one site are
  // five pages they want read.
  const docs = await harvest(
    unique.map((url) => ({ title: url, url })),
    maxSources,
    (url) => onProgress?.({ stage: 'read', host: citationHost(url) }),
    undefined,
    (url) => onProgress?.({ stage: 'readFailed', host: citationHost(url) }),
  );
  if (docs.length === 0) {
    throw new SearchPipelineError('search.error.noSources', 'No source pages could be read');
  }

  onProgress?.({ stage: 'analyzing' });
  const sources = await buildSources(
    rankSourcesScored(docs, query), query, plan, targetUrl, locale, null, history, onProgress,
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
