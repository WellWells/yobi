import { runWebSearch, SearchPipelineError } from '../../search';
import { SEARCH_BLOCKED_KEY, SEARCH_PARTIAL_BLOCK_NOTE, SearchBlockedError } from '../../search/blocked';
import { config } from '../../config';
import { getLangCache, t } from '../../i18n';
import { sendLog } from '../../helpers';
import type { SearchMode } from '../../../shared/types';
import type { SearchProgress } from '../../search';
import { EMPTY_RESEARCH, failResearch, finishResearch, reduceResearchProgress } from '../../search/researchProgress';
import type { ResearchProgress } from '../../../shared/researchProgress';
import type { FlowExecutorDeps } from '../types';
import { parseWebUrls } from './urlList';

const MIN_SOURCES = 1;
const MAX_SOURCES = 8;

function resolveMode(raw: string): SearchMode {
  return raw.trim() === 'quick' ? 'quick' : 'standard';
}

function resolveSources(raw: string): number | undefined {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(Math.max(parsed, MIN_SOURCES), MAX_SOURCES);
}

/** Keeps the checklist for one research call and sends a snapshot each time it changes. */
function progressReporter(deps: FlowExecutorDeps) {
  const emit = deps.onResearchProgress;
  let state: ResearchProgress = EMPTY_RESEARCH;
  const set = (next: ResearchProgress): void => {
    state = next;
    emit?.(state);
  };
  return {
    onProgress: emit ? (progress: SearchProgress) => set(reduceResearchProgress(state, progress)) : undefined,
    finish: (sources: number) => { if (emit) set(finishResearch(state, sources)); },
    fail: () => { if (emit) set(failResearch(state)); },
  };
}

export async function execResearch(
  skillConfig: Record<string, string>,
  deps: FlowExecutorDeps,
): Promise<string> {
  const query = (skillConfig.query ?? '').trim();
  if (!query) {
    sendLog('🔬 [Flow] Research: empty query — nothing to research');
    return JSON.stringify({ output: '', sources: '[]', count: '0' });
  }

  const providerUrl = (skillConfig.provider ?? '').trim() || deps.getTargetUrl();
  const mode = resolveMode(skillConfig.depth ?? '');
  const maxSources = resolveSources(skillConfig.sources ?? '');
  const urls = parseWebUrls(skillConfig.urls ?? '');

  const scope = maxSources === undefined ? '' : `, sources=${maxSources}`;
  const given = urls.length > 0 ? `, ${urls.length} given url(s)` : '';
  sendLog(`🔬 [Flow] Research step — "${query}" (depth=${mode}${scope}${given})`);
  const progress = progressReporter(deps);
  try {
    const outcome = await runWebSearch(query, providerUrl, config.locale, progress.onProgress, mode, maxSources, '', urls);
    sendLog(`🔬 [Flow] Research: ${outcome.sources.length} source(s) → ${outcome.answer.length} chars`);
    progress.finish(outcome.sources.length);
    return JSON.stringify({
      output: outcome.answer,
      sources: JSON.stringify(outcome.sources.map((doc) => ({ title: doc.title, link: doc.url }))),
      count: String(outcome.sources.length),
      // A field, not part of the answer: a flow may send `output` straight to the user, while the
      // agent reads every field beside it.
      ...(outcome.partiallyBlocked ? { note: SEARCH_PARTIAL_BLOCK_NOTE } : {}),
    });
  } catch (err) {
    progress.fail();
    const message = err instanceof SearchPipelineError
      ? t(getLangCache(), err.i18nKey)
      : err instanceof Error ? err.message : String(err);
    sendLog(`⚠️ [Flow] Research failed: ${message}`);
    // Keyed on the pipeline's own error, never on the translated text.
    if (err instanceof SearchPipelineError && err.i18nKey === SEARCH_BLOCKED_KEY) throw new SearchBlockedError(message);
    throw new Error(message);
  }
}
