import { load } from 'cheerio';
import { amountOf, expectOk, isRecord, jsonOf, listAt, listPriceOf, textOf } from '../storeResponse';
import { StoreReadError, type StoreOffer, type StoreReader, type StoreResponse } from '../types';

/*
 * The web shops of chains with stores on the street: a hypermarket, the drugstores, a phone shop.
 * One request each, read by the element or the JSON key that holds the result, never by the
 * page's wording. A shop belongs here only if it answers in about a second: the search takes as
 * long as its slowest source (a group-buying site that took five seconds was left out).
 */

const PAGE_HEADERS = { Accept: 'text/html,application/xhtml+xml' };
const JSON_HEADERS = { Accept: 'application/json, text/plain, */*' };

function validOffer(offer: StoreOffer): boolean {
  return Boolean(offer.title) && Number.isFinite(offer.price) && offer.price > 0 && Boolean(offer.url);
}

// ---- Wanjiafu (the hypermarket that was Carrefour Taiwan) ----

const WANJIAFU = 'https://online.uni-prosperity.com.tw';

export function parseWanjiafu(html: string): StoreOffer[] {
  const $ = load(html);
  // No row is also what a search with no match looks like; the release self-test notices a new layout.
  return $('a.gtm-product-alink[data-pid][data-price]').toArray().map((element): StoreOffer => {
    const row = $(element);
    const name = (row.attr('data-name') ?? '').trim();
    // "110PC抽 x 24 x 1PC串": the pack, which a name without a figure of its own leaves out.
    const pack = (row.attr('data-variant') ?? '').replace(/PC/g, '').trim();
    const price = amountOf(row.attr('data-price'));
    const href = row.attr('href') ?? '';
    const available = row.attr('data-ifavailable');
    return {
      title: pack && !/\d/.test(name) ? `${name} ${pack}` : name,
      price,
      ...listPriceOf(row.attr('data-baseprice'), price),
      inStock: available === undefined ? null : available === 'true',
      url: href.startsWith('/') ? `${WANJIAFU}${href}` : href,
    };
  }).filter(validOffer);
}

export const wanjiafu: StoreReader = {
  id: 'wanjiafu',
  name: '萬家福線上購物',
  search: async (query, fetch) => parseWanjiafu(expectOk(await fetch(`${WANJIAFU}/zh/search/?q=${encodeURIComponent(query)}`, { headers: PAGE_HEADERS }))),
};

// ---- Watsons ----

/** Only what an offer needs: the full answer is six times the size. */
const WATSONS_FIELDS = 'products(name,url,price(value),stock(stockLevelStatus)),pagination(totalResults)';

export function parseWatsons(data: unknown): StoreOffer[] {
  // A search with no match answers its paging and no product list.
  if (isRecord(data) && !('products' in data) && 'pagination' in data) return [];
  return listAt(data, ['products']).map((row): StoreOffer => {
    const status = isRecord(row.stock) ? textOf(row.stock.stockLevelStatus) : '';
    const path = textOf(row.url);
    return {
      title: textOf(row.name),
      price: amountOf(isRecord(row.price) ? row.price.value : undefined),
      inStock: status ? status !== 'outOfStock' : null,
      url: path.startsWith('/') ? `https://www.watsons.com.tw${encodeURI(path)}` : '',
    };
  }).filter(validOffer);
}

export const watsons: StoreReader = {
  id: 'watsons',
  name: '屈臣氏',
  search: async (query, fetch) => parseWatsons(jsonOf(await fetch(
    `https://api.watsons.com.tw/api/v2/wtctw/products/search?fields=${encodeURIComponent(WATSONS_FIELDS)}&query=${encodeURIComponent(query)}&pageSize=30&lang=zh_TW&curr=TWD`,
    { headers: JSON_HEADERS },
  ))),
};

// ---- Cosmed and Poya (two shops on one storefront platform) ----

/** The JSON array that follows `key` in a page's inline script; the script itself is not JSON. */
function arrayAfter(html: string, key: string): unknown[] {
  const at = html.indexOf(key);
  const start = at < 0 ? -1 : html.indexOf('[', at + key.length);
  if (start < 0) throw new StoreReadError('changed', `no ${key} in the page`);
  let depth = 0;
  let quoted = false;
  for (let index = start; index < html.length; index += 1) {
    const char = html[index];
    if (quoted) {
      if (char === '\\') index += 1;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '[') depth += 1;
    else if (char === ']' && (depth -= 1) === 0) {
      try {
        const list: unknown = JSON.parse(html.slice(start, index + 1));
        return Array.isArray(list) ? list : [];
      } catch {
        break;
      }
    }
  }
  throw new StoreReadError('changed', `${key} is not JSON`);
}

export function parseStorefront(html: string, origin: string): StoreOffer[] {
  return arrayAfter(html, '"SalePageList":').filter(isRecord).map((row): StoreOffer => {
    const price = amountOf(row.Price);
    const id = textOf(row.Id);
    return {
      title: textOf(row.Title),
      price,
      ...listPriceOf(row.SuggestPrice, price),
      inStock: typeof row.IsSoldOut === 'boolean' ? !row.IsSoldOut : null,
      url: id ? `${origin}/SalePage/Index/${id}` : '',
    };
  }).filter(validOffer);
}

function storefront(id: string, name: string, origin: string): StoreReader {
  return {
    id,
    name,
    search: async (query, fetch) => {
      const response: StoreResponse = await fetch(`${origin}/v2/Search?q=${encodeURIComponent(query)}`, { headers: PAGE_HEADERS });
      // The platform answers a search with no match with its "not found" page.
      return response.status === 404 ? [] : parseStorefront(expectOk(response), origin);
    },
  };
}

export const cosmed = storefront('cosmed', '康是美', 'https://shop.cosmed.com.tw');
export const poya = storefront('poya', '寶雅', 'https://www.poyabuy.com.tw');

// ---- Senao ----

export function parseSenao(html: string): StoreOffer[] {
  const $ = load(html);
  return $('a[data-martid][data-name][data-price]').toArray().map((element): StoreOffer => {
    const row = $(element);
    const id = (row.attr('data-martid') ?? '').trim();
    return {
      title: (row.attr('data-name') ?? '').trim(),
      price: amountOf(row.attr('data-price')),
      inStock: null,
      url: /^\d+$/.test(id) ? `https://online.senao.com.tw/mart/${id}` : '',
    };
  }).filter(validOffer);
}

export const senao: StoreReader = {
  id: 'senao',
  name: '神腦生活',
  search: async (query, fetch) => parseSenao(expectOk(await fetch(`https://online.senao.com.tw/Search?keyword=${encodeURIComponent(query)}`, { headers: PAGE_HEADERS }))),
};

// ---- TR Plus and HOLA (a home-improvement chain and its homeware sister, one shop system) ----

export function parseHomeStore(html: string, origin: string): StoreOffer[] {
  // The first list of that name is the result; a search with no match carries it empty.
  return arrayAfter(html, '"products":').filter(isRecord).map((row): StoreOffer => {
    const price = amountOf(row.salePrice);
    const sku = textOf(row.sku);
    return {
      title: textOf(row.name),
      price,
      ...listPriceOf(row.listPrice, price),
      inStock: typeof row.stockLevel === 'number' ? row.stockLevel > 0 : null,
      url: /^\w+$/.test(sku) ? `${origin}/p/${sku}` : '',
    };
  }).filter(validOffer);
}

function homeStore(id: string, name: string, origin: string): StoreReader {
  return {
    id,
    name,
    search: async (query, fetch) => parseHomeStore(expectOk(await fetch(`${origin}/search?q=${encodeURIComponent(query)}`, { headers: PAGE_HEADERS })), origin),
  };
}

export const trplus = homeStore('trplus', '特力屋', 'https://www.trplus.com.tw');
export const hola = homeStore('hola', 'HOLA', 'https://www.hola.com.tw');
