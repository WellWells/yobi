import { sendLog } from '../../helpers';
import { fetchRawResponse } from '../../pageLoader';
import {
  PRICE_LIMIT_DEFAULT, PRICE_LIMIT_MAX, PRICE_STORE_IDS, RESPELT_HINT, searchPrices,
  type PriceSearchDeps, type PriceSearchResult, type PriceSort,
} from '../../priceSearch/priceSearch';
import type { PriceOffer, StoreResult } from '../../priceSearch/types';
import { makeCheckpointStore, type CheckpointStore } from '../checkpoint';
import { FlowUserError } from '../userError';
import { clampIntField, parseNumberField } from './numberField';
import { envelope } from './dataSources';

/*
 * The `price_search` step and /agent tool: one product name in, every reachable Taiwan shop asked
 * at once, one JSON document out (statistics, each source's state, the offers) for a model or a
 * later step to judge. With `track` a scheduled flow also learns whether the lowest price fell
 * since its last run, without a model.
 */

/** What a tracking step remembers between runs. */
interface PriceCheckpoint {
  lowest: number;
  /** The source the lowest came from: a run where it failed proves nothing about the price. */
  source: string;
  at: string;
  recordLow: number;
  recordAt: string;
}

/** Titles are cut here in the JSON: the document has to fit one browser-provider observation. */
const TITLE_MAX = 60;
/** A source's description of a product is cut here: enough to tell the variant. */
const ABOUT_MAX = 80;
/** The newest earlier prices listed per offer. */
const HISTORY_MAX = 6;
const TEXT_LINES = 10;
const SORTS: readonly PriceSort[] = ['price', 'unit', 'relevance'];
/** The step id every /agent call shares: nothing is remembered under it. */
const AGENT_STEP_ID = 'agent';

export interface PriceStepDeps extends PriceSearchDeps {
  store: CheckpointStore<unknown>;
}

function listField(raw: string | undefined): string[] {
  return (raw ?? '').split(/[,，、\n]+/).map((part) => part.trim()).filter(Boolean);
}

function priceField(raw: string | undefined, key: string): number | undefined {
  const text = (raw ?? '').trim();
  if (!text) return undefined;
  const value = parseNumberField(text.replace(/,/g, ''));
  if (value === null || value < 0) {
    throw new FlowUserError('flow.error.priceSearchNumber', { value: text }, `price_search: "${key}" must be a price in TWD, got "${text}"`);
  }
  return value;
}

function taipeiStamp(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: string): string => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`;
}

function money(amount: number): string {
  return `NT$${amount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function cut(title: string): string {
  return title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX - 1)}…` : title;
}

function offerJson(offer: PriceOffer): Record<string, unknown> {
  return {
    store: offer.store,
    ...(offer.via ? { via: offer.via } : {}),
    title: cut(offer.title),
    price: offer.price,
    ...(offer.priceMax ? { priceMax: offer.priceMax } : {}),
    ...(offer.listPrice ? { listPrice: offer.listPrice } : {}),
    ...(offer.inStock === null ? {} : { inStock: offer.inStock }),
    ...(offer.asOf ? { asOf: offer.asOf } : {}),
    ...(offer.about ? { about: offer.about.length > ABOUT_MAX ? `${offer.about.slice(0, ABOUT_MAX - 1)}…` : offer.about } : {}),
    ...(offer.history?.length ? { history: offer.history.slice(-HISTORY_MAX).map((entry) => [entry.date, entry.price]) } : {}),
    ...(offer.unit && offer.unitPrice !== undefined ? { per: offer.unit, unitPrice: offer.unitPrice } : {}),
    url: offer.url,
  };
}

function storeJson(store: StoreResult): Record<string, unknown> {
  return { store: store.store, status: store.status, ...(store.count ? { count: store.count } : {}), ...(store.lowest !== undefined ? { lowest: store.lowest } : {}) };
}

function notesOf(result: PriceSearchResult): string[] {
  return [
    ...(result.bands.length ? ['bands = [from, to, offers] per price range; accessories and the product sit in different ones: when the cheap ranges are not the product, call again with "minPrice" and "exclude".'] : []),
    ...(result.respelt ? [`Most titles spell a word of the query ${RESPELT_HINT}: the name was probably mistyped and the shops corrected it. Read the right name off the titles and search again with it (shops that answered nothing may hold it). In the answer, tell the user in one line that the name they typed looks misspelt, what you searched for instead, and that typing the exact name finds more shops and more precise results.`] : []),
    ...(result.matching === 'unmatched' ? ['No title holds the query words: these are the shops\' closest results, possibly a different product.'] : []),
    ...(result.matched > result.offers.length ? [`${result.matched} offers matched; ${result.offers.length} are listed. stats cover all in-stock matches.`] : []),
    ...(result.offers.some((offer) => offer.via) ? ['Offers with "via" are a comparison site\'s last reading of that shop, not read from the shop now.'] : []),
    ...(result.offers.some((offer) => offer.asOf) ? ['Offers with "asOf" are Costco warehouse prices members reported on that date (in-store, membership needed), not an online listing.'] : []),
    ...(result.offers.some((offer) => offer.history?.length) ? ['history = [date, price] that source recorded earlier for the same product, oldest first: its own record, not the market\'s.'] : []),
    ...(result.offers.some((offer) => offer.unit) ? ['unitPrice is computed from the size in the title.'] : []),
  ];
}

/** `typed`: the name as the user wrote it, when the search was made under the shops' spelling of it. */
export function priceDocument(result: PriceSearchResult, typed = ''): Record<string, unknown> {
  const notes = [
    ...(typed ? [`The name was typed "${typed}"; the shops spell this product "${result.query}", so that is what was searched. The answer must say so in one line right after the verdict: the name as typed, the name searched, and that typing the exact name finds more shops and more precise prices. Write the product's name as the titles do.`] : []),
    ...notesOf(result),
  ];
  return {
    ...(typed ? { typed } : {}),
    query: result.query,
    checkedAt: taipeiStamp(result.checkedAt),
    currency: 'TWD',
    stats: result.stats,
    ...(result.bands.length ? { bands: result.bands.map((band) => [band.from, band.to, band.count]) } : {}),
    ...(result.unitStats ? { unitStats: result.unitStats } : {}),
    stores: result.stores.map(storeJson),
    offers: result.offers.map(offerJson),
    ...(notes.length ? { notes } : {}),
  };
}

/**
 * Message-ready lines: price, shop, title. No words of the app's own to translate, and no links:
 * the lowest offer's is `lowestUrl`, the rest stay in the JSON for whoever asks.
 */
export function priceText(offers: readonly PriceOffer[]): string {
  return offers.slice(0, TEXT_LINES).map((offer) => {
    const price = offer.priceMax ? `${money(offer.price)}–${money(offer.priceMax)}` : money(offer.price);
    return `${price}｜${offer.store}｜${offer.title}`;
  }).join('\n');
}

function readCheckpoint(raw: unknown): PriceCheckpoint | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const { lowest, source, at, recordLow, recordAt } = record;
  if (typeof lowest !== 'number' || typeof recordLow !== 'number' || typeof source !== 'string' || typeof at !== 'string' || typeof recordAt !== 'string') return null;
  return { lowest, source, at, recordLow, recordAt };
}

/** `news` is what a watch flow gates on: "first" on the first run, "drop" when the lowest fell, else "". */
const UNTRACKED = { previousLowest: '', change: '', dropped: '0', isFirstRun: '0', recordLow: '', recordLowAt: '', isRecordLow: '0', news: '' };

/** What changed since this step's last run, and the new memory; a run that cannot tell keeps the old one. */
async function tracked(result: PriceSearchResult, stepId: string, store: CheckpointStore<unknown>): Promise<Record<string, string>> {
  const previous = readCheckpoint(await store.load(stepId));
  const cheapest = result.offers.find((offer) => offer.inStock !== false && offer.price === result.stats?.lowest);
  const lowest = result.stats?.lowest;
  const past = previous
    ? { previousLowest: String(previous.lowest), recordLow: String(previous.recordLow), recordLowAt: previous.recordAt }
    : {};
  if (lowest === undefined) return { ...UNTRACKED, ...past };
  const sourceOf = (name: string): StoreResult | undefined => result.stores.find((entry) => entry.store === name || entry.id === name);
  const lastSource = previous ? sourceOf(previous.source) : undefined;
  // The shop that held the lowest price could not be read this time: a higher lowest is its
  // absence, not a price rise, and writing it down would report a fall when the shop is back.
  const blind = previous !== null && lowest > previous.lowest && lastSource !== undefined && !['ok', 'empty'].includes(lastSource.status);
  if (blind) return { ...UNTRACKED, ...past };
  const now = taipeiStamp(result.checkedAt);
  const isRecordLow = previous !== null && lowest < previous.recordLow;
  const next: PriceCheckpoint = {
    lowest,
    source: cheapest?.via ?? cheapest?.store ?? '',
    at: now,
    recordLow: previous ? Math.min(previous.recordLow, lowest) : lowest,
    recordAt: !previous || isRecordLow ? now : previous.recordAt,
  };
  await store.save(stepId, next);
  return {
    previousLowest: previous ? String(previous.lowest) : '',
    change: previous ? String(Math.round((lowest - previous.lowest) * 100) / 100) : '',
    dropped: previous && lowest < previous.lowest ? '1' : '0',
    isFirstRun: previous ? '0' : '1',
    recordLow: String(next.recordLow),
    recordLowAt: next.recordAt,
    isRecordLow: isRecordLow ? '1' : '0',
    news: !previous ? 'first' : lowest < previous.lowest ? 'drop' : '',
  };
}

export async function runPriceSearchStep(config: Record<string, string>, stepId: string, deps: PriceStepDeps): Promise<string> {
  const query = (config.query ?? '').trim();
  if (!query) throw new FlowUserError('flow.error.priceSearchQuery', {}, 'price_search: "query" is required: the product name to look for');
  const stores = listField(config.stores).map((id) => id.toLowerCase());
  const unknown = stores.filter((id) => !PRICE_STORE_IDS.includes(id));
  if (unknown.length) {
    const value = unknown.join(', ');
    const known = PRICE_STORE_IDS.join(', ');
    throw new FlowUserError('flow.error.priceSearchStores', { value, stores: known }, `price_search: unknown store "${value}"; the stores are ${known}`);
  }
  const sort = (config.sort ?? '').trim().toLowerCase();
  const asked = {
    query,
    stores,
    exclude: listField(config.exclude),
    minPrice: priceField(config.minPrice, 'minPrice'),
    maxPrice: priceField(config.maxPrice, 'maxPrice'),
    sort: SORTS.find((entry) => entry === sort) ?? 'price',
    limit: clampIntField(config.limit, PRICE_LIMIT_DEFAULT, 1, PRICE_LIMIT_MAX),
  };
  const first = await searchPrices(asked, deps);
  // A name one character off what the shops' titles agree on (輝業 for 輝葉) is searched again as
  // they spell it: a shop that does not correct a typo itself answers only to the right name. Done
  // here, not left to a model: told to do it, a model answered from the first result and kept quiet.
  const typed = first.suggestion && first.suggestion !== query ? query : '';
  const result = typed && first.suggestion ? await searchPrices({ ...asked, query: first.suggestion }, deps) : first;

  const answered = result.stores.filter((store) => store.status === 'ok' || store.status === 'empty');
  if (!answered.length) {
    throw new FlowUserError('flow.error.priceSearchUnavailable', {}, `price_search: no shop could be read (${result.stores.map((store) => `${store.store}: ${store.status}`).join('; ')})`);
  }
  const cheapest = result.offers.find((offer) => offer.inStock !== false && offer.price === result.stats?.lowest);
  const failed = result.stores.filter((store) => !answered.includes(store));
  const tracking = config.track === 'true' && stepId !== AGENT_STEP_ID ? await tracked(result, stepId, deps.store) : {};
  const figure = (value: number | undefined): string => (value === undefined ? '' : String(value));
  return envelope(JSON.stringify(priceDocument(result, typed)), {
    text: priceText(result.offers),
    typed,
    query: result.query,
    count: String(result.matched),
    lowest: figure(result.stats?.lowest),
    highest: figure(result.stats?.highest),
    average: figure(result.stats?.average),
    median: figure(result.stats?.median),
    lowestStore: cheapest?.store ?? '',
    lowestTitle: cheapest?.title ?? '',
    lowestUrl: cheapest?.url ?? '',
    unit: result.unitStats?.per ?? '',
    unitLowest: figure(result.unitStats?.lowest),
    unitAverage: figure(result.unitStats?.average),
    checkedAt: taipeiStamp(result.checkedAt),
    failedStores: failed.map((store) => store.store).join('、'),
    ...tracking,
  });
}

const checkpoints = makeCheckpointStore<unknown>('price_search');

export function execPriceSearch(config: Record<string, string>, stepId: string, signal?: AbortSignal): Promise<string> {
  return runPriceSearchStep(config, stepId, {
    fetch: async (url, request, storeSignal) => {
      const { status, text } = await fetchRawResponse(url, { headers: request?.headers, post: request?.post, signal: storeSignal });
      return { status, text };
    },
    now: () => new Date(),
    log: sendLog,
    signal,
    store: checkpoints,
  });
}
