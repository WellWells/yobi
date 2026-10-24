import { parseInvoiceFeed } from './invoice';
import type { InvoiceDraw } from './invoice';

/** The Ministry of Finance's winning-numbers feed: the last six periods, keyless. */
export const INVOICE_FEED_URL = 'https://invoice.etax.nat.gov.tw/invoice.xml';

/** A published period never changes; an hour only delays seeing a new draw on draw day. */
export const INVOICE_CACHE_MS = 3_600_000;

const MAX_FEED_TIMEOUT_MS = 20_000;

let cached: { at: number; draws: InvoiceDraw[] } | null = null;
let inflight: Promise<InvoiceDraw[]> | null = null;

export type FeedFetch = (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

async function download(fetchFn: FeedFetch, timeoutMs: number): Promise<InvoiceDraw[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, Math.min(timeoutMs, MAX_FEED_TIMEOUT_MS)));
  try {
    const res = await fetchFn(INVOICE_FEED_URL, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const draws = parseInvoiceFeed(await res.text());
    if (draws.length === 0) throw new Error('the feed listed no complete period');
    return draws;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw new Error('request timed out');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** The drawn periods, newest first; concurrent callers share one request. Throws when unreadable. */
export async function loadInvoiceDraws(timeoutMs: number, now = Date.now(), fetchFn: FeedFetch = fetch): Promise<InvoiceDraw[]> {
  if (cached && now - cached.at < INVOICE_CACHE_MS) return cached.draws;
  inflight ??= download(fetchFn, timeoutMs)
    .then((draws) => {
      cached = { at: now, draws };
      return draws;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function clearInvoiceCache(): void {
  cached = null;
}
