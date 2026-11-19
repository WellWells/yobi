import { foldText, measureOf, unitPriceOf, type MeasureUnit } from './measure';
import { costco, daybuy, momo, pchome, ruten } from './stores/api';
import { cosmed, hola, poya, senao, trplus, wanjiafu, watsons } from './stores/chains';
import { FEEBEE_ID, FEEBEE_NAME, rakuten, searchFeebee, yahoo } from './stores/pages';
import {
  StoreReadError, type PriceOffer, type StoreFetch, type StoreOffer, type StoreReader, type StoreRequest, type StoreResponse,
  type StoreResult, type StoreStatus,
} from './types';

/*
 * One product search across Taiwan's shops, in code: every store is asked at the same time (they
 * are different hosts), each with its own time limit, and a store that refuses, is down or times
 * out is passed over and named in the result. The prices are the stores' own figures; what a
 * model gets is this list and its statistics to judge, never a page to read a price off.
 */

/**
 * How long one store may take. The search answers when the slowest store has, so this is the most
 * a store that hangs can cost the whole answer; every store read so far answers in under two seconds.
 */
export const STORE_TIMEOUT_MS = 6_000;
/** Read from each store before the filters; a store's own ranking puts the nearest matches first. */
const PER_STORE_MAX = 30;
export const PRICE_LIMIT_DEFAULT = 20;
export const PRICE_LIMIT_MAX = 60;
/** The share of the query's words a title has to hold to count as a match. */
const MIN_TITLE_SCORE = 0.5;

export const STORE_READERS: readonly StoreReader[] = [pchome, momo, yahoo, ruten, rakuten, costco, daybuy, wanjiafu, watsons, cosmed, poya, senao, trplus, hola];
export const PRICE_STORE_IDS: readonly string[] = [...STORE_READERS.map((reader) => reader.id), FEEBEE_ID];

export type PriceSort = 'price' | 'unit' | 'relevance';

export interface PriceSearchInput {
  query: string;
  /** Store ids to ask; empty = all of them. */
  stores?: readonly string[];
  /** A title holding any of these is dropped (accessories, used goods). */
  exclude?: readonly string[];
  minPrice?: number;
  maxPrice?: number;
  sort?: PriceSort;
  limit?: number;
}

export interface PriceSearchDeps {
  fetch: (url: string, request: StoreRequest | undefined, signal: AbortSignal) => Promise<StoreResponse>;
  now: () => Date;
  log: (line: string) => void;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface PriceStats {
  count: number;
  lowest: number;
  highest: number;
  average: number;
  median: number;
}

/** How many offers cost from `from` up to (not including) `to`. */
export interface PriceBand {
  from: number;
  to: number;
  count: number;
}

export interface UnitStats extends PriceStats {
  per: MeasureUnit;
}

export interface PriceSearchResult {
  query: string;
  checkedAt: Date;
  /** Over every offer that passed the filters, not only the ones listed. */
  stats: PriceStats | null;
  /** Unit prices of the offers whose titles state a size in the most common unit. */
  unitStats: UnitStats | null;
  stores: StoreResult[];
  /** Sorted and cut to the limit. */
  offers: PriceOffer[];
  /** How many passed the filters in all. */
  matched: number;
  /** "unmatched": no title held the query's words, so the shops' own closest results are listed. */
  matching: 'matched' | 'unmatched';
  /** Most matches hold a word one character off the query's: the shops read it as another spelling. */
  respelt: boolean;
  /** The query as those titles spell it, when they agree on one spelling. */
  suggestion: string | null;
  /** Where the prices cluster, cheapest first; empty when they are all of one size. */
  bands: PriceBand[];
}

interface Candidate extends PriceOffer {
  storeId: string;
  /** Position in its store's own ranking. */
  rank: number;
  score: number;
  /** Matched only as a word with one character different. */
  respelt: boolean;
  /** That word, and how this title spells it. */
  fix?: { from: string; to: string };
}

function median(sorted: readonly number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function statsOf(prices: readonly number[]): PriceStats | null {
  if (!prices.length) return null;
  const sorted = [...prices].sort((a, b) => a - b);
  return {
    count: sorted.length,
    lowest: sorted[0],
    highest: sorted[sorted.length - 1],
    average: round2(sorted.reduce((sum, price) => sum + price, 0) / sorted.length),
    median: round2(median(sorted)),
  };
}

/**
 * The price bands of a result: a search for "airtag" brings NT$41 cases and NT$3,390 four-packs,
 * and the lowest price over all of them answers nothing. The bands show where to cut (a
 * `minPrice`) without anyone reading every title: a count per 1-2-5 step, cheapest first.
 */
export function priceBands(prices: readonly number[]): PriceBand[] {
  const counts = new Map<number, number>();
  for (const price of prices) {
    if (!(price > 0)) continue;
    const floor = bandFloor(price);
    counts.set(floor, (counts.get(floor) ?? 0) + 1);
  }
  if (counts.size < 2) return [];
  return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([from, count]) => ({ from, to: bandCeiling(from), count }));
}

/** The 1-2-5 step at or below a price: 41 → 20, 990 → 500, 3,390 → 2,000. */
function bandFloor(price: number): number {
  const decade = 10 ** Math.floor(Math.log10(price));
  const lead = price / decade;
  return (lead >= 5 ? 5 : lead >= 2 ? 2 : 1) * decade;
}

function bandCeiling(from: number): number {
  const decade = 10 ** Math.floor(Math.log10(from));
  const lead = Math.round(from / decade);
  return (lead === 1 ? 2 : lead === 2 ? 5 : 10) * decade;
}

function unitStatsOf(offers: readonly PriceOffer[]): UnitStats | null {
  const byUnit = new Map<MeasureUnit, number[]>();
  for (const offer of offers) {
    if (offer.unit === undefined || offer.unitPrice === undefined) continue;
    const unit = offer.unit as MeasureUnit;
    byUnit.set(unit, [...(byUnit.get(unit) ?? []), offer.unitPrice]);
  }
  const [per, prices] = [...byUnit.entries()].sort((a, b) => b[1].length - a[1].length)[0] ?? [];
  const stats = per && prices && prices.length >= 2 ? statsOf(prices) : null;
  return stats && per ? { per, ...stats } : null;
}

/** The query's words, folded like the titles they are looked for in. */
export function queryWords(query: string): string[] {
  return [...new Set(foldText(query).split(/[\s,，、]+/).filter(Boolean))];
}

function compact(text: string): string {
  return foldText(text).replace(/\s+/g, '');
}

/** The words the result's note about a mistyped name is told by. */
export const RESPELT_HINT = 'one character differently';

/** The share of a run-together word's character pairs a title has to hold to count as holding it. */
const PAIR_SHARE = 0.6;
const TYPO_PAIR_SHARE = 0.5;
const CJK_RUN = /^[㐀-鿿]{4,}$/;

/**
 * Whether a title holds a query word. Chinese written without spaces is one "word" of several
 * (品牌＋品名: 海倫仙度絲洗髮精), and a shop words the product its own way (海倫仙度絲 去屑洗髮乳),
 * so such a word counts when most of its two-character pairs are in the title.
 */
function titleHolds(title: string, word: string): 'held' | 'respelt' | null {
  if (title.includes(word)) return 'held';
  if (!CJK_RUN.test(word)) return null;
  const pairs = Array.from({ length: word.length - 1 }, (_, index) => word.slice(index, index + 2));
  const share = pairs.filter((pair) => title.includes(pair)).length / pairs.length;
  if (share >= PAIR_SHARE) return 'held';
  // One character mistyped (輝業 for 輝葉) breaks two of a short word's pairs. The shop's search
  // corrected it, so a title holding every character but one, and half the pairs, is the product.
  const missing = [...word].filter((char) => !title.includes(char)).length;
  return missing <= 1 && share >= TYPO_PAIR_SHARE ? 'respelt' : null;
}

const CJK_CHAR = /^[㐀-鿿]$/;

/**
 * The word as the title spells it, for a word it holds but for one character: the character the
 * title writes in that place (after the one before it, or before the one after it).
 */
function wordAsSpelt(title: string, word: string): string | null {
  const at = [...word].findIndex((char) => !title.includes(char));
  if (at < 0) return null;
  const before = word[at - 1];
  const after = word[at + 1];
  const place = before && title.includes(before) ? title.indexOf(before) + 1
    : after && title.indexOf(after) > 0 ? title.indexOf(after) - 1 : -1;
  const written = place >= 0 ? title[place] : undefined;
  return written && CJK_CHAR.test(written) ? `${word.slice(0, at)}${written}${word.slice(at + 1)}` : null;
}

/** The share of the respelt matches that must agree on one spelling for it to be taken as the name meant. */
const SPELLING_AGREEMENT = 0.6;

/** The query with its mistyped word as most titles spell it; null when they do not agree on one. */
function suggestedQuery(query: string, kept: readonly Candidate[]): string | null {
  const fixes = kept.flatMap((offer) => (offer.fix ? [offer.fix] : []));
  if (!kept.length || fixes.length * 2 < kept.length) return null;
  const votes = new Map<string, { from: string; to: string; count: number }>();
  for (const fix of fixes) {
    const key = `${fix.from}→${fix.to}`;
    votes.set(key, { ...fix, count: (votes.get(key)?.count ?? 0) + 1 });
  }
  const [best] = [...votes.values()].sort((a, b) => b.count - a.count);
  if (!best || best.count < fixes.length * SPELLING_AGREEMENT) return null;
  const at = foldText(query).indexOf(best.from);
  return at < 0 ? null : `${query.slice(0, at)}${best.to}${query.slice(at + best.from.length)}`;
}

function withMeasure(offer: StoreOffer): Pick<PriceOffer, 'unit' | 'unitPrice'> {
  const measure = measureOf(offer.title);
  return measure ? { unit: measure.unit, unitPrice: unitPriceOf(offer.price, measure) } : {};
}

/** Why a store's read ended without offers, in the result's words. */
function failureOf(err: unknown, timedOut: boolean): { status: StoreStatus; detail: string } {
  if (timedOut) return { status: 'timeout', detail: 'no answer in time' };
  if (err instanceof StoreReadError) return { status: err.kind, detail: err.message };
  return { status: 'down', detail: err instanceof Error ? err.message : String(err) };
}

interface SourceRead {
  result: StoreResult;
  offers: Array<StoreOffer & { store: string; via?: string }>;
}

/** One source under its own time limit; any failure becomes its status. */
async function readSource(
  id: string,
  name: string,
  read: (fetch: StoreFetch) => Promise<Array<StoreOffer & { store: string; via?: string }>>,
  deps: PriceSearchDeps,
): Promise<SourceRead> {
  const started = Date.now();
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(new Error('store timed out')); }, deps.timeoutMs ?? STORE_TIMEOUT_MS);
  const onStop = (): void => controller.abort(deps.signal?.reason);
  deps.signal?.addEventListener('abort', onStop, { once: true });
  const base = { id, store: name, count: 0 };
  try {
    const offers = (await read((url, request) => deps.fetch(url, request, controller.signal))).slice(0, PER_STORE_MAX);
    return { result: { ...base, status: offers.length ? 'ok' : 'empty', ms: Date.now() - started }, offers };
  } catch (err) {
    // The user's stop is not a store's failure: it ends the whole search.
    if (deps.signal?.aborted) throw deps.signal.reason instanceof Error ? deps.signal.reason : new Error('Price search stopped');
    const { status, detail } = failureOf(err, timedOut);
    deps.log(`🛒 [Price] ${name}: ${status} (${detail})`);
    return { result: { ...base, status, detail, ms: Date.now() - started }, offers: [] };
  } finally {
    clearTimeout(timer);
    deps.signal?.removeEventListener('abort', onStop);
  }
}

function sorted(candidates: Candidate[], sort: PriceSort): Candidate[] {
  // Sold out goes last whatever the order: it is not a price anyone can pay today.
  const buyable = (offer: Candidate): number => (offer.inStock === false ? 1 : 0);
  if (sort === 'relevance') return [...candidates].sort((a, b) => buyable(a) - buyable(b) || b.score - a.score || a.rank - b.rank || a.price - b.price);
  if (sort === 'unit') {
    const unit = (offer: Candidate): number => offer.unitPrice ?? Number.POSITIVE_INFINITY;
    return [...candidates].sort((a, b) => buyable(a) - buyable(b) || unit(a) - unit(b) || a.price - b.price);
  }
  return [...candidates].sort((a, b) => buyable(a) - buyable(b) || a.price - b.price || b.score - a.score || a.rank - b.rank);
}

function publicOffer({ storeId: _storeId, rank: _rank, score: _score, respelt: _respelt, fix: _fix, ...offer }: Candidate): PriceOffer {
  return offer;
}

export async function searchPrices(input: PriceSearchInput, deps: PriceSearchDeps): Promise<PriceSearchResult> {
  const query = input.query.trim();
  const wanted = new Set((input.stores ?? []).map((id) => id.trim().toLowerCase()).filter(Boolean));
  const asked = (id: string): boolean => wanted.size === 0 || wanted.has(id);
  const reads = await Promise.all([
    ...STORE_READERS.filter((reader) => asked(reader.id)).map((reader) => readSource(
      reader.id, reader.name,
      async (fetch) => (await reader.search(query, fetch)).map((offer) => ({ ...offer, store: reader.name })),
      deps,
    )),
    ...(asked(FEEBEE_ID)
      ? [readSource(FEEBEE_ID, FEEBEE_NAME, async (fetch) => (await searchFeebee(query, fetch)).map((offer) => ({ ...offer, via: FEEBEE_NAME })), deps)]
      : []),
  ]);

  const words = queryWords(query);
  const names = words.filter((word) => !/^\d/.test(word));
  const excluded = (input.exclude ?? []).map(compact).filter(Boolean);
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const { result, offers } of reads) {
    offers.forEach((offer, rank) => {
      const title = compact(offer.title);
      if (seen.has(offer.url) || excluded.some((word) => title.includes(word))) return;
      if (input.minPrice !== undefined && offer.price < input.minPrice) return;
      if (input.maxPrice !== undefined && offer.price > input.maxPrice) return;
      seen.add(offer.url);
      // A size or a count ("4入") names no product: a title has to hold one of the other words too.
      const held = words.map((word) => titleHolds(title, word));
      const score = !words.length ? 1 : names.length && !names.some((word) => held[words.indexOf(word)]) ? 0
        : held.filter(Boolean).length / words.length;
      const from = words[held.indexOf('respelt')];
      const to = from ? wordAsSpelt(title, from) : null;
      candidates.push({ ...offer, ...withMeasure(offer), storeId: result.id, rank, score, respelt: held.includes('respelt'), ...(from && to ? { fix: { from, to } } : {}) });
    });
  }

  // A shop's search already matched the query against more than the title (PChome leaves the
  // brand out of its titles), so a title holding half the words stays; one holding none is the
  // shop's "you may also like". When no title holds any (a misspelt query the shops corrected),
  // the shops' own results stand.
  const near = candidates.filter((offer) => offer.score >= MIN_TITLE_SCORE);
  const matching = near.length ? 'matched' : 'unmatched';
  const kept = near.length ? near : candidates;

  const stores = reads.map(({ result, offers }) => {
    const own = kept.filter((offer) => offer.storeId === result.id);
    const buyable = own.filter((offer) => offer.inStock !== false);
    return {
      ...result,
      status: result.status === 'ok' && own.length === 0 ? 'empty' as const : result.status,
      found: offers.length,
      count: own.length,
      ...(buyable.length ? { lowest: Math.min(...buyable.map((offer) => offer.price)) } : {}),
    };
  });
  const buyable = kept.filter((offer) => offer.inStock !== false);
  const limit = Math.min(PRICE_LIMIT_MAX, Math.max(1, Math.floor(input.limit ?? PRICE_LIMIT_DEFAULT)));
  deps.log(`🛒 [Price] "${query}": ${kept.length} offer(s) from ${stores.filter((store) => store.count > 0).length} source(s); ${stores.map((store) => `${store.id} ${store.status}${store.count ? ` ${store.count}` : ''}`).join(', ')}`);
  return {
    query,
    checkedAt: deps.now(),
    stats: statsOf(buyable.map((offer) => offer.price)),
    unitStats: unitStatsOf(buyable),
    stores,
    offers: sorted(kept, input.sort ?? 'price').slice(0, limit).map(publicOffer),
    matched: kept.length,
    matching,
    respelt: kept.length > 0 && kept.filter((offer) => offer.respelt).length * 2 >= kept.length,
    suggestion: suggestedQuery(query, kept),
    bands: priceBands(buyable.map((offer) => offer.price)),
  };
}
