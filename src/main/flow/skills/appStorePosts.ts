import { load } from 'cheerio';
import { arr, num, obj, scriptJson, str, type Json } from './jsonPick';
import type { XThread } from './xPosts';

/*
 * An app's page on the App Store, read as a post with no media and no replies. The visitor page
 * carries, in its own server data, what a person pasting the link wants: the app's name and
 * one-line tagline, the developer, this storefront's download price, and whether it sells in-app
 * purchases with the top ones and their prices. No public API gives the in-app purchases of
 * someone else's app (the iTunes lookup has no such field; App Store Connect only answers for the
 * developer's own apps), so the page is the source.
 *
 * Every label shown is Apple's own, already in the storefront's language ("App內購買", "In-App
 * Purchases", "供應商"); the reader goes by the data's structure and never by a word. The storefront
 * is the page's: a Japanese link shows Japanese prices, and the currency is written beside them.
 *
 * The card is the post's `heading` (what a forward opens with); the description, the store's facts
 * (seller, size, category, languages, age rating) and the latest version's notes are its `text`,
 * which a chat folds and an "analyze" reads.
 */

const ICON_HOST = /^https:\/\/is\d-ssl\.mzstatic\.com\//;

interface Annotation {
  title: string;
  summary: string;
  /** Apple's own name / price pairs, as in the in-app purchase list. */
  pairs: Array<[name: string, value: string]>;
}

/** The app's own data in the page's `serialized-server-data` block (the one with a `lockup`). */
function pageData(html: string): Json | undefined {
  for (const block of scriptJson(html, { sjsOnly: false, marker: '"lockup"' })) {
    const page = obj(obj(arr(obj(block)?.data)[0])?.data);
    if (page?.lockup) return page;
  }
  return undefined;
}

/** The page's JSON-LD `SoftwareApplication` node; undefined when it has none that parses. */
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

function annotationsOf(page: Json): Annotation[] {
  const items = arr(obj(obj(page.shelfMapping)?.information)?.items);
  return items.flatMap((value) => {
    const item = obj(value);
    if (str(item?.$kind) !== 'Annotation') return [];
    const pairs = arr(item?.items).flatMap((entry): Array<[string, string]> => {
      const pair = obj(entry);
      if (str(pair?.$kind) !== 'textPair') return [];
      const name = str(pair?.leadingText).trim();
      const price = str(pair?.trailingText).trim();
      return name && price ? [[name, price]] : [];
    });
    const title = str(item?.title).trim();
    return title ? [{ title, summary: str(item?.summary).trim(), pairs }] : [];
  });
}

/** CJK storefronts set "label：value" with a full-width colon; the rest "label: value". */
function separatorFor(language: string): string {
  return /^(?:zh|ja)\b/i.test(language) ? '：' : ': ';
}

/**
 * The price and in-app purchase words of the store's attribute line. The line also carries a
 * sentence about the device the page is viewed on ("免費 · App內購買 · 專為 iPad 設計。尚未針對
 * macOS 驗證。"): the reader is a desktop browser, so it says macOS, which
 * means nothing to an iPhone user. The price and the flag are short words; the note is a sentence,
 * ending in a full stop in every storefront language. "$3.99" ends in a digit.
 */
export function priceAttributes(line: string): string {
  return line.split(' · ').map((part) => part.trim()).filter((part) => part && !/[。．.!！]$/.test(part)).join(' · ');
}

/** The download price as the store shows it ("免費 · App內購買", "$320.00"), else from the structured data. */
function priceLine(shown: string, offer: Json | undefined, ldOffer: Json | undefined, language: string): string {
  const currency = str(ldOffer?.priceCurrency).toUpperCase();
  const tag = /^[A-Z]{3}$/.test(currency) ? ` (${currency})` : '';
  if (shown) return `${shown}${tag}`;
  const formatted = str(offer?.priceFormatted);
  if (formatted) return `${formatted}${tag}`;
  if (!tag || typeof ldOffer?.price !== 'number') return '';
  try {
    return new Intl.NumberFormat(language || 'en', { style: 'currency', currency }).format(num(ldOffer.price));
  } catch {
    return '';
  }
}

function storefrontOf(page: Json, url: string): string {
  const fromData = str(obj(obj(page.developerAction)?.destination)?.storefront);
  let fromUrl = '';
  try {
    fromUrl = /^\/([a-z]{2})\//i.exec(new URL(url).pathname)?.[1] ?? '';
  } catch {
    // An unparsable address names no storefront.
  }
  return (fromData || fromUrl).toUpperCase();
}

/** An app as its App Store page shows it in one storefront, every label in Apple's own words. */
export interface AppStoreApp {
  id: string;
  title: string;
  tagline: string;
  developer: string;
  /** The storefront's code, upper case ("TW"); "" when the page names none. */
  storefront: string;
  /** The download price as shown, with the currency ("免費 · App內購買 (TWD)"); "" when unknown. */
  price: string;
  /** This app's own in-app purchases: Apple's heading ("App內購買：是") and its name / price list. */
  purchases: { heading: string; items: Array<{ name: string; price: string }> } | null;
  stars: number;
  reviews: number;
  description: string;
  /** Seller, size, category, languages, age rating: one "label：value" per line. */
  facts: string;
  /** The latest version and its notes. */
  notes: string;
  /** The latest version number without Apple's "版本"/"Version" label ("3.1.60"); "" when missing. */
  version: string;
  /** That version's notes alone; "" when none. */
  whatsNew: string;
  icon: string;
  link: string;
  /** "：" for CJK storefronts, ": " for the rest. */
  sep: string;
}

/**
 * The version in Apple's localized subtitle ("版本 3.1.60", "Version 2.4 (1021)", "バージョン 5.0"):
 * from the first digit on, so the label in any language drops away; the whole subtitle if no digit.
 */
export function versionNumber(subtitle: string): string {
  const text = subtitle.trim();
  const start = text.search(/\d/);
  return start < 0 ? text : text.slice(start).trim();
}

/** The app on an App Store page; null when the page carries no app (a 404, another page). */
export function parseAppStorePage(html: string, url: string, id: string): AppStoreApp | null {
  const page = pageData(html);
  if (!page) return null;
  const lockup = obj(page.lockup);
  const title = str(lockup?.title) || str(page.title);
  if (!title) return null;
  const $ = load(html);
  const ld = softwareNode(html);
  const language = $('html').attr('lang') ?? '';
  const sep = separatorFor(language);
  const offer = obj(page.titleOfferDisplayProperties);
  const rating = obj(ld?.aggregateRating);
  const shown = priceAttributes($('p.attributes').first().text().replace(/\s+/g, ' ').trim());
  // The flag is this app's own offer: neighbouring apps on the page carry theirs too.
  const annotations = annotationsOf(page);
  const purchases = offer?.hasInAppPurchases === true ? annotations.find((note) => note.pairs.length > 0) : undefined;
  const latest = obj(arr(obj(obj(page.shelfMapping)?.mostRecentVersion)?.items)[0]);
  const icon = str(obj(lockup?.icon)?.template).replace('{w}x{h}{c}.{f}', '512x512bb.png');
  const canonical = str(page.canonicalURL);

  return {
    id,
    title,
    tagline: str(lockup?.subtitle).trim(),
    developer: str(obj(page.developerAction)?.title) || str(obj(ld?.author)?.name),
    storefront: storefrontOf(page, url),
    price: priceLine(shown, offer, obj(ld?.offers), language),
    purchases: purchases
      ? {
        heading: `${purchases.title}${sep}${purchases.summary}`.trim(),
        items: purchases.pairs.map(([name, price]) => ({ name, price })),
      }
      : null,
    stars: num(rating?.ratingValue),
    reviews: num(rating?.reviewCount),
    description: arr(obj(obj(page.shelfMapping)?.description)?.items)
      .map((item) => str(obj(obj(item)?.paragraph)?.text).trim())
      .filter(Boolean)
      .join('\n\n'),
    facts: annotations
      .filter((note) => note !== purchases && note.pairs.length === 0 && note.summary)
      .map((note) => `${note.title}${sep}${note.summary}`)
      .join('\n'),
    notes: [str(latest?.primarySubtitle).trim(), str(latest?.text).trim()].filter(Boolean).join('\n'),
    version: versionNumber(str(latest?.primarySubtitle)),
    whatsNew: str(latest?.text).trim(),
    icon: ICON_HOST.test(icon) ? icon : '',
    link: canonical.startsWith('https://apps.apple.com/') ? canonical : url,
    sep,
  };
}

/** The in-app purchases as "- name：price" lines; "" when there are none. */
export function purchaseLines(app: AppStoreApp): string {
  return (app.purchases?.items ?? []).map(({ name, price }) => `- ${name}${app.sep}${price}`).join('\n');
}

/** The card: name, tagline, developer and storefront, price, in-app purchases, rating. */
export function appStoreCard(app: AppStoreApp): string {
  const card = [`**${app.title}**`];
  if (app.tagline) card.push(app.tagline);
  card.push([app.developer, app.storefront ? `App Store ${app.storefront}` : 'App Store'].filter(Boolean).join(' · '));
  if (app.price) card.push('', app.price);
  if (app.purchases) card.push(app.purchases.heading, purchaseLines(app));
  if (app.stars > 0) card.push(`★ ${app.stars}${app.reviews > 0 ? ` (${app.reviews.toLocaleString('en-US')})` : ''}`);
  return card.join('\n');
}

/** The app on an App Store page as a post; null when the page carries no app (a 404, another page). */
export function readAppStorePage(html: string, url: string, id: string): XThread | null {
  const app = parseAppStorePage(html, url, id);
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
      heading: appStoreCard(app),
      title: app.title,
    },
    replies: [],
  };
}
