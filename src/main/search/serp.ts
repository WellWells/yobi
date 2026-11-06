import { sendLog } from '../helpers';
import { searchBing } from './engines/bing';
import { searchBrave } from './engines/brave';
import { searchDdg } from './engines/ddg';
import { EngineBusyError, SerpChallengeError } from './engines/gate';
import { fuseRankings } from './fuse';
import { recalledSerp, rememberSerp, serpCacheKey } from './serpCache';
import type { SerpHit, TemporalFilter } from './types';

export { EngineBusyError, SerpChallengeError } from './engines/gate';
export { DDG_COOLDOWN_MS, DDG_WINDOW_MS, searchDdg } from './engines/ddg';
export { searchBing } from './engines/bing';
export { searchBrave } from './engines/brave';

type EngineSearch = (query: string, temporal: TemporalFilter, locale: string) => Promise<SerpHit[]>;

interface Engine {
  name: string;
  search: EngineSearch;
}

/** Both asked for a plan's first query; the rest go to one of them in turn. */
const PRIMARY_ENGINES: readonly Engine[] = [
  { name: 'Brave', search: searchBrave },
  { name: 'Bing', search: (query, _temporal, locale) => searchBing(query, locale) },
];

/** Asked only when the primary engines came back empty-handed. */
const BACKUP_ENGINE: Engine = { name: 'DuckDuckGo', search: searchDdg };

interface EngineAnswer {
  name: string;
  hits: SerpHit[];
  /** Refused us, is cooling down from a refusal, or was too busy pacing to take the query. */
  unavailable: boolean;
  note: string;
}

async function ask(engine: Engine, query: string, temporal: TemporalFilter, locale: string): Promise<EngineAnswer> {
  try {
    const hits = await engine.search(query, temporal, locale);
    return { name: engine.name, hits, unavailable: false, note: String(hits.length) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const unavailable = err instanceof SerpChallengeError || err instanceof EngineBusyError;
    return { name: engine.name, hits: [], unavailable, note: unavailable ? message : `failed (${message})` };
  }
}

function describe(answers: readonly EngineAnswer[]): string {
  // A refusal's message already names its engine.
  return answers.map((answer) => (answer.unavailable ? answer.note : `${answer.name} ${answer.note}`)).join(', ');
}

/**
 * The primary engines' answers for one query. The plan's first query (`slot` 0) is the one worth
 * two indexes agreeing on, so it goes to both at once; every later query goes to one engine in turn
 * — Brave, then Bing — and to the other only when that one had nothing to give.
 */
async function askPrimaries(query: string, temporal: TemporalFilter, locale: string, slot: number): Promise<EngineAnswer[]> {
  if (slot === 0) return Promise.all(PRIMARY_ENGINES.map((engine) => ask(engine, query, temporal, locale)));
  const first = PRIMARY_ENGINES[(slot - 1) % PRIMARY_ENGINES.length];
  const firstAnswer = await ask(first, query, temporal, locale);
  if (firstAnswer.hits.length > 0) return [firstAnswer];
  const other = PRIMARY_ENGINES.find((engine) => engine !== first) as Engine;
  return [firstAnswer, await ask(other, query, temporal, locale)];
}

/**
 * One query across the engines (`slot`: its place in the plan, see `askPrimaries`); DuckDuckGo only
 * when the primary engines came back empty-handed. The same query within `SERP_CACHE_TTL_MS` is
 * answered from memory. Throws `SerpChallengeError` when every engine asked was unavailable, so a
 * blocked search is never mistaken for one with no results.
 */
export async function searchWeb(query: string, temporal: TemporalFilter, locale: string, slot = 0): Promise<SerpHit[]> {
  const key = serpCacheKey(query, temporal, locale);
  const recalled = recalledSerp(key);
  if (recalled) {
    sendLog(`🔎 [Search] "${query}" — ${recalled.hits.length} results from ${Math.round(recalled.ageMs / 1_000)} s ago, no request`);
    return recalled.hits;
  }

  const primary = await askPrimaries(query, temporal, locale, slot);
  const answered = primary.filter((answer) => answer.hits.length > 0);
  if (answered.length > 0) {
    sendLog(`🔎 [Search] "${query}" — ${describe(primary)}`);
    const hits = fuseRankings(answered.map((answer) => answer.hits));
    rememberSerp(key, hits);
    return hits;
  }

  const backup = await ask(BACKUP_ENGINE, query, temporal, locale);
  const all = [...primary, backup];
  sendLog(`🔎 [Search] "${query}" — ${describe(all)}`);
  if (backup.hits.length > 0) {
    rememberSerp(key, backup.hits);
    return backup.hits;
  }
  if (all.every((answer) => answer.unavailable)) {
    throw new SerpChallengeError('Every search engine', all.map((answer) => answer.note).join('; '));
  }
  return [];
}
