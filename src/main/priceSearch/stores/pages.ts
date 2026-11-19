import { load } from 'cheerio';
import { amountOf, expectOk, isRecord, listAt, listPriceOf, textOf } from '../storeResponse';
import { StoreReadError, type StoreOffer, type StoreReader } from '../types';

/*
 * Stores whose search page carries its results as data inside the page: one page read, no second
 * request. Found by the element that holds the data (an id, a component name, data attributes),
 * never by the page's wording.
 */

const PAGE_HEADERS = { Accept: 'text/html,application/xhtml+xml' };

function validOffer(offer: StoreOffer): boolean {
  return Boolean(offer.title) && Number.isFinite(offer.price) && offer.price > 0;
}

/** The JSON inside the one script element the opening tag's pattern matches. */
function scriptJson(html: string, openTag: RegExp, what: string): unknown {
  const open = openTag.exec(html);
  const end = open ? html.indexOf('</script>', open.index) : -1;
  if (!open || end < 0) throw new StoreReadError('changed', `no ${what} in the page`);
  try {
    return JSON.parse(html.slice(open.index + open[0].length, end));
  } catch {
    throw new StoreReadError('changed', `${what} is not JSON`);
  }
}

// ---- Yahoo Shopping ----

export function parseYahoo(html: string): StoreOffer[] {
  const data = scriptJson(html, /<script[^>]*\bid="isoredux-data"[^>]*>/, 'isoredux-data');
  return listAt(data, ['search', 'ecsearch', 'hits']).map((row): StoreOffer => {
    const price = amountOf(row.ec_price);
    const id = textOf(row.ec_productid);
    const stock = textOf(row.ec_has_stock);
    return {
      title: textOf(row.ec_title),
      price,
      ...listPriceOf(row.ec_listprice, price),
      inStock: stock ? stock === '1' : null,
      // The page's own link carries the whole title; the id alone opens the same product.
      url: id ? `https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=${id}` : textOf(row.ec_item_url),
    };
  }).filter((offer) => validOffer(offer) && Boolean(offer.url));
}

export const yahoo: StoreReader = {
  id: 'yahoo',
  name: 'Yahoo購物中心',
  search: async (query, fetch) => parseYahoo(expectOk(await fetch(`https://tw.buy.yahoo.com/search/product?p=${encodeURIComponent(query)}`, { headers: PAGE_HEADERS }))),
};

// ---- Rakuten ----

export function parseRakuten(html: string): StoreOffer[] {
  const data = scriptJson(html, /<script[^>]*\bdata-component-name="SearchPage"[^>]*>/, 'the SearchPage data');
  return listAt(data, ['initialData', 'searchPage', 'result', 'items']).flatMap((row): StoreOffer[] => {
    const link = textOf(row.itemUrl);
    // Sponsored rows sit above the results whatever was searched: not a match, an advertisement.
    if (row.adFlag === true || /[?&]s-id=RADSearch/.test(link)) return [];
    const range = isRecord(row.itemPrice) ? row.itemPrice : {};
    const price = amountOf(range.min);
    const high = amountOf(range.max);
    const status = textOf(row.itemStatus);
    return [{
      title: textOf(row.itemName),
      price,
      ...(high > price ? { priceMax: high } : {}),
      ...listPriceOf(isRecord(row.itemListPrice) ? row.itemListPrice.min : undefined, price),
      inStock: status ? status === 'Available' : null,
      url: link.split('?')[0],
      ...(textOf(row.shopName) ? { seller: textOf(row.shopName) } : {}),
    }];
  }).filter((offer) => validOffer(offer) && Boolean(offer.url));
}

export const rakuten: StoreReader = {
  id: 'rakuten',
  name: '樂天市場',
  search: async (query, fetch) => parseRakuten(expectOk(await fetch(`https://www.rakuten.com.tw/search/${encodeURIComponent(query)}/`, { headers: PAGE_HEADERS }))),
};

// ---- Feebee (a price-comparison site: the stores no direct read reaches) ----

/** Feebee's ids of the stores read directly: its copy of their offers is the older one. */
const READ_DIRECTLY = /pchome|momo|ybuy|ruten|rakuten|costco|^cec$|senao|watsons|cosmed|poya/i;

/** The store's own product address, which the row's "find the same item" link carries as a parameter. */
function merchantUrl(compareLink: string | undefined): string {
  if (!compareLink) return '';
  try {
    const target = new URL(compareLink).searchParams.get('url') ?? '';
    return /^https?:\/\//i.test(target) ? target : '';
  } catch {
    return '';
  }
}

export interface FeebeeOffer extends StoreOffer {
  /** The store as Feebee names it. */
  store: string;
}

export function parseFeebee(html: string): FeebeeOffer[] {
  const $ = load(html);
  // Organic rows only: a row that is an advertisement carries no item id.
  // No row is also what a search with no match looks like, so it reads as empty; the live
  // self-test is what notices a changed layout.
  const rows = $('li.js-item[data-id][data-store][data-price]').toArray();
  return rows.flatMap((element): FeebeeOffer[] => {
    const row = $(element);
    const provider = row.attr('data-provider') ?? '';
    if (READ_DIRECTLY.test(provider)) return [];
    const url = merchantUrl(row.find('[data-compare-found-url]').attr('data-compare-found-url')) || (row.attr('data-url') ?? '');
    return [{
      store: (row.attr('data-store') ?? '').trim(),
      title: (row.attr('data-title') ?? '').trim(),
      price: amountOf(row.attr('data-price')),
      inStock: null,
      url,
    }];
  }).filter((offer) => validOffer(offer) && Boolean(offer.store) && Boolean(offer.url));
}

export const FEEBEE_ID = 'feebee';
export const FEEBEE_NAME = 'Feebee 飛比';

export async function searchFeebee(query: string, fetch: Parameters<StoreReader['search']>[1]): Promise<FeebeeOffer[]> {
  return parseFeebee(expectOk(await fetch(`https://feebee.com.tw/s/?q=${encodeURIComponent(query)}`, { headers: PAGE_HEADERS })));
}
