import { isByokGroupUrl, isByokTargetUrl } from '../../shared/types';
import type { SearchMode } from '../../shared/types';
import { sendLog } from '../helpers';
import { planQuery } from './router';
import { planQueryLlm } from './planner';
import { searchDdg, SerpChallengeError } from './serp';
import { harvest, selectTargets, DEFAULT_MAX_SOURCES, HARVEST_SPARE_TARGETS } from './harvest';
import { rankHits, rankSourcesScored } from './rank';
import type { ScoredSource } from './rank';
import { extractRelevant } from './extract';
import { createDocumentMapper, mapConcurrency, mapDocuments } from './mapReduce';
import type { DocumentMapper } from './mapReduce';
import { isLeanPromptProvider, quickSynthesisBudget, synthesisBudget, UNBOUNDED } from './budgets';
import type { SynthesisBudget } from './budgets';
import { charsPlusBreaks, utf8Len } from '../../shared/textBudget';
import { buildCitedPrompt, linkifyCitations, synthesize } from './synthesize';
import type { QueryPlan, SearchOutcome, SerpHit, SourceDoc, TemporalFilter } from './types';

export type { SearchOutcome, SerpHit, SourceDoc } from './types';

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
): Promise<SourceDoc[]> {
  const budget = synthesisBudget(targetUrl);
  if (isByokTargetUrl(targetUrl)) {
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
  const sources = extractRelevant(scored.map((entry) => entry.doc), plan.queries.join(' '), budget);
  sendLog(`🔎 [Search] Extracted ${sources.length} sources (${describeUsage(sources, budget)}) for single-shot synthesis`);
  return sources;
}

function buildQuickSources(scored: ScoredSource[], plan: QueryPlan, targetUrl: string): SourceDoc[] {
  const budget = quickSynthesisBudget(targetUrl);
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
): Promise<SearchOutcome> {
  const isByok = isByokTargetUrl(targetUrl);
  const plan = isByok && mode === 'standard' ? await planQueryLlm(query, targetUrl, locale) : planQuery(query);
  sendLog(`🔎 [Search] mode=${mode} temporal=${plan.temporal} queries=${plan.queries.length} — "${preview(query)}"`);

  onProgress?.({ stage: 'planning', queries: plan.queries });

  const hits = await collectHits(plan, locale);
  if (hits.length === 0) {
    throw new SearchPipelineError('search.error.noResults', 'No search results found');
  }
  sendLog(`🔎 [Search] ${hits.length} results from DuckDuckGo — fetching top pages...`);

  const orderedHits = rankHits(hits, query, plan.temporal !== 'none');
  const defaultMaxSources = mode === 'quick' ? QUICK_MAX_SOURCES : isByok ? BYOK_MAX_SOURCES : DEFAULT_MAX_SOURCES;
  const maxSources = maxSourcesOverride ?? defaultMaxSources;
  const targets = selectTargets(orderedHits, maxSources + HARVEST_SPARE_TARGETS);
  onProgress?.({ stage: 'fetching', count: Math.min(targets.length, maxSources) });
  const mapper = isByok && mode === 'standard' && isByokGroupUrl(targetUrl)
    ? createDocumentMapper(query, targetUrl, locale)
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
  const scored = rankSourcesScored(docs, query);
  const sources = mode === 'quick'
    ? buildQuickSources(scored, plan, targetUrl)
    : await buildSources(scored, query, plan, targetUrl, locale, mapper);
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
      concise: mode === 'quick',
      lean: isLeanPromptProvider(targetUrl),
    }),
    targetUrl,
  );
  return { answer: linkifyCitations(raw, sources), sources };
}
