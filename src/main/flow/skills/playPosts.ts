import { load } from 'cheerio';
import { decodeHtmlEntities } from '../../htmlEntities';
import { playAppUrl } from '../../../shared/linkSites/playLinks';
import { arr, at, initDataBlocks, num, obj, str, type Json } from './jsonPick';
import type { XThread } from './xPosts';

/*
 * An app's page on Google Play, read as a post with no media and no replies. The
 * visitor page carries its data in Google's positional data calls (`AF_initDataCallback`); the
 * app's own record is the one whose package name sits at [77][0] — the page also carries other
 * apps (the developer's, similar ones) with their own in-app purchase ranges, so a value is read
 * only from the record of the asked package. JSON-LD gives the name, developer, rating and the
 * download price's currency.
 *
 * Unlike the App Store, Google Play never shows the in-app purchase items: only "每個項目 $31.00 -
 * $330.00" (Speedtest TW; the same app's App Store page lists 移除廣告 $30.00). No public API has
 * them either (the Play Developer API answers only for the developer's own apps), so the range is
 * what the card says. Google's own words are used where the page has them (the range, 含廣告內容,
 * the category, the content rating); the few labels the page writes only as layout (free, installs,
 * version, updated, Android version) come from the caller, in the language the page was asked in.
 *
 * Paths, measured on a free app (TW, US) and a paid one (TW):
 * [0][0] title · [9][0] content rating · [13][3] installs ("1億+") · [19][0] in-app purchase range ·
 * [37][0] developer · [48][0] ads · [51][0][1] rating, [51][2][1] rating count ·
 * [57][0][0][0][0][1][0] = [micros, currency, "$235.00"] (no text when free) · [72][0][1]
 * description (HTML) · [73][0][1] tagline · [77][0] package · [79][0][0][0] category ·
 * [95][0][3][2] icon · [140][0][0][0] version, [140][1][1][0][0][1] Android version ·
 * [144][1][1] what's new (HTML) · [145][0][0] updated.
 */

const ICON_HOST = /^https:\/\/play-lh\.googleusercontent\.com\//;

/** The labels the page lays out without words, in the language the page was read in. */
export interface PlayLabels {
  free: string;
  /** "{{count}} 次下載" with the store's own count ("1億+"). */
  installs: (count: string) => string;
  category: string;
  contentRating: string;
  version: string;
  updated: string;
  android: string;
  whatsNew: string;
}

export interface PlayApp {
  id: string;
  title: string;
  tagline: string;
  developer: string;
  /** The country the page was read for, upper case ("TW"); "" when unknown. */
  region: string;
  /** "$235.00 (TWD)" or the free label with the currency. */
  price: string;
  /** Google's own "contains ads" words; "" when the app has no ads. */
  ads: string;
  /** Google's own in-app purchase range ("每個項目 $31.00 - $330.00"); "" when it sells none. */
  purchases: string;
  stars: number;
  ratings: number;
  /** The store's install count as written ("1億+"); "" when missing. */
  installs: string;
  description: string;
  /** Category, content rating, version, update date, Android version: one "label：value" per line. */
  facts: string;
  notes: string;
  /**
   * The latest version as the store writes it ("3.1.60"). An app whose version varies with the
   * device has none, so its update date stands in: a new release still changes this field.
   */
  version: string;
  /** That version's notes alone, without a heading; "" when none. */
  whatsNew: string;
  icon: string;
  link: string;
}

/** The app's own record among the page's data calls, by its package name. */
function appRecord(html: string, id: string): unknown[] | undefined {
  for (const data of initDataBlocks(html).values()) {
    const record = at(data, 1, 2);
    if (Array.isArray(record) && at(record, 77, 0) === id) return record;
  }
  return undefined;
}

function softwareNode(html: string): Json | undefined {
  const $ = load(html);
  for (const script of $('script[type="application/ld+json"]').toArray()) {
    try {
      const node = obj(JSON.parse($(script).text()));
      if (str(node?.['@type']) === 'SoftwareApplication') return node;
    } catch {
      // A block that is not JSON holds nothing to read.
    }
  }
  return undefined;
}

/** Google's HTML text (description, what's new) as plain lines. */
function plainText(html: string): string {
  const text = html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '');
  return decodeHtmlEntities(text).replace(/\n{3,}/g, '\n\n').trim();
}

function regionOf(url: string): string {
  try {
    return (new URL(url).searchParams.get('gl') ?? '').toUpperCase();
  } catch {
    return '';
  }
}

/** CJK pages set "label：value" with a full-width colon; the rest "label: value". */
function separatorFor(language: string): string {
  return /^(?:zh|ja)\b/i.test(language) ? '：' : ': ';
}

/** The app on a Google Play page; null when the page carries no record of this package. */
export function parsePlayPage(html: string, url: string, id: string, labels: PlayLabels): PlayApp | null {
  const record = appRecord(html, id);
  if (!record) return null;
  const ld = softwareNode(html);
  const title = str(at(record, 0, 0)) || str(ld?.name);
  if (!title) return null;
  const language = load(html)('html').attr('lang') ?? '';
  const sep = separatorFor(language);
  const offer = at(record, 57, 0, 0, 0, 0, 1, 0);
  const shownPrice = str(at(offer, 2)).trim();
  const currency = (str(at(offer, 1)) || str(obj(arr(ld?.offers)[0])?.priceCurrency)).toUpperCase();
  const tag = /^[A-Z]{3}$/.test(currency) ? ` (${currency})` : '';
  const facts: Array<[string, string]> = [
    [labels.category, str(at(record, 79, 0, 0, 0))],
    [labels.contentRating, str(at(record, 9, 0))],
    [labels.version, str(at(record, 140, 0, 0, 0))],
    [labels.updated, str(at(record, 145, 0, 0))],
    [labels.android, str(at(record, 140, 1, 1, 0, 0, 1))],
  ];
  const notes = plainText(str(at(record, 144, 1, 1)));
  const icon = str(at(record, 95, 0, 3, 2)) || str(ld?.image);
  return {
    id,
    title,
    tagline: str(at(record, 73, 0, 1)).trim(),
    developer: str(at(record, 37, 0)) || str(obj(ld?.author)?.name),
    region: regionOf(url),
    price: `${shownPrice || labels.free}${tag}`,
    ads: str(at(record, 48, 0)).trim(),
    purchases: str(at(record, 19, 0)).trim(),
    stars: Math.round(num(at(record, 51, 0, 1)) * 10) / 10,
    ratings: num(at(record, 51, 2, 1)),
    installs: str(at(record, 13, 3)).trim(),
    description: plainText(str(at(record, 72, 0, 1))),
    facts: facts.filter(([, value]) => value).map(([label, value]) => `${label}${sep}${value}`).join('\n'),
    notes: notes ? `${labels.whatsNew}\n${notes}` : '',
    version: str(at(record, 140, 0, 0, 0)).trim() || str(at(record, 145, 0, 0)).trim(),
    whatsNew: notes,
    icon: ICON_HOST.test(icon) ? icon : '',
    link: playAppUrl(id, regionOf(url).toLowerCase()),
  };
}

export interface PlaySearchHit {
  id: string;
  /** "" when the page names it only in its featured box (the first hit is read anyway). */
  name: string;
  developer: string;
}

/** Every package's name and developer in a data call: a record [[package, 7], …, [3] name, …, [14] developer]. */
function namedRecords(node: unknown, found: Map<string, { name: string; developer: string }>, depth = 0): void {
  if (!Array.isArray(node) || depth > 24) return;
  const id = at(node, 0, 0);
  if (typeof id === 'string' && typeof node[3] === 'string' && !found.has(id)) {
    found.set(id, { name: node[3], developer: str(node[14]) });
  }
  for (const child of node) namedRecords(child, found, depth + 1);
}

/**
 * A Google Play search page's apps, in its order (`store/search?q=speedtest&c=apps`):
 * the app links are the order; names come from the data calls where they have a record.
 */
export function playSearchHits(html: string, limit: number): PlaySearchHit[] {
  const ids = [...new Set([...html.matchAll(/\/store\/apps\/details\?id=([A-Za-z][\w.]*)/g)].map((match) => match[1]))]
    .filter((id) => id.includes('.'))
    .slice(0, limit);
  const named = new Map<string, { name: string; developer: string }>();
  for (const data of initDataBlocks(html).values()) namedRecords(data, named);
  return ids.map((id) => ({ id, name: named.get(id)?.name ?? '', developer: named.get(id)?.developer ?? '' }));
}

/** The card: name, tagline, developer and region, price, ads, in-app purchase range, rating, installs. */
export function playCard(app: PlayApp, labels: PlayLabels): string {
  const card = [`**${app.title}**`];
  if (app.tagline) card.push(app.tagline);
  card.push([app.developer, app.region ? `Google Play ${app.region}` : 'Google Play'].filter(Boolean).join(' · '));
  card.push('', app.price);
  if (app.ads) card.push(app.ads);
  if (app.purchases) card.push(app.purchases);
  const rating = app.stars > 0 ? `★ ${app.stars}${app.ratings > 0 ? ` (${app.ratings.toLocaleString('en-US')})` : ''}` : '';
  const installs = app.installs ? labels.installs(app.installs) : '';
  if (rating || installs) card.push([rating, installs].filter(Boolean).join(' · '));
  return card.join('\n');
}

/** The app on a Google Play page as a post; null when the page carries no record of it. */
export function readPlayPage(html: string, url: string, id: string, labels: PlayLabels): XThread | null {
  const app = parsePlayPage(html, url, id, labels);
  if (!app) return null;
  return {
    focal: {
      id,
      author: '',
      name: app.developer,
      createdAt: 0,
      text: [app.description, app.facts, app.notes].filter(Boolean).join('\n\n'),
      link: app.link,
      image: app.icon,
      replyCount: 0,
      likeCount: 0,
      inReplyTo: '',
      isRepost: false,
      media: [],
      quoteMedia: [],
      heading: playCard(app, labels),
      title: app.title,
    },
    replies: [],
  };
}
