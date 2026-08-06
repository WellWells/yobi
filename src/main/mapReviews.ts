import { CLEAN_UA } from './userAgent';

const BOQ_ENDPOINT = 'https://www.google.com/httpservice/web/PrivateLocalSearchUiDataService/GetLocalBoqProxy';

const PAGE_SIZE = 10;
const MAX_REDIRECT_HOPS = 4;
const PER_FETCH_TIMEOUT_MS = 20_000;

export const SORT_ORDER = { relevant: 1, newest: 2, highest: 3, lowest: 4 } as const;
export type MapReviewSort = keyof typeof SORT_ORDER;

export interface MapReview {
  author: string;
  rating: number;
  date: string;
  text: string;
  reply: string;
}

export interface MapReviewsResult {
  place: string;
  reviews: MapReview[];
  placeUrl: string;
}

const FETCH_HEADERS = {
  'User-Agent': CLEAN_UA,
  'Accept': '*/*',
} as const;

export function isAllowedMapsHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'maps.app.goo.gl' || host === 'goo.gl') return true;
  return host === 'google.com' || host.endsWith('.google.com');
}

export function isMapsUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  if (host === 'maps.app.goo.gl' || host === 'maps.google.com') return true;
  const isGoogle = host === 'google.com' || host.endsWith('.google.com');
  return isGoogle && parsed.pathname.toLowerCase().startsWith('/maps');
}

export function extractPlaceId(url: string): string {
  const ids = [...url.matchAll(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/gi)];
  if (ids.length === 0) return '';
  if (ids.length === 1) return ids[0][1];
  const flag = /!1b1(?=!|$|\?)/.exec(url);
  if (flag) {
    const before = ids.filter((m) => (m.index ?? 0) < flag.index);
    if (before.length > 0) return before[before.length - 1][1];
  }
  return ids[ids.length - 1][1];
}

export function extractPlaceName(url: string): string {
  const match = /\/maps\/place\/([^/@?]+)/.exec(url);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]).replace(/\+/g, ' ').trim();
  } catch {
    return '';
  }
}

async function resolveMapsUrl(rawUrl: string): Promise<string> {
  let current = new URL(rawUrl.trim());
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    if (current.protocol !== 'http:' && current.protocol !== 'https:') {
      throw new Error(`unsupported protocol: ${current.protocol}`);
    }
    if (!isAllowedMapsHost(current.hostname)) {
      throw new Error(`not a Google Maps URL: ${current.hostname}`);
    }
    if (extractPlaceId(current.href)) return current.href;
    const res = await fetch(current.href, {
      redirect: 'manual',
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(PER_FETCH_TIMEOUT_MS),
    });
    const location = res.headers.get('location');
    if (!location) return current.href;
    current = new URL(location, current);
  }
  return current.href;
}

async function fetchMapsPageHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: FETCH_HEADERS,
    signal: AbortSignal.timeout(PER_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Google Maps page returned HTTP ${res.status}`);
  return res.text();
}

export function extractPlaceIdFromHtml(html: string): string {
  const counts = new Map<string, number>();
  for (const m of html.matchAll(/0x[0-9a-f]{6,}:0x[0-9a-f]{6,}/gi)) {
    const id = m[0].toLowerCase();
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const [id, count] of counts) {
    if (count > bestCount) {
      best = id;
      bestCount = count;
    }
  }
  return best;
}

export function extractPlaceNameFromHtml(html: string, placeId: string): string {
  if (!placeId) return '';
  const escapedId = placeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const q = '\\\\?"';
  const re = new RegExp(`${q}${escapedId}${q},${q}((?:[^"\\\\]|\\\\.)*?)${q}`, 'i');
  const match = re.exec(html);
  if (!match) return '';
  try {
    return (JSON.parse(`"${match[1]}"`) as string).trim();
  } catch {
    return match[1].trim();
  }
}

export function buildBoqUrl(placeId: string, sort: MapReviewSort, hl: string, pageToken = ''): string {
  const sortOrder = SORT_ORDER[sort];
  const request = pageToken
    ? [null, sortOrder, null, null, null, null, null, null, null, null, null, [placeId], null, null, null, null, null, null, null, pageToken]
    : [null, sortOrder, null, null, null, null, null, null, null, PAGE_SIZE, null, [placeId]];
  const reqpld = [null, [null, null, null, null, null, null, null, null, null, request]];
  return `${BOQ_ENDPOINT}?msc=gwsrpc&reqpld=${encodeURIComponent(JSON.stringify(reqpld))}&hl=${encodeURIComponent(hl)}`;
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function getPath(node: unknown, path: number[]): unknown {
  let cur = node;
  for (const idx of path) {
    if (!Array.isArray(cur)) return undefined;
    cur = cur[idx];
  }
  return cur;
}

function isLocaleTag(value: string): boolean {
  return /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(value);
}

function extractReviewText(review: unknown[]): string {
  let googleIdx = -1;
  for (let i = review.length - 1; i >= 0; i--) {
    const el = review[i];
    if (Array.isArray(el) && el[0] === 'Google') {
      googleIdx = i;
      break;
    }
  }
  const end = googleIdx === -1 ? review.length : googleIdx;

  let best = '';
  for (let i = 6; i < end; i++) {
    const el = review[i];
    if (typeof el !== 'string') continue;
    if (el.startsWith('http') || el.startsWith('//')) continue;
    if (isLocaleTag(el)) continue;
    if (el.length > best.length) best = el;
  }
  return best;
}

interface ParsedReview extends MapReview {
  id: string;
  publishedMs: number;
}

export function parseReviewNode(node: unknown): ParsedReview | null {
  if (!Array.isArray(node) || node.length < 6) return null;
  const rating = typeof node[1] === 'number' ? node[1] : 0;
  const publishedRaw = getPath(node, [2, 2]);
  const publishedNum = typeof publishedRaw === 'string' || typeof publishedRaw === 'number' ? Number(publishedRaw) : NaN;
  const publishedMs = Number.isFinite(publishedNum) && publishedNum > 0 ? publishedNum : 0;
  const authorRaw = getPath(node, [3, 0]);
  const author = typeof authorRaw === 'string' ? authorRaw : '';
  const replyRaw = getPath(node, [4, 2]);
  const reply = typeof replyRaw === 'string' ? stripHtml(replyRaw) : '';
  const idRaw = node[5];
  const id = typeof idRaw === 'string' && idRaw ? idRaw : `${author}#${publishedMs}`;
  const text = stripHtml(extractReviewText(node));
  if (!rating && !text) return null;
  return {
    id,
    publishedMs,
    author,
    rating,
    date: publishedMs > 0 ? new Date(publishedMs).toISOString().slice(0, 10) : '',
    text,
    reply,
  };
}

interface ReviewPage {
  reviews: unknown[];
  nextToken: string;
}

export function parseBoqResponse(body: string): ReviewPage {
  const idx = body.indexOf(")]}'");
  const raw = idx === -1 ? body : body.slice(idx + 4);
  const data: unknown = JSON.parse(raw);
  const node = getPath(data, [1, 10]);
  if (!Array.isArray(node)) return { reviews: [], nextToken: '' };
  const reviews = Array.isArray(node[2]) ? node[2] : [];
  const nextToken = typeof node[6] === 'string' ? node[6] : '';
  return { reviews, nextToken };
}

async function fetchReviewPage(placeId: string, sort: MapReviewSort, hl: string, pageToken: string): Promise<ReviewPage> {
  const res = await fetch(buildBoqUrl(placeId, sort, hl, pageToken), {
    headers: FETCH_HEADERS,
    signal: AbortSignal.timeout(PER_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`BOQ endpoint returned HTTP ${res.status}`);
  return parseBoqResponse(await res.text());
}

async function fetchSortedReviews(placeId: string, sort: MapReviewSort, hl: string, max: number): Promise<ParsedReview[]> {
  const out: ParsedReview[] = [];
  let token = '';
  while (out.length < max) {
    const page = await fetchReviewPage(placeId, sort, hl, token);
    for (const node of page.reviews) {
      const parsed = parseReviewNode(node);
      if (parsed) out.push(parsed);
    }
    if (page.reviews.length === 0 || !page.nextToken || page.nextToken === token) break;
    token = page.nextToken;
  }
  return out.slice(0, max);
}

export function mergeMixedReviews(batches: ParsedReview[][], count: number): ParsedReview[] {
  const byId = new Map<string, ParsedReview>();
  for (const batch of batches) {
    for (const review of batch) {
      if (!byId.has(review.id)) byId.set(review.id, review);
    }
  }
  return [...byId.values()]
    .sort((a, b) => b.publishedMs - a.publishedMs)
    .slice(0, count);
}

function toMapReview({ author, rating, date, text, reply }: ParsedReview): MapReview {
  return { author, rating, date, text, reply };
}

export async function fetchMapReviews(
  url: string,
  opts: { sort: MapReviewSort | 'mixed'; count: number; hl: string; onLog?: (message: string) => void },
): Promise<MapReviewsResult> {
  const log = opts.onLog ?? (() => {});
  const resolved = await resolveMapsUrl(url);
  let placeId = extractPlaceId(resolved);
  let place = extractPlaceName(resolved);
  if (!placeId) {
    log('no place ID in the URL — reading it from the map page');
    const html = await fetchMapsPageHtml(resolved);
    placeId = extractPlaceIdFromHtml(html);
    if (!place) place = extractPlaceNameFromHtml(html, placeId);
  }
  if (!placeId) {
    throw new Error('could not find a place in the link — share a specific place from Google Maps (open the place, tap Share), not a plain search or map view');
  }
  log(`place "${place || placeId}" (sort=${opts.sort}, target ${opts.count})`);

  if (opts.sort !== 'mixed') {
    const reviews = await fetchSortedReviews(placeId, opts.sort, opts.hl, opts.count);
    return { place, reviews: reviews.map(toMapReview), placeUrl: resolved };
  }

  const targets: [MapReviewSort, number][] = [
    ['newest', Math.ceil(opts.count / 2)],
    ['lowest', Math.ceil(opts.count / 4)],
    ['highest', Math.ceil(opts.count / 4)],
  ];
  const settled = await Promise.allSettled(
    targets.map(([sort, max]) => fetchSortedReviews(placeId, sort, opts.hl, max)),
  );
  const batches: ParsedReview[][] = [];
  settled.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      batches.push(result.value);
    } else {
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      log(`sort "${targets[i][0]}" failed (${reason}) — continuing with the rest`);
    }
  });
  if (batches.length === 0) throw new Error('all review fetches failed');
  return { place, reviews: mergeMixedReviews(batches, opts.count).map(toMapReview), placeUrl: resolved };
}
