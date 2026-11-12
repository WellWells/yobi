import { citationHost, citationSite } from '../../shared/citations';
import { tokenize } from './rank';
import type { SerpHit } from './types';

/*
 * Which results to read first. The engines' fused order is the base — re-sorting by BM25 over the
 * snippets was tried and was worse — so a result only moves between tiers, never within one:
 *   0  the site the user named (its name is a word of the question or the planned queries);
 *   1  everything else sharing a word with them, official sites first;
 *   2  homepages, listing / search / login pages, results titled only by their site;
 *   3  results sharing no word at all.
 * The worst tier any rule gives wins: Reddit's own search page is weak even when Reddit was named.
 */

export type HitTier = 0 | 1 | 2 | 3;

/** `/r/<sub>/comments/<id>` on any host: reddit.com, old.reddit.com or a mirror of it. */
const REDDIT_POST = /^\/r\/[^/]+\/comments\/([a-z0-9]+)(?:\/|$)/i;
const REDDIT_COMMUNITY = /^\/r\/[^/]+\/?$/i;
const LISTING_SEGMENT = /^(?:tags?|category|categories|search|topics|archive|label)$/i;
const LOGIN_SEGMENT = /^(?:log-?in|sign-?in|sign-?up|register|auth)$/i;
const SEARCH_PARAMS = ['q', 's', 'search'] as const;
/** gov / edu / mil, alone or under a country code; ac / go under a country code (ac.uk, go.jp). */
const OFFICIAL_HOST = /\.(?:(?:gov|edu|mil)(?:\.[a-z]{2})?|(?:ac|go)\.[a-z]{2})$/i;
/** A one-letter site name (x.com) is a letter in the question far more often than the site. */
const MIN_NAMED_SITE = 2;

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** One Reddit post's identity across every host that serves it; null for any other page. */
export function postKey(url: string): string | null {
  const parsed = parse(url);
  const id = parsed ? REDDIT_POST.exec(parsed.pathname)?.[1] : undefined;
  return id ? `reddit:${id.toLowerCase()}` : null;
}

function siteOf(url: URL): string {
  return REDDIT_POST.test(url.pathname) ? 'reddit' : citationSite(url.href);
}

function namesSite(site: string, words: string): boolean {
  if (site.length < MIN_NAMED_SITE) return false;
  const escaped = site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i').test(words);
}

function isWeak(hit: SerpHit, url: URL): boolean {
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length === 0 && url.search === '') return true;
  if (segments.some((segment) => LISTING_SEGMENT.test(segment) || LOGIN_SEGMENT.test(segment))) return true;
  if (segments.some((segment, index) => segment.toLowerCase() === 'page' && /^\d+$/.test(segments[index + 1] ?? ''))) return true;
  if (REDDIT_COMMUNITY.test(url.pathname)) return true;
  if (SEARCH_PARAMS.some((name) => url.searchParams.has(name))) return true;
  const title = hit.title.trim().toLowerCase().replace(/^www\./, '');
  return title === '' || title === citationHost(url.href).toLowerCase() || title === citationSite(url.href);
}

function sharesWord(hit: SerpHit, wordTokens: ReadonlySet<string>): boolean {
  return tokenize(`${hit.title}\n${hit.snippet ?? ''}`).some((token) => wordTokens.has(token));
}

function tierOf(hit: SerpHit, words: string, wordTokens: ReadonlySet<string>): HitTier {
  const url = parse(hit.url);
  if (!url || !sharesWord(hit, wordTokens)) return 3;
  if (isWeak(hit, url)) return 2;
  return namesSite(siteOf(url), words) ? 0 : 1;
}

function isOfficial(hit: SerpHit): boolean {
  const url = parse(hit.url);
  return url !== null && OFFICIAL_HOST.test(url.hostname);
}

/**
 * The reading order: by tier, official sites first in tier 1, the engines' order inside each.
 * `words`: the question and the planned queries.
 */
export function rankByQuality(hits: SerpHit[], words: string): SerpHit[] {
  if (hits.length <= 1) return hits;
  const wordTokens = new Set(tokenize(words));
  // 0, then tier 1 split in two (official, other), then 2 and 3: a stable sort keeps the engines' order.
  const place = (hit: SerpHit): number => {
    const tier = tierOf(hit, words, wordTokens);
    if (tier === 0) return 0;
    if (tier === 1) return isOfficial(hit) ? 1 : 2;
    return tier + 1;
  };
  return hits
    .map((hit, index) => ({ hit, index, place: place(hit) }))
    .sort((a, b) => a.place - b.place || a.index - b.index)
    .map((entry) => entry.hit);
}
