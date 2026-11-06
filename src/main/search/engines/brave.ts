import { load } from 'cheerio';
import { fetchRawResponse } from '../../pageLoader';
import { CLEAN_UA } from '../../userAgent';
import type { SerpHit, TemporalFilter } from '../types';
import { acceptLanguageFor, createEngineGate, retryAfterMs, SerpChallengeError } from './gate';
import { parseSerpDate } from './serpDate';

const ENGINE = 'Brave';

const BRAVE_TF: Record<TemporalFilter, string> = { day: 'pd', week: 'pw', month: 'pm', none: '' };

/*
 * The fifth query about a second apart gets HTTP 429 (no Retry-After), and the block outlasts
 * half an hour of quiet. Brave is therefore the most
 * sparingly used engine: two queries back to back, then one every six seconds, never queued — a
 * plan's third query goes to Bing alone — and a long cooldown that doubles while Brave keeps refusing.
 */
export const BRAVE_REFILL_MS = 6_000;
export const BRAVE_COOLDOWN_MS = 15 * 60_000;

const gate = createEngineGate({
  engine: ENGINE,
  concurrency: 1,
  burst: 2,
  refillMs: BRAVE_REFILL_MS,
  cooldownMs: BRAVE_COOLDOWN_MS,
  maxWaitMs: 3_000,
});

/*
 * Brave Search's own results page (an independent index, not Google or Bing): a fixed, non-Google
 * host, so the plain Chromium identity is the honest one. Its snippets carry the page's date.
 */
export async function searchBrave(query: string, temporal: TemporalFilter, locale: string): Promise<SerpHit[]> {
  const params = new URLSearchParams({ q: query, source: 'web' });
  if (BRAVE_TF[temporal]) params.set('tf', BRAVE_TF[temporal]);
  const response = await gate.run(() => fetchRawResponse(`https://search.brave.com/search?${params.toString()}`, {
    headers: { 'User-Agent': CLEAN_UA, 'Accept-Language': acceptLanguageFor(locale) },
  }));
  if (response.status === 429 || /\/captcha/i.test(response.finalUrl)) {
    gate.block(retryAfterMs(response.headers?.['retry-after']));
    throw new SerpChallengeError(ENGINE, response.status === 429 ? 'HTTP 429' : 'captcha page');
  }
  if (response.status >= 400) throw new Error(`${ENGINE} answered HTTP ${response.status}`);
  const hits = parseBraveSerp(response.text);
  if (hits.length > 0) gate.answered();
  return hits;
}

export function parseBraveSerp(html: string, now: Date = new Date()): SerpHit[] {
  const $ = load(html);
  const hits: SerpHit[] = [];
  $('div.snippet[data-type="web"]').each((_, el) => {
    const item = $(el);
    const url = braveResultUrl(item.find('a[href]').first().attr('href') ?? '');
    const title = item.find('.title').first().text().trim();
    if (!title || !url) return;
    const content = item.find('.generic-snippet .content').first();
    // The page's date leads the snippet as "2026年8月8日 -" / "2 weeks ago -".
    const stamp = content.children('span.t-secondary').first();
    const date = parseSerpDate(stamp.text(), now);
    stamp.remove();
    const snippet = content.text().replace(/\s+/g, ' ').trim();
    hits.push({ title, url, ...(snippet ? { snippet } : {}), ...(date ? { date } : {}) });
  });
  return hits;
}

/** A result's own link; Brave's links back to itself (more results, settings) are not results. */
function braveResultUrl(href: string): string {
  try {
    const u = new URL(href.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.hostname === 'brave.com' || u.hostname.endsWith('.brave.com') ? '' : u.href;
  } catch {
    return '';
  }
}
