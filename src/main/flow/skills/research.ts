import { runWebSearch, SearchPipelineError } from '../../search';
import { config } from '../../config';
import { getLangCache, t } from '../../i18n';
import { sendLog } from '../../helpers';
import type { SearchMode } from '../../../shared/types';
import type { SearchProgress } from '../../search';
import type { FlowExecutorDeps } from '../types';

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

export function reportStage(deps: FlowExecutorDeps): ((progress: SearchProgress) => void) | undefined {
  const onStage = deps.onStage;
  if (!onStage) return undefined;
  return (progress) => {
    if (progress.stage === 'planning') onStage('planning', progress.queries.join('  ·  '));
    else if (progress.stage === 'fetching') onStage('fetching', String(progress.count));
    else if (progress.stage === 'read') onStage('read', progress.host);
    else onStage(progress.stage);
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

  const scope = maxSources === undefined ? '' : `, sources=${maxSources}`;
  sendLog(`🔬 [Flow] Research step — "${query}" (depth=${mode}${scope})`);
  try {
    const outcome = await runWebSearch(query, providerUrl, config.locale, reportStage(deps), mode, maxSources);
    sendLog(`🔬 [Flow] Research: ${outcome.sources.length} source(s) → ${outcome.answer.length} chars`);
    return JSON.stringify({
      output: outcome.answer,
      sources: JSON.stringify(outcome.sources.map((doc) => ({ title: doc.title, link: doc.url }))),
      count: String(outcome.sources.length),
    });
  } catch (err) {
    const message = err instanceof SearchPipelineError
      ? t(getLangCache(), err.i18nKey)
      : err instanceof Error ? err.message : String(err);
    sendLog(`⚠️ [Flow] Research failed: ${message}`);
    throw new Error(message);
  }
}
