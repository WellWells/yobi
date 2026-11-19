import { load, type Cheerio, type CheerioAPI } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';

export interface RssFeedItem {
  link: string;
  /**
   * The item's identity as the feed declares it: RSS 2.0 `<guid>`, RSS 1.0 `rdf:about`, Atom
   * `<id>`; the link when there is none. Absent on items saved before it was read.
   */
  id?: string;
  title?: string;
  pubDate?: string;
}

/** What tells one article from another: its declared id, else its link (as feed readers do). */
export function feedItemKey(item: RssFeedItem): string {
  return item.id?.trim() || item.link.trim();
}

function toIso(raw: string): string | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** An absolute http(s) address, or nothing when it cannot be one. */
function resolveHttp(raw: string, base: string | undefined): string | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  try {
    const href = base ? new URL(value, base).href : new URL(value).href;
    return /^https?:\/\//i.test(href) ? href : undefined;
  } catch {
    return undefined;
  }
}

/** The base an element's relative links resolve against: every `xml:base` above it, outermost first. */
function baseOf($xml: CheerioAPI, el: Cheerio<AnyNode>, feedUrl: string | undefined): string | undefined {
  const chain = [el, ...el.parents().toArray().map((node) => $xml(node))]
    .map((node) => node.attr('xml:base'))
    .filter((value): value is string => !!value?.trim())
    .reverse();
  let base = feedUrl;
  for (const value of chain) {
    try {
      base = base ? new URL(value.trim(), base).href : new URL(value.trim()).href;
    } catch {
    }
  }
  return base;
}

function childText($el: Cheerio<Element>, tag: string): string {
  return $el.children(tag).first().text().trim();
}

/** RSS 2.0 and RSS 1.0 (RDF) `<item>`s. */
function parseRssItems($xml: CheerioAPI, feedUrl: string | undefined): RssFeedItem[] {
  const items: RssFeedItem[] = [];
  $xml('item').each((_, el) => {
    const $el = $xml(el);
    const base = baseOf($xml, $el, feedUrl);
    const guidEl = $el.children('guid').first();
    const guid = guidEl.text().trim();
    // A guid is a permalink unless it says otherwise (RSS 2.0).
    const guidIsLink = guid && (guidEl.attr('isPermaLink') ?? 'true').trim().toLowerCase() !== 'false';
    const link = resolveHttp(childText($el, 'link'), base) ?? (guidIsLink ? resolveHttp(guid, base) : undefined);
    if (!link) return;
    const title = childText($el, 'title') || undefined;
    const pubDate = toIso(childText($el, 'pubDate') || childText($el, 'dc\\:date'));
    const id = guid || $el.attr('rdf:about')?.trim() || link;
    items.push({ id, link, ...(title ? { title } : {}), ...(pubDate ? { pubDate } : {}) });
  });
  return items;
}

/** The entry's page: a rel="alternate" link (no rel means alternate), HTML first. */
function atomLink($xml: CheerioAPI, $entry: Cheerio<Element>, feedUrl: string | undefined): string | undefined {
  const alternates = $entry.children('link').toArray()
    .map((el) => $xml(el))
    .filter(($link) => ($link.attr('rel') ?? 'alternate').trim().toLowerCase() === 'alternate')
    .map(($link) => ({ type: ($link.attr('type') ?? '').trim().toLowerCase(), href: resolveHttp($link.attr('href') ?? '', baseOf($xml, $link, feedUrl)) }))
    .filter((link): link is { type: string; href: string } => !!link.href);
  const html = alternates.find((link) => !link.type || link.type === 'text/html' || link.type === 'application/xhtml+xml');
  return html?.href ?? alternates[0]?.href;
}

function atomTitle($entry: Cheerio<Element>): string | undefined {
  const $title = $entry.children('title').first();
  const text = $title.text().trim();
  if (!text) return undefined;
  // type="html" carries escaped markup: the reader shows its text.
  if (($title.attr('type') ?? '').trim().toLowerCase() === 'html') return load(text).text().trim() || undefined;
  return text;
}

function parseAtomEntries($xml: CheerioAPI, feedUrl: string | undefined): RssFeedItem[] {
  const items: RssFeedItem[] = [];
  $xml('entry').each((_, el) => {
    const $el = $xml(el);
    const base = baseOf($xml, $el, feedUrl);
    const rawId = childText($el, 'id');
    const link = atomLink($xml, $el, feedUrl) ?? resolveHttp(rawId, base);
    if (!link) return;
    const title = atomTitle($el);
    // <published> first: some feeds bump <updated> on old entries.
    const pubDate = toIso(childText($el, 'published') || childText($el, 'updated'));
    items.push({ id: rawId || link, link, ...(title ? { title } : {}), ...(pubDate ? { pubDate } : {}) });
  });
  return items;
}

/**
 * The items of an RSS 2.0, RSS 1.0 or Atom feed, in feed order. Relative links resolve against
 * `xml:base` and then `feedUrl`; without one, only absolute http(s) links are kept.
 */
export function parseRssFeed(rawXml: string, feedUrl?: string): RssFeedItem[] {
  const $xml = load(rawXml, { xmlMode: true });
  const items = parseRssItems($xml, feedUrl);
  return items.length > 0 ? items : parseAtomEntries($xml, feedUrl);
}
