import { withSitePage, type SitePage } from './sitePage';

/*
 * An Agoda hotel's reviews, read the way its own page reads them: the hotel page opens in the
 * reader's hidden window (it runs the site's scripts and holds the session), the hotel id comes
 * from the page itself, and the review pages are asked for from inside that page with the same
 * request its paginator and sort control send (`ReviewComments`).
 *
 * The endpoint echoes whatever hotel id it is given and answers with some other hotel's reviews
 * for a wrong one, so the id is never derived from the link: only `initParams.propertyId`, read
 * on the page that was opened.
 */

/** Agoda's own reviews; a page also carries Booking.com's for the same hotel, labelled by source. */
const AGODA_PROVIDER = 332;
const PAGE_SIZE = 20;
/** Pages read per sort at most, whatever they bring. */
export const MAX_PAGES_PER_SORT = 6;
/** Long enough for the page's scripts to set the hotel's data, short enough for a chat send. */
const HOTEL_PAGE_WAIT_MS = 25_000;
const REVIEW_PAGE_PATH = '/api/cronos/property/review/ReviewComments';
const SUMMARY_PATH = '/api/cronos/property/review/HotelReviews';

export const AGODA_SORTS = { newest: 1, lowest: 3 } as const;
export type AgodaSort = keyof typeof AGODA_SORTS;

/** The candidate budget, about 100 reviews: the most recent, then the lowest-rated on top of them. */
export const AGODA_SAMPLE_PLAN: readonly { sort: AgodaSort; want: number }[] = [
  { sort: 'newest', want: 75 },
  { sort: 'lowest', want: 25 },
];

export interface AgodaReview {
  id: string;
  /** Where the review was written: "Agoda", "Booking.com". */
  source: string;
  /** On Agoda's 10-point scale. */
  rating: number;
  title: string;
  text: string;
  positives: string;
  negatives: string;
  /** YYYY-MM-DD the review was posted. */
  date: string;
  /** YYYY-MM the guest checked in, '' when not given. */
  stayed: string;
  traveller: string;
  room: string;
  nights: number;
  country: string;
  /** The language the review was written in, as the site tags it. */
  language: string;
  /** The hotel's response, '' when none. */
  reply: string;
}

export type AgodaStop = 'enough' | 'end' | 'repeat' | 'page-limit' | 'failed';

export interface AgodaSample {
  sort: AgodaSort;
  reviews: AgodaReview[];
  pages: number;
  stop: AgodaStop;
  /** Why the read stopped early, English, when `stop` is 'failed'. */
  error?: string;
}

export interface AgodaHotelReviews {
  hotelId: number;
  hotel: string;
  /** The hotel's page without its query (session and tracking parameters). */
  url: string;
  /** Agoda's overall score as the site states it, '' when it could not be read. */
  score: string;
  scoreMax: string;
  total: string;
  samples: AgodaSample[];
}

const HOTEL_PATH = /^\/(?:[a-z]{2}-[a-z]{2}\/)?[\w.%-]+\/(?:hotel|reviews)\/[\w.%-]+\.html$/i;

/** An Agoda hotel page or its reviews page, in any of the site's languages. */
export function isAgodaHotelUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  const host = url.hostname.toLowerCase();
  if (host !== 'agoda.com' && !host.endsWith('.agoda.com')) return false;
  return HOTEL_PATH.test(url.pathname);
}

/**
 * The link the read opens and the record keeps: the hotel page, without its query. A reviews page
 * (what a web search usually finds) sets no `initParams.propertyId`, so it is read as the hotel
 * page of the same name, which does.
 */
export function agodaCanonicalUrl(raw: string): string {
  const path = new URL(raw.trim()).pathname.replace(/\/reviews\/([^/]+\.html)$/i, '/hotel/$1');
  return `https://www.agoda.com${path}`;
}

export class AgodaReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgodaReadError';
  }
}

interface RawReviewerInfo {
  countryName?: string;
  reviewGroupName?: string;
  roomTypeName?: string;
  lengthOfStay?: number;
}

interface RawComment {
  hotelReviewId?: number | string;
  reviewProviderText?: string;
  rating?: number;
  reviewTitle?: string;
  reviewComments?: string;
  reviewPositives?: string;
  reviewNegatives?: string;
  reviewDate?: string;
  checkInDate?: string;
  translateSource?: string;
  responseText?: string;
  reviewerInfo?: RawReviewerInfo;
}

/** The text a feed puts in place of a review that has none. */
const NO_COMMENT = /^this guest did not leave comments/i;

function clean(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : '';
}

function reviewOf(raw: RawComment): AgodaReview | null {
  const id = raw.hotelReviewId === undefined ? '' : String(raw.hotelReviewId);
  const comment = clean(raw.reviewComments);
  const text = NO_COMMENT.test(comment) ? '' : comment;
  const positives = clean(raw.reviewPositives);
  const negatives = clean(raw.reviewNegatives);
  if (!id || (!text && !positives && !negatives)) return null;
  const info = raw.reviewerInfo ?? {};
  return {
    id,
    source: clean(raw.reviewProviderText),
    rating: typeof raw.rating === 'number' ? raw.rating : 0,
    title: clean(raw.reviewTitle),
    text,
    positives,
    negatives,
    date: clean(raw.reviewDate).slice(0, 10),
    stayed: clean(raw.checkInDate).slice(0, 7),
    traveller: clean(info.reviewGroupName),
    room: clean(info.roomTypeName),
    nights: typeof info.lengthOfStay === 'number' ? info.lengthOfStay : 0,
    country: clean(info.countryName),
    language: clean(raw.translateSource),
    reply: clean(raw.responseText),
  };
}

/** What a `fetch` from inside the page answered. */
export interface InPageResponse {
  status: number;
  type: string;
  text: string;
}

function parseJson(response: InPageResponse, what: string): unknown {
  if (response.status >= 400 || response.status === 0) {
    throw new AgodaReadError(`Agoda answered ${what} with HTTP ${response.status}`);
  }
  if (!/json/i.test(response.type)) {
    throw new AgodaReadError(`Agoda answered ${what} with ${response.type || 'no content type'} instead of JSON (a verification or sign-in page?)`);
  }
  try {
    return JSON.parse(response.text);
  } catch {
    throw new AgodaReadError(`Agoda's answer to ${what} is not valid JSON`);
  }
}

/** One page of `ReviewComments`: the reviews that carry any text, in the site's order. */
export function parseReviewPage(response: InPageResponse): AgodaReview[] {
  const json = parseJson(response, 'a review page') as { comments?: unknown } | null;
  if (!Array.isArray(json?.comments)) throw new AgodaReadError('Agoda\'s review page has no comment list');
  return (json.comments as RawComment[]).map(reviewOf).filter((review): review is AgodaReview => review !== null);
}

interface HotelSummary {
  hotel: string;
  score: string;
  scoreMax: string;
  total: string;
}

interface RawSummary {
  hotelName?: string;
  score?: { demographics?: { id?: number; score?: number; maxScore?: number; count?: number }[] };
}

/** `HotelReviews`'s overall score (the "all guests" entry); blanks for what is missing. */
export function parseHotelSummary(response: InPageResponse): HotelSummary {
  const json = parseJson(response, 'the hotel summary') as RawSummary | null;
  const all = json?.score?.demographics?.find((entry) => entry.id === 0);
  return {
    hotel: clean(json?.hotelName),
    score: typeof all?.score === 'number' ? String(all.score) : '',
    scoreMax: typeof all?.maxScore === 'number' ? String(all.maxScore) : '',
    total: typeof all?.count === 'number' ? String(all.count) : '',
  };
}

/**
 * Reads one sort's pages until it has `want` reviews not in `seen`, a page comes back empty or
 * with nothing new (the same page again), or `MAX_PAGES_PER_SORT` is reached. A page that fails
 * keeps what came before it; anything other than `AgodaReadError` (a Stop) is thrown as is.
 */
export async function collectSample(
  sort: AgodaSort,
  want: number,
  seen: Set<string>,
  fetchPage: (sort: AgodaSort, page: number) => Promise<InPageResponse>,
): Promise<AgodaSample> {
  const reviews: AgodaReview[] = [];
  let pages = 0;
  while (pages < MAX_PAGES_PER_SORT) {
    let page: AgodaReview[];
    try {
      page = parseReviewPage(await fetchPage(sort, pages + 1));
    } catch (err) {
      if (!(err instanceof AgodaReadError)) throw err;
      return { sort, reviews, pages, stop: 'failed', error: err.message };
    }
    pages++;
    if (page.length === 0) return { sort, reviews, pages, stop: 'end' };
    const fresh = page.filter((review) => !seen.has(review.id));
    if (fresh.length === 0) return { sort, reviews, pages, stop: 'repeat' };
    for (const review of fresh) {
      seen.add(review.id);
      reviews.push(review);
      if (reviews.length >= want) return { sort, reviews, pages, stop: 'enough' };
    }
  }
  return { sort, reviews, pages, stop: 'page-limit' };
}

const HOTEL_ID_SCRIPT = `(function () {
  var params = window.initParams;
  var id = params && Number(params.propertyId);
  if (!id) return null;
  var heading = document.querySelector('h1');
  return { id: id, name: heading ? heading.textContent.trim() : '' };
})()`;

function postScript(path: string, body: unknown): string {
  return `fetch(${JSON.stringify(path)}, {
  method: 'POST',
  credentials: 'include',
  headers: { 'content-type': 'application/json; charset=UTF-8', accept: 'application/json' },
  body: ${JSON.stringify(JSON.stringify(body))}
}).then(function (r) {
  return r.text().then(function (text) { return { status: r.status, type: r.headers.get('content-type') || '', text: text }; });
})`;
}

/** The body the page's own paginator sends, for another page or sort. */
export function reviewPageBody(hotelId: number, sort: AgodaSort, page: number): Record<string, unknown> {
  return {
    hotelId,
    providerId: AGODA_PROVIDER,
    demographicId: 0,
    page,
    pageSize: PAGE_SIZE,
    sorting: AGODA_SORTS[sort],
    providerIds: [AGODA_PROVIDER],
    isReviewPage: false,
    isCrawlablePage: true,
    filters: { language: [], room: [] },
    searchKeyword: '',
    searchFilters: [],
  };
}

function summaryBody(hotelId: number): Record<string, unknown> {
  return {
    hotelId,
    hotelProviderId: AGODA_PROVIDER,
    demographicId: 0,
    pageNo: 1,
    pageSize: 1,
    sorting: AGODA_SORTS.newest,
    reviewProviderIds: [AGODA_PROVIDER],
    isReviewPage: false,
    isCrawlablePage: true,
    paginationSize: 1,
  };
}

async function inPage(page: SitePage, path: string, body: unknown): Promise<InPageResponse> {
  const value = await page.evaluate(postScript(path, body)) as Partial<InPageResponse> | null;
  return { status: Number(value?.status ?? 0), type: String(value?.type ?? ''), text: String(value?.text ?? '') };
}

/**
 * Reads up to `AGODA_SAMPLE_PLAN`'s reviews of the hotel `url` shows. Stop rejects with the
 * signal's reason; a page that never sets the hotel's data rejects with `SitePageTimeout`; a
 * page failing later keeps what was read before it (its sample says why it stopped).
 */
export async function loadAgodaReviews(
  url: string,
  options: { signal?: AbortSignal; onLog?: (message: string) => void } = {},
): Promise<AgodaHotelReviews> {
  const canonical = agodaCanonicalUrl(url);
  return withSitePage('agoda', canonical, options.signal, async (page) => {
    const found = await page.waitFor(HOTEL_ID_SCRIPT, HOTEL_PAGE_WAIT_MS) as { id: number; name: string };
    let summary: HotelSummary = { hotel: '', score: '', scoreMax: '', total: '' };
    try {
      summary = parseHotelSummary(await inPage(page, SUMMARY_PATH, summaryBody(found.id)));
    } catch (err) {
      if (!(err instanceof AgodaReadError)) throw err;
      options.onLog?.(`Agoda overall score unread: ${err.message}`);
    }
    const seen = new Set<string>();
    const samples: AgodaSample[] = [];
    for (const { sort, want } of AGODA_SAMPLE_PLAN) {
      const sample = await collectSample(sort, want, seen, (s, n) => inPage(page, REVIEW_PAGE_PATH, reviewPageBody(found.id, s, n)));
      options.onLog?.(`Agoda ${sort}: ${sample.reviews.length} review(s) from ${sample.pages} page(s), stopped: ${sample.stop}${sample.error ? ` (${sample.error})` : ''}`);
      samples.push(sample);
    }
    return {
      hotelId: found.id,
      hotel: summary.hotel || found.name,
      url: canonical,
      score: summary.score,
      scoreMax: summary.scoreMax,
      total: summary.total,
      samples,
    };
  });
}
