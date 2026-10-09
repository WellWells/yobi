import { searchSourceList, SearchPipelineError } from '../../search';
import { SEARCH_BLOCKED_KEY, SearchBlockedError } from '../../search/blocked';
import { config } from '../../config';
import { getLangCache, t } from '../../i18n';
import { sendLog } from '../../helpers';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 10;

export async function execSearch(skillConfig: Record<string, string>): Promise<string> {
  const query = (skillConfig.query ?? '').trim();
  if (!query) {
    sendLog('🔎 [Flow] Search: empty query — returning []');
    return '[]';
  }

  const parsed = Number.parseInt(skillConfig.limit ?? '', 10);
  const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), MAX_LIMIT) : DEFAULT_LIMIT;

  sendLog(`🔎 [Flow] Search step — "${query}" (limit ${limit})`);
  try {
    const hits = await searchSourceList(query, config.locale, limit);
    sendLog(`🔎 [Flow] Search: ${hits.length} result(s)`);
    return JSON.stringify(hits.map((hit) => ({ title: hit.title, link: hit.url, snippet: hit.snippet ?? '' })));
  } catch (err) {
    const message = err instanceof SearchPipelineError
      ? t(getLangCache(), err.i18nKey)
      : err instanceof Error ? err.message : String(err);
    sendLog(`⚠️ [Flow] Search failed: ${message}`);
    // Blocked is not "no results": [] would make /agent retry into the block and a stop step see
    // nothing new. Same error `research` raises.
    if (err instanceof SearchPipelineError && err.i18nKey === SEARCH_BLOCKED_KEY) throw new SearchBlockedError(message);
    return '[]';
  }
}
