import type { SerpHit } from './types';

/** The standard reciprocal-rank-fusion constant: rank 1 and rank 10 differ, but no single list dominates. */
const RRF_K = 60;

/*
 * Wikipedia serves one article under `/wiki/`, a script variant (`/zh-tw/`, `/zh-hant/`, `/sr-el/`)
 * and the mobile host: one article's `/zh-tw/` and `/wiki/` addresses must not count as two pages.
 */
const WIKIPEDIA_HOST = /^([a-z-]+)\.(?:m\.)?wikipedia\.org$/;
const WIKIPEDIA_VARIANT_PATH = /^\/[a-z]{2,3}(?:-[a-z]+)+\//;

/**
 * The identity two engines agree on: scheme, `www.`, a trailing slash, the fragment and tracking
 * parameters do not make a different page, nor does a Wikipedia variant of the same article.
 */
export function hitKey(url: string): string {
  try {
    const u = new URL(url);
    for (const name of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|msclkid$)/i.test(name)) u.searchParams.delete(name);
    }
    let host = u.hostname.toLowerCase().replace(/^www\./, '');
    let path = u.pathname.replace(/\/+$/, '');
    const wiki = WIKIPEDIA_HOST.exec(host);
    if (wiki) {
      host = `${wiki[1]}.wikipedia.org`;
      path = path.replace(WIKIPEDIA_VARIANT_PATH, '/wiki/');
    }
    return `${host}${path}${u.search}`;
  } catch {
    return url;
  }
}

function mergeHit(kept: SerpHit, other: SerpHit): SerpHit {
  const snippet = (other.snippet?.length ?? 0) > (kept.snippet?.length ?? 0) ? other.snippet : kept.snippet;
  const date = kept.date ?? other.date;
  return { title: kept.title, url: kept.url, ...(snippet ? { snippet } : {}), ...(date ? { date } : {}) };
}

/**
 * Reciprocal rank fusion of several ranked lists — one per engine, or one per planned query. A page
 * that several engines or queries rank well rises above one that a single list put first, which is
 * the cheapest agreement signal there is. Ties keep the order the lists were given in.
 */
export function fuseRankings(lists: readonly SerpHit[][]): SerpHit[] {
  const merged = new Map<string, { hit: SerpHit; score: number; first: number }>();
  for (const list of lists) {
    list.forEach((hit, rank) => {
      const key = hitKey(hit.url);
      const gain = 1 / (RRF_K + rank + 1);
      const entry = merged.get(key);
      if (entry) {
        entry.score += gain;
        entry.hit = mergeHit(entry.hit, hit);
      } else {
        merged.set(key, { hit, score: gain, first: merged.size });
      }
    });
  }
  return [...merged.values()]
    .sort((a, b) => b.score - a.score || a.first - b.first)
    .map((entry) => entry.hit);
}
