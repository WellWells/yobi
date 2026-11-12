import { load } from 'cheerio';
import type { PageSiteReader } from './index';
import { imagesOn, jsonLdNodes, readerPage } from './readerPage';

const MEDIA_HOSTS = ['i.pinimg.com'] as const;

/** The value of a JSON string field in the page's data, however deep it sits; empty when absent. */
function jsonField(html: string, pattern: RegExp): string {
  const raw = pattern.exec(html)?.[1];
  if (raw === undefined) return '';
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return '';
  }
}

const JSON_STRING = String.raw`"((?:[^"\\]|\\.)*)"`;
const DESCRIPTION = new RegExp(String.raw`"closeupUnifiedDescription":${JSON_STRING}`);
const SOURCE = new RegExp(String.raw`"link":"(https?:(?:[^"\\]|\\.)*)"`);
const CREATOR = new RegExp(String.raw`"closeupAttribution":\{.{0,500}?"fullName":${JSON_STRING}`);

/** The picture in full: `og:image` is a resized copy under the same path as the original. */
function originalOf(html: string): string {
  const shown = load(html)('meta[property="og:image"]').attr('content') ?? '';
  const path = /^https:\/\/i\.pinimg\.com\/[^/]+\/(.+)$/.exec(shown)?.[1];
  return path ? `https://i.pinimg.com/originals/${path}` : '';
}

const PINTEREST_HOST = /^(?:[a-z]{2,3}\.)?pinterest\.(?:com|ca|de|fr|es|it|jp|nz|ie|at|ch|pt|ph|mx|cl|dk|se|ru|co\.uk|co\.kr|com\.au)$/;

/**
 * A pin's page carries its full description in the page data. The JSON-LD one is cut short, starts
 * with a date, and names Pinterest as the author.
 */
export const pinterestReader: PageSiteReader = {
  matches: (url) => PINTEREST_HOST.test(url.hostname) && /^\/pin\/\d+/.test(url.pathname),
  read(html, url) {
    const description = jsonField(html, DESCRIPTION).trim();
    if (!description) return null;
    const source = jsonField(html, SOURCE);
    const node = jsonLdNodes(html).find((item) => typeof item.headline === 'string');
    return readerPage({
      title: typeof node?.headline === 'string' ? node.headline : '',
      author: jsonField(html, CREATOR),
      publishedAt: '',
      siteName: 'Pinterest',
      url,
      text: [description, source].filter(Boolean).join('\n\n'),
      images: imagesOn(MEDIA_HOSTS, [originalOf(html)]),
    });
  },
};
