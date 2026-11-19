import { load } from 'cheerio';
import { foldText } from '../measure';
import { amountOf, isRecord, jsonOf, listAt, listPriceOf, textOf } from '../storeResponse';
import { StoreReadError, type StoreFetch, type StoreOffer, type StoreReader } from '../types';

/*
 * Stores whose own search page asks a JSON endpoint: the same request the page makes, read once.
 * Each reader returns the store's order (its relevance ranking) and never throws for one bad row.
 */

const JSON_HEADERS = { Accept: 'application/json, text/plain, */*' };

function validOffer(offer: StoreOffer): boolean {
  return Boolean(offer.title) && Number.isFinite(offer.price) && offer.price > 0;
}

// ---- PChome 24h ----

const PCHOME_STOCK_FIELDS = 'Id,Qty,ButtonType';
const PCHOME_PAGE = 30;

/** Which products can be bought now, from the endpoint the product page's buy button asks; empty when it does not answer. */
async function pchomeStock(ids: readonly string[], fetch: StoreFetch): Promise<Map<string, boolean>> {
  const stock = new Map<string, boolean>();
  if (!ids.length) return stock;
  try {
    const rows = jsonOf(await fetch(`https://ecapi-cdn.pchome.com.tw/ecshop/prodapi/v2/prod/button&id=${ids.join(',')}&fields=${PCHOME_STOCK_FIELDS}`, { headers: JSON_HEADERS }));
    if (!Array.isArray(rows)) return stock;
    for (const row of rows.filter(isRecord)) {
      // One row per option ("<product id>-000"): the product is in stock when any option is.
      const id = textOf(row.Id).replace(/-\d{3}$/, '');
      const buyable = textOf(row.ButtonType) === 'ForSale' && amountOf(row.Qty) > 0;
      stock.set(id, (stock.get(id) ?? false) || buyable);
    }
  } catch {
    // Stock is an extra: without it the offers still stand, marked unknown.
  }
  return stock;
}

export const pchome: StoreReader = {
  id: 'pchome',
  name: 'PChome 24h購物',
  search: async (query, fetch) => {
    const asked = encodeURIComponent(query);
    // The newer search names each product with its brand ("輝葉 AI追夢椅"), which a title has to
    // hold to be matched; the older one leaves the brand out but still answers a misspelt name,
    // so it is asked only when the newer one found nothing.
    const newer = jsonOf(await fetch(`https://ecshweb.pchome.com.tw/search/v4.3/all/results?q=${asked}&page=1&pageCount=${PCHOME_PAGE}`, { headers: JSON_HEADERS }));
    let rows = isRecord(newer) && Array.isArray(newer.Prods) ? newer.Prods.filter(isRecord) : [];
    if (!rows.length) {
      const older = jsonOf(await fetch(`https://ecshweb.pchome.com.tw/search/v3.3/all/results?q=${asked}&page=1&sort=rnk/dc`, { headers: JSON_HEADERS }));
      // No match at all comes back without the list.
      if (isRecord(older) && !('prods' in older)) return [];
      rows = listAt(older, ['prods']);
    }
    const stock = await pchomeStock(rows.map((row) => textOf(row.Id)).filter(Boolean), fetch);
    return rows.map((row): StoreOffer => {
      const id = textOf(row.Id);
      // The two versions spell their keys differently.
      const price = amountOf(row.Price ?? row.price);
      return {
        title: textOf(row.Name ?? row.name),
        price,
        ...listPriceOf(row.OriginPrice ?? row.originPrice, price),
        inStock: stock.get(id) ?? null,
        url: `https://24h.pchome.com.tw/prod/${id}`,
      };
    }).filter(validOffer);
  },
};

// ---- momo ----

function momoBody(query: string): string {
  return JSON.stringify({
    host: 'momoshop',
    flag: 'searchEngine',
    data: {
      searchValue: query, curPage: '1', priceS: '0', priceE: '9999999', searchType: '1', maxPage: '1', minPage: '1',
      cateType: '', cateCode: '', cateLevel: '-1', cp: 'N', NAM: 'N', first: 'N', freeze: 'N', superstore: 'N', tvshop: 'N',
      china: 'N', tomorrow: 'N', stockYN: 'N', prefere: 'N', threeHours: 'N', video: 'N', cycle: 'N', cod: 'N',
      superstorePay: 'N', showType: 'chessboardType', authorNo: '', originalImage: 'N', specialGoodsType: '',
    },
  });
}

export const momo: StoreReader = {
  id: 'momo',
  name: 'momo購物網',
  search: async (query, fetch) => {
    const data = jsonOf(await fetch('https://apisearch.momoshop.com.tw/momoSearchCloud/moec/textSearch', {
      headers: { ...JSON_HEADERS, Referer: 'https://www.momoshop.com.tw/', Origin: 'https://www.momoshop.com.tw' },
      post: { contentType: 'application/json', body: momoBody(query) },
    }));
    return listAt(data, ['rtnSearchData', 'goodsInfoList']).map((row): StoreOffer => {
      const price = amountOf(row.goodsPrice);
      const stock = amountOf(row.goodsStock);
      return {
        title: textOf(row.goodsName),
        price,
        ...listPriceOf(row.goodsPriceOri, price),
        inStock: Number.isFinite(stock) ? stock > 0 : null,
        url: `https://www.momoshop.com.tw/goods/GoodsDetail.jsp?i_code=${textOf(row.goodsCode)}`,
      };
    }).filter(validOffer);
  },
};

// ---- Ruten ----

const RUTEN_HEADERS = { ...JSON_HEADERS, Referer: 'https://www.ruten.com.tw/' };

export const ruten: StoreReader = {
  id: 'ruten',
  name: '露天市集',
  search: async (query, fetch) => {
    // The search answers ids only; the listings' names and prices come from a second call.
    const answer = await fetch(`https://rtapi.ruten.com.tw/api/search/v3/index.php/core/prod?q=${encodeURIComponent(query)}&type=direct&sort=rnk%2Fdc&offset=1&limit=30`, { headers: RUTEN_HEADERS });
    // 410 is how Ruten answers a search it does not serve (spirits): nothing to list.
    if (answer.status === 410) return [];
    const found = jsonOf(answer);
    const ids = listAt(found, ['Rows']).map((row) => textOf(row.Id)).filter(Boolean);
    if (!ids.length) return [];
    const rows = jsonOf(await fetch(`https://rtapi.ruten.com.tw/api/prod/v2/index.php/prod?id=${ids.join(',')}`, { headers: RUTEN_HEADERS }));
    const byId = new Map((Array.isArray(rows) ? rows.filter(isRecord) : []).map((row) => [textOf(row.ProdId), row]));
    return ids.flatMap((id): StoreOffer[] => {
      const row = byId.get(id);
      if (!row) return [];
      const range = Array.isArray(row.PriceRange) ? row.PriceRange.map(amountOf).filter(Number.isFinite) : [];
      if (!range.length) return [];
      const price = Math.min(...range);
      const high = Math.max(...range);
      const stock = amountOf(row.StockQty);
      return [{
        title: textOf(row.ProdName),
        price,
        ...(high > price ? { priceMax: high } : {}),
        inStock: Number.isFinite(stock) ? stock > 0 : null,
        url: `https://www.ruten.com.tw/item/show?${id}`,
      }];
    }).filter(validOffer);
  },
};

// ---- Daybuy (Costco warehouse prices, as members report them) ----

/** A sighting older than this says little about what the warehouse charges now. */
const DAYBUY_MAX_AGE_DAYS = 365;

/** `&amp;`, `&#8211;` and the like in a title WordPress has rendered for HTML. */
function plainTitle(rendered: string): string {
  return rendered
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .trim();
}

/** "20261118" → "2026-11-18"; "" when the field holds anything else. */
function sightingDate(value: unknown): string {
  const digits = /^(\d{4})(\d{2})(\d{2})$/.exec(textOf(value));
  return digits ? `${digits[1]}-${digits[2]}-${digits[3]}` : '';
}

const DAYBUY_POSTS = 'https://www.daybuy.tw/wp-json/wp/v2/posts';
const DAYBUY_FIELDS = 'id,link,title,acf,content';
/** A product post's own address; its last segment is the post's id. */
const DAYBUY_PRODUCT_LINK = /^https:\/\/www\.daybuy\.tw\/costco\/(\d+)\/?$/;
/** Products followed out of news posts in one search: one more request, never a crawl. */
const DAYBUY_LINKED_MAX = 20;
/** The size sits in whichever of these the product's kind uses: a bottle, a bag, a pack. */
const DAYBUY_SIZE_FIELDS = ['capacity', 'weight', 'quantity'] as const;

function renderedOf(value: unknown): string {
  return isRecord(value) ? textOf(value.rendered) : '';
}

/** A product post as an offer; nothing for a news post, an old sighting or a post without a price. */
function daybuyOffer(row: Record<string, unknown>, oldest: string): StoreOffer[] {
  const fields = isRecord(row.acf) ? row.acf : {};
  const price = amountOf(fields.price);
  const seen = sightingDate(fields.update);
  if (!Number.isFinite(price) || (seen && seen < oldest)) return [];
  const title = plainTitle(renderedOf(row.title));
  const size = DAYBUY_SIZE_FIELDS.map((key) => textOf(fields[key])).find(Boolean) ?? '';
  // The body of a product post is its short description: the roast, the origin, the material.
  const about = load(renderedOf(row.content)).text().replace(/\s+/g, ' ').trim();
  // Each time a member reported a price for this product: the page's own price history.
  const history = (Array.isArray(fields.historical_price) ? fields.historical_price : []).filter(isRecord)
    .map((entry) => ({ date: sightingDate(entry.price_sighting_date), price: amountOf(entry.price_sighting) }))
    .filter((entry) => entry.date && Number.isFinite(entry.price) && entry.price > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const offer: StoreOffer = {
    // The size is its own field on the page; in the title it lets the unit price be worked out.
    title: size && !title.includes(size) ? `${title} ${size}` : title,
    price,
    inStock: null,
    url: textOf(row.link),
    ...(seen ? { asOf: seen } : {}),
    ...(about ? { about } : {}),
    ...(history.length ? { history } : {}),
  };
  return validOffer(offer) && offer.url ? [offer] : [];
}

/** The products a news post links whose names hold a query word: the ones a title search misses. */
function daybuyLinkedIds(rows: ReadonlyArray<Record<string, unknown>>, query: string, listed: ReadonlySet<string>): string[] {
  const words = foldText(query).split(/[\s,，、]+/).filter(Boolean);
  const ids = new Set<string>();
  for (const row of rows) {
    const $ = load(renderedOf(row.content));
    $('a[href]').each((_, anchor) => {
      const id = DAYBUY_PRODUCT_LINK.exec($(anchor).attr('href') ?? '')?.[1];
      if (!id || listed.has(id)) return;
      const name = foldText($(anchor).text()).replace(/\s+/g, '');
      if (words.some((word) => name.includes(word))) ids.add(id);
    });
  }
  return [...ids].slice(0, DAYBUY_LINKED_MAX);
}

export const daybuy: StoreReader = {
  id: 'daybuy',
  name: 'Costco 賣場（今購百科）',
  search: async (query, fetch) => {
    // The site's own WordPress API: a search answers each post with the price its page shows (a
    // custom field) and its body. Posts without a price are deal round-ups, not products.
    const rows = jsonOf(await fetch(`${DAYBUY_POSTS}?search=${encodeURIComponent(query)}&per_page=30&_fields=${DAYBUY_FIELDS}`, { headers: JSON_HEADERS }));
    if (!Array.isArray(rows)) throw new StoreReadError('changed', 'the answer is not a list of posts');
    const oldest = new Date(Date.now() - DAYBUY_MAX_AGE_DAYS * 86_400_000).toISOString().slice(0, 10);
    const posts = rows.filter(isRecord);
    const offers = posts.flatMap((row) => daybuyOffer(row, oldest));
    // A round-up matches the search by its body, where each product is a link to its own post.
    const listed = new Set(offers.flatMap((offer) => DAYBUY_PRODUCT_LINK.exec(offer.url)?.[1] ?? []));
    const linked = daybuyLinkedIds(posts.filter((row) => !isRecord(row.acf) || !Number.isFinite(amountOf(row.acf.price))), query, listed);
    if (!linked.length) return offers;
    try {
      const more = jsonOf(await fetch(`${DAYBUY_POSTS}?include=${linked.join(',')}&per_page=${linked.length}&_fields=${DAYBUY_FIELDS}`, { headers: JSON_HEADERS }));
      return Array.isArray(more) ? [...offers, ...more.filter(isRecord).flatMap((row) => daybuyOffer(row, oldest))] : offers;
    } catch {
      // The linked products are an extra: without them the search's own products still stand.
      return offers;
    }
  },
};

// ---- Costco ----

export const costco: StoreReader = {
  id: 'costco',
  name: 'Costco 好市多',
  search: async (query, fetch) => {
    const data = jsonOf(await fetch(`https://www.costco.com.tw/rest/v2/taiwan/products/search?fields=FULL&query=${encodeURIComponent(query)}&pageSize=30&lang=zh_TW&curr=TWD`, { headers: JSON_HEADERS }));
    return listAt(data, ['products']).map((row): StoreOffer => {
      const price = amountOf(isRecord(row.price) ? row.price.value : undefined);
      const level = isRecord(row.stock) ? textOf(row.stock.stockLevelStatus) : '';
      return {
        title: textOf(row.name),
        price,
        ...listPriceOf(isRecord(row.basePrice) ? row.basePrice.value : undefined, price),
        inStock: level ? level !== 'outOfStock' : null,
        url: `https://www.costco.com.tw/p/${textOf(row.code)}`,
      };
    }).filter(validOffer);
  },
};
