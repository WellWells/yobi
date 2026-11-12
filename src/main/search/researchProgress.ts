import { RESEARCH_PHASE_ORDER } from '../../shared/researchProgress';
import type {
  ResearchPhase, ResearchPhaseId, ResearchProgress, ResearchResult, ResearchResultState, ResearchSearch,
} from '../../shared/researchProgress';
import { hitKey } from './fuse';
import type { SearchProgress } from './index';
import type { SerpHit } from './types';

/*
 * Pure: the pipeline's events in, the checklist out. Every function returns a new object, because
 * each snapshot is sent to the renderer as it stands and must not change underneath it.
 */

export const EMPTY_RESEARCH: ResearchProgress = { phases: [] };

/* The snapshot is kept in the run file and sent whole on every event: the result lists are bounded. */
export const MAX_RESULTS_PER_SEARCH = 20;
export const MAX_SEARCHES = 12;
export const MAX_RESULT_TITLE = 160;
export const MAX_RESULT_URL = 2_048;

function clipTitle(title: string): string {
  const trimmed = title.trim();
  return trimmed.length > MAX_RESULT_TITLE ? `${trimmed.slice(0, MAX_RESULT_TITLE - 1)}…` : trimmed;
}

function toSearch(query: string, hits: readonly SerpHit[], refused: boolean): ResearchSearch {
  const results: ResearchResult[] = hits
    .filter((hit) => hit.url.length <= MAX_RESULT_URL)
    .slice(0, MAX_RESULTS_PER_SEARCH)
    .map((hit) => ({ title: clipTitle(hit.title) || hit.url, url: hit.url, ...(hit.date ? { date: hit.date } : {}) }));
  return { query, results, ...(refused ? { refused: true as const } : {}) };
}

/** A query sent again (the retry without a recency filter) replaces its earlier list. */
function withSearch(progress: ResearchProgress, search: ResearchSearch): ResearchProgress {
  const searches = progress.searches ?? [];
  const at = searches.findIndex((entry) => entry.query === search.query);
  if (at >= 0) return { ...progress, searches: searches.map((entry, index) => (index === at ? search : entry)) };
  if (searches.length >= MAX_SEARCHES) return progress;
  return { ...progress, searches: [...searches, search] };
}

const STATE_RANK: Record<ResearchResultState, number> = { unreadable: 1, read: 2, used: 3 };

/** Marks every listed copy of these pages; a mark only ever goes up (used > read > unreadable). */
function markResults(progress: ResearchProgress, urls: readonly string[], state: ResearchResultState): ResearchProgress {
  if (!progress.searches || urls.length === 0) return progress;
  const keys = new Set(urls.map(hitKey));
  const mark = (result: ResearchResult): ResearchResult => (
    keys.has(hitKey(result.url)) && (result.state ? STATE_RANK[result.state] : 0) < STATE_RANK[state]
      ? { ...result, state }
      : result
  );
  return { ...progress, searches: progress.searches.map((search) => ({ ...search, results: search.results.map(mark) })) };
}

/** The links-only `search` tool's step: its one search's results, no checklist. */
export function searchSnapshot(query: string, hits: readonly SerpHit[], refused: boolean): ResearchProgress {
  return { phases: [], searches: [toSearch(query, hits, refused)] };
}

function withPhase(progress: ResearchProgress, id: ResearchPhaseId): ResearchPhase[] {
  if (progress.phases.some((phase) => phase.id === id)) return progress.phases;
  // A phase the outline could not promise (a web provider summarizes only when the pages overflow)
  // joins at its place in the order.
  const rank = RESEARCH_PHASE_ORDER.indexOf(id);
  const phases = [...progress.phases];
  const at = phases.findIndex((phase) => RESEARCH_PHASE_ORDER.indexOf(phase.id) > rank);
  phases.splice(at < 0 ? phases.length : at, 0, { id, status: 'pending' });
  return phases;
}

function update(
  progress: ResearchProgress,
  id: ResearchPhaseId,
  patch: (phase: ResearchPhase) => Partial<ResearchPhase>,
): ResearchProgress {
  return {
    ...progress,
    phases: withPhase(progress, id).map((phase) => (phase.id === id ? { ...phase, ...patch(phase) } : phase)),
  };
}

/** Starts a phase; whatever ran before it in the order is finished by now. */
function start(progress: ResearchProgress, id: ResearchPhaseId, patch: Partial<ResearchPhase> = {}): ResearchProgress {
  const rank = RESEARCH_PHASE_ORDER.indexOf(id);
  const started = update(progress, id, () => ({ status: 'running', ...patch }));
  return {
    ...started,
    phases: started.phases.map((phase) => (
      phase.status !== 'failed' && RESEARCH_PHASE_ORDER.indexOf(phase.id) < rank ? { ...phase, status: 'done' } : phase
    )),
  };
}

function finishPhase(progress: ResearchProgress, id: ResearchPhaseId, patch: Partial<ResearchPhase> = {}): ResearchProgress {
  return update(progress, id, () => ({ status: 'done', ...patch }));
}

export function reduceResearchProgress(progress: ResearchProgress, event: SearchProgress): ResearchProgress {
  switch (event.stage) {
    case 'outline':
      return { phases: event.phases.map((id) => ({ id, status: 'pending' })) };
    case 'planning':
      // Empty: the planner is still writing. Queries: the plan is settled and the search starts.
      if (event.queries.length === 0) return start(progress, 'plan');
      return start(
        progress.phases.some((phase) => phase.id === 'plan')
          ? finishPhase(progress, 'plan', { queries: event.queries })
          : progress,
        'search',
      );
    case 'results':
      return withSearch(progress, toSearch(event.query, event.hits, event.refused));
    case 'searched':
      return finishPhase(progress, 'search', { hits: event.hits });
    case 'fetching':
      return start(progress, 'read', { done: 0, total: event.count });
    case 'read':
      return markResults(update(progress, 'read', (phase) => ({ done: (phase.done ?? 0) + 1 })), [event.url], 'read');
    case 'readFailed':
      return markResults(update(progress, 'read', (phase) => {
        const hosts = phase.failedHosts ?? [];
        return {
          failed: (phase.failed ?? 0) + 1,
          failedHosts: hosts.includes(event.host) ? hosts : [...hosts, event.host],
        };
      }), [event.url], 'unreadable');
    case 'analyzing':
      return finishPhase(progress, 'read');
    case 'summarizing':
      return start(progress, 'summarize', { done: 0, total: event.total, dropped: 0 });
    case 'summarized':
      return update(progress, 'summarize', (phase) => ({
        done: (phase.done ?? 0) + 1,
        dropped: (phase.dropped ?? 0) + (event.kept ? 0 : 1),
      }));
    case 'synthesizing':
      return start(progress, 'write');
    case 'finding':
      return start(progress, 'analyze', { done: 0, total: event.total });
    case 'found':
      return update(progress, 'analyze', (phase) => ({ done: (phase.done ?? 0) + 1 }));
    case 'reviewing':
      return start(progress, 'review');
    case 'followups':
      // No gaps: the check is all the review does. Gaps: each is counted as it is researched.
      return event.questions.length === 0
        ? finishPhase(progress, 'review', { queries: [] })
        : update(progress, 'review', () => ({ queries: event.questions, done: 0, total: event.questions.length }));
    case 'followedUp':
      return update(progress, 'review', (phase) => ({ done: (phase.done ?? 0) + 1 }));
    case 'fetchingMore':
      // The read phase has finished once; its counts grow without starting it again.
      return update(progress, 'read', (phase) => ({ total: (phase.total ?? 0) + event.count }));
  }
}

/** `usedUrls`: the answer's sources, a result summary it cited included. */
export function finishResearch(progress: ResearchProgress, sources: number, usedUrls: readonly string[] = []): ResearchProgress {
  return markResults({
    ...progress,
    phases: progress.phases.map((phase) => (phase.status === 'failed' ? phase : { ...phase, status: 'done' })),
    sources,
  }, usedUrls, 'used');
}

/** Marks where it stopped: the phase that was running, or the first one that never started. */
export function failResearch(progress: ResearchProgress): ResearchProgress {
  const at = progress.phases.findIndex((phase) => phase.status === 'running');
  const target = at >= 0 ? at : progress.phases.findIndex((phase) => phase.status === 'pending');
  if (target < 0) return progress;
  return {
    ...progress,
    phases: progress.phases.map((phase, index) => (index === target ? { ...phase, status: 'failed' } : phase)),
  };
}
