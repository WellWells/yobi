import { load } from 'cheerio';
import { fetchRawResponse } from '../../pageLoader';
import { CLEAN_UA } from '../../userAgent';
import type { SerpHit } from '../types';
import { acceptLanguageFor, createEngineGate, retryAfterMs, SerpChallengeError } from './gate';
import { parseSerpDate } from './serpDate';

const ENGINE = 'Bing';

/** `setlang` (interface and snippet language) and `cc` (market) per app locale. */
const BING_MARKET: Record<string, { setlang: string; cc: string }> = {
  'zh-TW': { setlang: 'zh-Hant', cc: 'TW' },
  'zh-CN': { setlang: 'zh-Hans', cc: 'CN' },
  'en-US': { setlang: 'en', cc: 'US' },
  de: { setlang: 'de', cc: 'DE' },
  es: { setlang: 'es', cc: 'ES' },
  fr: { setlang: 'fr', cc: 'FR' },
  ja: { setlang: 'ja', cc: 'JP' },
  ko: { setlang: 'ko', cc: 'KR' },
  'pt-BR': { setlang: 'pt-BR', cc: 'BR' },
};

/*
 * Ten queries a second apart all answered. The pacing stays well under that — three back to back, then one every two seconds — and a query
 * that would wait longer than four seconds goes to the other engines instead of queueing.
 */
export const BING_REFILL_MS = 2_000;
export const BING_COOLDOWN_MS = 10 * 60_000;

const gate = createEngineGate({
  engine: ENGINE,
  concurrency: 2,
  burst: 3,
  refillMs: BING_REFILL_MS,
  cooldownMs: BING_COOLDOWN_MS,
  maxWaitMs: 4_000,
  jitterMs: 1_000,
});

/*
 * Bing's HTML results page: a fixed, non-Google host, so the plain Chromium identity is the honest
 * one. No recency filter is sent — `filters=ex1:"ez…"` returned the same results as none; the plan's recency still reaches the engines that honour it.
 */
export async function searchBing(query: string, locale: string): Promise<SerpHit[]> {
  const market = BING_MARKET[locale];
  const params = new URLSearchParams({ q: query, ...(market ?? {}) });
  const response = await gate.run(() => fetchRawResponse(`https://www.bing.com/search?${params.toString()}`, {
    headers: { 'User-Agent': CLEAN_UA, 'Accept-Language': acceptLanguageFor(locale) },
  }));
  if (response.status === 429) {
    gate.block(retryAfterMs(response.headers?.['retry-after']));
    throw new SerpChallengeError(ENGINE, 'HTTP 429');
  }
  if (response.status >= 400) throw new Error(`${ENGINE} answered HTTP ${response.status}`);
  const { hits, noResults } = parseBingSerp(response.text);
  /*
   * Bing fills a page even for nonsense (a random-letters query gets ten results), and says
   * so with `.b_no` when it truly has none. A page with neither is a challenge — or markup that
   * moved, which the release self-test catches; either way the other engines carry the query.
   */
  if (hits.length === 0 && !noResults) {
    gate.block();
    throw new SerpChallengeError(ENGINE, `no results on a ${response.text.length}-byte page`);
  }
  gate.answered();
  return hits;
}

export function parseBingSerp(html: string, now: Date = new Date()): { hits: SerpHit[]; noResults: boolean } {
  const $ = load(html);
  const hits: SerpHit[] = [];
  $('li.b_algo').each((_, el) => {
    const item = $(el);
    const anchor = item.find('h2 a').first();
    const title = anchor.text().trim();
    const url = resolveBingHref(anchor.attr('href') ?? '');
    if (!title || !url) return;
    const caption = item.find('.b_caption p').first();
    const stamp = caption.find('.news_dt').first();
    const date = parseSerpDate(stamp.text(), now);
    stamp.remove();
    const snippet = caption.text().replace(/^[\s ·]+/u, '').trim();
    hits.push({ title, url, ...(snippet ? { snippet } : {}), ...(date ? { date } : {}) });
  });
  return { hits, noResults: $('.b_no').length > 0 };
}

/**
 * Bing links every result through `/ck/a?…&u=a1<base64url of the target>`. The target is decoded
 * here; a link that stays on Bing (images, videos, related searches) is not a result.
 */
export function resolveBingHref(href: string): string {
  const trimmed = href.trim();
  if (!trimmed) return '';
  try {
    const u = new URL(trimmed, 'https://www.bing.com/');
    if (u.hostname.endsWith('bing.com')) {
      const encoded = u.searchParams.get('u');
      if (!encoded?.startsWith('a1')) return '';
      return httpUrl(Buffer.from(encoded.slice(2), 'base64url').toString('utf8'));
    }
    return httpUrl(u.href);
  } catch {
    return '';
  }
}

function httpUrl(candidate: string): string {
  try {
    const u = new URL(candidate);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
  } catch {
    return '';
  }
}
