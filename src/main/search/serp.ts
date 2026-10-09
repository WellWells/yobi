import { load } from 'cheerio';
import { fetchRawText } from '../pageLoader';
import { CLEAN_UA } from '../userAgent';
import { Semaphore } from '../flow/lanes';
import { MAX_PLAN_QUERIES } from './types';
import type { SerpHit, TemporalFilter } from './types';

export class SerpChallengeError extends Error {
  constructor(marker: string) {
    super(`DuckDuckGo returned a verification page instead of results (${marker})`);
  }
}

const DDG_DF: Record<TemporalFilter, string> = { day: 'd', week: 'w', month: 'm', none: '' };

const DDG_REGION: Record<string, string> = {
  'zh-TW': 'tw-tzh',
  'zh-CN': 'cn-zh',
  'en-US': 'us-en',
  de: 'de-de',
  es: 'es-es',
  fr: 'fr-fr',
  ja: 'jp-jp',
  ko: 'kr-kr',
  'pt-BR': 'br-pt',
};

/**
 * App-wide DuckDuckGo pacing: at most one plan's worth of queries in flight, and each start draws
 * from a bucket that holds one plan and refills one start per `DDG_WINDOW_MS`.
 */
const ddgGate = new Semaphore(MAX_PLAN_QUERIES);
export const DDG_WINDOW_MS = 4_000;
let startTokens = MAX_PLAN_QUERIES;
let tokensAt = 0;

/**
 * After a verification page nothing is sent for this long; callers get the same
 * `SerpChallengeError` without touching the network.
 */
export const DDG_COOLDOWN_MS = 180_000;
let challengedUntil = 0;

function throwIfCoolingDown(now: number): void {
  if (now >= challengedUntil) return;
  throw new SerpChallengeError(`cooling down, ${Math.ceil((challengedUntil - now) / 1_000)} s left`);
}

async function awaitDdgStart(): Promise<void> {
  for (;;) {
    const now = Date.now();
    // Checked on every pass: a query queued here must not go out after its neighbour was challenged.
    throwIfCoolingDown(now);
    startTokens = Math.min(MAX_PLAN_QUERIES, startTokens + Math.max(0, now - tokensAt) / DDG_WINDOW_MS);
    tokensAt = now;
    if (startTokens >= 1) {
      startTokens -= 1;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.ceil((1 - startTokens) * DDG_WINDOW_MS)));
  }
}

export async function searchDdg(query: string, temporal: TemporalFilter, locale: string): Promise<SerpHit[]> {
  throwIfCoolingDown(Date.now());
  const params = new URLSearchParams({ q: query });
  const region = DDG_REGION[locale];
  if (region) params.set('kl', region);
  if (DDG_DF[temporal]) params.set('df', DDG_DF[temporal]);

  const html = await ddgGate.runExclusive(async () => {
    await awaitDdgStart();
    return fetchRawText(`https://html.duckduckgo.com/html/?${params.toString()}`, {
      headers: { 'User-Agent': CLEAN_UA, 'Accept-Language': locale },
    });
  });
  const $ = load(html);
  const hits: SerpHit[] = [];
  $('.result:not(.result--ad)').each((_, el) => {
    const container = $(el);
    const anchor = container.find('a.result__a').first();
    const title = anchor.text().trim();
    const url = resolveDdgHref(anchor.attr('href') ?? '');
    if (!title || !url) return;
    const snippet = container.find('.result__snippet').first().text().trim();
    hits.push(snippet ? { title, url, snippet } : { title, url });
  });
  if (hits.length === 0 && html.includes('anomaly-modal')) {
    challengedUntil = Math.max(challengedUntil, Date.now() + DDG_COOLDOWN_MS);
    throw new SerpChallengeError('anomaly page');
  }
  return hits;
}

function resolveDdgHref(href: string): string {
  const trimmed = href.trim();
  if (!trimmed) return '';
  try {
    const u = new URL(trimmed, 'https://duckduckgo.com/');
    const uddg = u.searchParams.get('uddg');
    if (uddg) return /^https?:\/\//i.test(uddg) ? uddg : '';
    if (u.hostname.endsWith('duckduckgo.com')) return '';
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
  } catch {
    return '';
  }
}
