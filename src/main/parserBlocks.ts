import { load } from 'cheerio';
import type { FeedCandidate } from '../shared/types';

const FEED_LINK_TYPES = new Set(['application/rss+xml', 'application/atom+xml']);

export function extractFeedLinks(html: string, baseUrl: string): FeedCandidate[] {
  const $ = load(html);
  const out: FeedCandidate[] = [];
  const seen = new Set<string>();

  $('link').each((_, el) => {
    const type = ($(el).attr('type') ?? '').trim().toLowerCase();
    if (!FEED_LINK_TYPES.has(type)) return;

    const href = ($(el).attr('href') ?? '').trim();
    if (!href) return;

    let abs: string;
    try {
      abs = new URL(href, baseUrl).href;
    } catch {
      return;
    }
    if (!/^https?:\/\//i.test(abs) || seen.has(abs)) return;

    seen.add(abs);
    out.push({ url: abs, title: ($(el).attr('title') ?? '').trim() });
  });

  return out;
}

export interface RssFeedItem {
  link: string;
  title?: string;
  pubDate?: string;
}

export function parseRssFeed(rawXml: string): RssFeedItem[] {
  const $xml = load(rawXml, { xmlMode: true });
  const items: RssFeedItem[] = [];

  const toIso = (raw: string): string | undefined => {
    if (!raw) return undefined;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? undefined : d.toISOString();
  };

  $xml('item').each((_, el) => {
    const link = $xml(el).find('link').first().text().trim();
    if (!link || !/^https?:\/\//i.test(link)) return;
    const title = $xml(el).find('title').first().text().trim() || undefined;
    const pubDate = toIso($xml(el).find('pubDate').first().text().trim());
    items.push({ link, title, pubDate });
  });

  if (items.length === 0) {
    $xml('entry').each((_, el) => {
      const href = $xml(el).find('link').attr('href') ?? '';
      const text = $xml(el).find('link').first().text().trim();
      const link = href || text;
      if (!link || !/^https?:\/\//i.test(link)) return;
      const title = $xml(el).find('title').first().text().trim() || undefined;
      const rawDate =
        $xml(el).find('updated').first().text().trim() ||
        $xml(el).find('published').first().text().trim();
      const pubDate = toIso(rawDate);
      items.push({ link, title, pubDate });
    });
  }

  return items;
}

export type ParserBlockType =
  | 'extractLinks'
  | 'extractText'
  | 'parseRss'
  | 'getLinks'
  | 'getText'
  | 'getTexts'
  | 'getHtml'
  | 'getAttribute'
  | 'getByRegex';

export interface ParserBlock {
  id: string;
  type: ParserBlockType;
  selector: string;
  attribute?: string;
  pattern?: string;
  flags?: string;
  group?: number;
  maxItems?: number;
}

export function runCssSelector(
  html: string,
  sourceUrl: string,
  selector: string,
  outputType: 'links' | 'text',
  maxItems: number,
): string {
  const cleanSel = selector.replace(/^##/, '').trim();
  if (!cleanSel) return '';

  const $ = load(`<html>${html}</html>`);

  let baseOrigin = '';
  try {
    baseOrigin = new URL(sourceUrl).origin;
  } catch {
  }

  if (outputType === 'links') {
    const links: string[] = [];
    $(cleanSel).each((_, el) => {
      const $el = $(el);
      const directHref = $el.attr('href') ?? '';
      if (directHref) {
        try {
          const resolved = new URL(directHref, baseOrigin || sourceUrl).href;
          if (/^https?:\/\//i.test(resolved)) links.push(resolved);
        } catch { }
        return;
      }
      $el.find('a[href]').each((_, a) => {
        const href = $(a).attr('href') ?? '';
        if (!href) return;
        try {
          const resolved = new URL(href, baseOrigin || sourceUrl).href;
          if (/^https?:\/\//i.test(resolved)) links.push(resolved);
        } catch { }
      });
    });
    const limited = maxItems > 0 ? links.slice(0, maxItems) : links;
    return JSON.stringify(limited);
  }

  const texts: string[] = [];
  $(cleanSel).each((_, el) => {
    const text = $(el).text().trim();
    if (text) texts.push(text);
  });
  const limited = maxItems > 0 ? texts.slice(0, maxItems) : texts;
  return limited.join('\n\n---\n\n');
}

export function runParserBlocks(html: string, sourceUrl: string, blocks: ParserBlock[], xmlMode = false): string {
  if (blocks.length === 0) return '';

  const $ = xmlMode
    ? load(html, { xmlMode: true })
    : load(`<html>${html}</html>`);

  let baseOrigin = '';
  try {
    const base = new URL(sourceUrl);
    baseOrigin = base.origin;
  } catch {
  }

  let lastOutput = html;

  for (const block of blocks) {
    if (block.type === 'getByRegex') {
      const pat = (block.pattern ?? '').trim();
      if (!pat) continue;
      try {
        const flags = block.flags ?? '';
        const group = block.group ?? 0;
        const regex = new RegExp(pat, flags);
        if (flags.includes('g')) {
          const matches: string[] = [];
          let m: RegExpExecArray | null;
          while ((m = regex.exec(lastOutput)) !== null) {
            matches.push(m[group] ?? m[0] ?? '');
            if (regex.lastIndex === m.index) regex.lastIndex++;
          }
          lastOutput = JSON.stringify(applyMaxItems(matches, block.maxItems));
        } else {
          const m = regex.exec(lastOutput);
          lastOutput = m ? (m[group] ?? m[0] ?? '') : '';
        }
      } catch {
      }
      continue;
    }

    if (block.type === 'parseRss') {
      const $xml = load(html, { xmlMode: true });
      const links: string[] = [];

      $xml('item').each((_, el) => {
        const link = $xml(el).find('link').first().text().trim();
        if (link && /^https?:\/\//i.test(link)) links.push(link);
      });

      if (links.length === 0) {
        $xml('entry').each((_, el) => {
          const href = $xml(el).find('link').attr('href') ?? '';
          const text = $xml(el).find('link').first().text().trim();
          const link = href || text;
          if (link && /^https?:\/\//i.test(link)) links.push(link);
        });
      }

      lastOutput = JSON.stringify(applyMaxItems(links, block.maxItems));
      continue;
    }

    const selector = block.selector.trim();
    if (!selector) continue;

    switch (block.type) {
      case 'extractLinks':
      case 'getLinks': {
        const links: string[] = [];
        $(selector).each((_, el) => {
          const href = $(el).attr('href') ?? '';
          if (!href) return;
          try {
            const resolved = new URL(href, baseOrigin || sourceUrl).href;
            if (/^https?:\/\//i.test(resolved)) links.push(resolved);
          } catch {
          }
        });
        lastOutput = JSON.stringify(applyMaxItems(links, block.maxItems));
        break;
      }
      case 'extractText':
      case 'getText': {
        lastOutput = $(selector).first().text().trim();
        break;
      }
      case 'getTexts': {
        const texts: string[] = [];
        $(selector).each((_, el) => {
          const text = $(el).text().trim();
          if (text) texts.push(text);
        });
        lastOutput = JSON.stringify(applyMaxItems(texts, block.maxItems));
        break;
      }
      case 'getHtml': {
        lastOutput = $(selector).first().html() ?? '';
        break;
      }
      case 'getAttribute': {
        const attr = (block.attribute ?? '').trim();
        lastOutput = attr ? ($(selector).first().attr(attr) ?? '') : '';
        break;
      }
    }
  }

  return lastOutput;
}

function applyMaxItems<T>(arr: T[], maxItems: number | undefined): T[] {
  const limit = maxItems ?? 3;
  return limit > 0 ? arr.slice(0, limit) : arr;
}
