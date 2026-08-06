import { load } from 'cheerio';
import { fetchRawText } from '../pageLoader';
import { CLEAN_UA } from '../userAgent';
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

export async function searchDdg(query: string, temporal: TemporalFilter, locale: string): Promise<SerpHit[]> {
  const params = new URLSearchParams({ q: query });
  const region = DDG_REGION[locale];
  if (region) params.set('kl', region);
  if (DDG_DF[temporal]) params.set('df', DDG_DF[temporal]);

  const html = await fetchRawText(`https://html.duckduckgo.com/html/?${params.toString()}`, {
    headers: { 'User-Agent': CLEAN_UA, 'Accept-Language': locale },
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
