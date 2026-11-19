/** One listing as a store's own search gives it; every number is the store's, none is a model's. */
export interface StoreOffer {
  title: string;
  /** TWD, the lowest price of the listing when it has several options. */
  price: number;
  /** The highest option's price, when the listing is a range. */
  priceMax?: number;
  /** The crossed-out price, when the store shows one above the price. */
  listPrice?: number;
  /** null: the search result does not say. */
  inStock: boolean | null;
  url: string;
  /** YYYY-MM-DD the price was seen, for a source that reports sightings rather than a live shelf. */
  asOf?: string;
  /** Earlier prices the source recorded for this very listing, oldest first. */
  history?: Array<{ date: string; price: number }>;
  /** The source's own short description of the product, when its listing carries one. */
  about?: string;
  /** The shop inside a marketplace (Rakuten, Feebee's stores). */
  seller?: string;
}

/** An offer in the answer: the store it is from, and the size and unit price read off its title. */
export interface PriceOffer extends StoreOffer {
  store: string;
  /** Set when a price-comparison site listed it rather than the store's own search. */
  via?: string;
  /** "100g", "100ml" or "1 pc": what `unitPrice` is the price of. */
  unit?: string;
  unitPrice?: number;
}

/** Why a store gave nothing: all of them are passed over, none stops the search. */
export type StoreStatus = 'ok' | 'empty' | 'refused' | 'down' | 'timeout' | 'changed';

export interface StoreResult {
  id: string;
  store: string;
  status: StoreStatus;
  /** Offers the store's search returned, before the filters. */
  found?: number;
  /** Offers that passed the filters. */
  count: number;
  lowest?: number;
  ms: number;
  /** English, for the log and the model. */
  detail?: string;
}

export interface StoreResponse {
  status: number;
  text: string;
}

export interface StoreRequest {
  headers?: Record<string, string>;
  post?: { contentType: string; body: string };
}

/** The one way a reader reaches the network: the caller owns the timeout, the stop and the identity. */
export type StoreFetch = (url: string, request?: StoreRequest) => Promise<StoreResponse>;

export interface StoreReader {
  id: string;
  /** The store's own name, shown as it writes it. */
  name: string;
  search: (query: string, fetch: StoreFetch) => Promise<StoreOffer[]>;
}

export type StoreFailure = Exclude<StoreStatus, 'ok' | 'empty'>;

/** A store that could not be read, with which kind of trouble it was. */
export class StoreReadError extends Error {
  constructor(readonly kind: StoreFailure, detail: string) {
    super(detail);
    this.name = 'StoreReadError';
  }
}
