import { load } from 'cheerio';
import { fetchRawText } from '../../pageLoader';
import { CLEAN_UA } from '../../userAgent';
import { MAX_PLAN_QUERIES } from '../types';
import type { SerpHit, TemporalFilter } from '../types';
import { createEngineGate, SerpChallengeError } from './gate';

const ENGINE = 'DuckDuckGo';

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

/** At most one plan's worth of queries in flight; the bucket holds one plan and refills one start per window. */
export const DDG_WINDOW_MS = 4_000;

/** After a verification page nothing is sent for this long. */
export const DDG_COOLDOWN_MS = 180_000;

const gate = createEngineGate({
  engine: ENGINE,
  concurrency: MAX_PLAN_QUERIES,
  burst: MAX_PLAN_QUERIES,
  refillMs: DDG_WINDOW_MS,
  cooldownMs: DDG_COOLDOWN_MS,
  jitterMs: 1_000,
});

/*
 * DuckDuckGo's HTML endpoint, built for browsers without JavaScript: a fixed, non-Google host, so
 * the plain Chromium identity is the honest one. It carries no result dates.
 */
export async function searchDdg(query: string, temporal: TemporalFilter, locale: string): Promise<SerpHit[]> {
  const params = new URLSearchParams({ q: query });
  const region = DDG_REGION[locale];
  if (region) params.set('kl', region);
  if (DDG_DF[temporal]) params.set('df', DDG_DF[temporal]);

  const html = await gate.run(() => fetchRawText(`https://html.duckduckgo.com/html/?${params.toString()}`, {
    headers: { 'User-Agent': CLEAN_UA, 'Accept-Language': locale },
  }));
  const hits = parseDdgSerp(html);
  if (hits.length === 0 && html.includes('anomaly-modal')) {
    gate.block();
    throw new SerpChallengeError(ENGINE, 'anomaly page');
  }
  gate.answered();
  return hits;
}

export function parseDdgSerp(html: string): SerpHit[] {
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
