/**
 * Where a Google News link points. The id is opaque since 2024, so the only way to the address is
 * what Google's own page does: read the signature it carries, then ask its `garturlreq` call.
 * About 0.4 s a link, and a 429 after about 115 requests in a minute, so links
 * are paced, remembered, and left alone for a while once Google refuses.
 *
 * Nothing here is a published API. Every shape it cannot read is `GoogleNewsLinkError('changed')`,
 * for the caller to report; the release self-test is what notices a change.
 */
import { createEngineGate, EngineBusyError, retryAfterMs, SerpChallengeError, type EngineGate } from '../search/engines/gate';

const ARTICLE_PAGE = 'https://news.google.com/articles/';
const REGION_QUERY = 'hl=zh-TW&gl=TW&ceid=TW:zh-Hant';
const BATCH_URL = 'https://news.google.com/_/DotsSplashUi/data/batchexecute';
const BATCH_METHOD = 'Fbv4je';
const FORM_TYPE = 'application/x-www-form-urlencoded;charset=UTF-8';
/** Links read in one session repeat: a feed step, a follow-up question. */
const REMEMBERED_MAX = 500;

/** One link is two requests, so this holds it near one request a second. */
const LINK_GATE = {
  engine: 'Google News',
  concurrency: 1,
  burst: 3,
  refillMs: 2_000,
  cooldownMs: 10 * 60_000,
  maxWaitMs: 30_000,
} as const;

export type GoogleNewsLinkFailure = 'busy' | 'changed' | 'missing';

export class GoogleNewsLinkError extends Error {
  constructor(readonly reason: GoogleNewsLinkFailure, message: string) {
    super(message);
    this.name = 'GoogleNewsLinkError';
  }
}

export interface GoogleAnswer {
  status: number;
  text: string;
  finalUrl: string;
  headers?: Readonly<Record<string, string>>;
}

export type GoogleFetch = (
  url: string,
  options: { post?: { contentType: string; body: string }; signal?: AbortSignal },
) => Promise<GoogleAnswer>;

/** The signature and timestamp the article page carries for its own `garturlreq`. */
export function readLinkSignature(html: string): { signature: string; timestamp: number } | null {
  const signature = /data-n-a-sg="([^"]+)"/.exec(html)?.[1];
  const timestamp = Number(/data-n-a-ts="(\d+)"/.exec(html)?.[1]);
  return signature && Number.isFinite(timestamp) ? { signature, timestamp } : null;
}

/** The `f.req` form the page itself sends, with its placeholder fields. */
export function batchRequestBody(id: string, signature: string, timestamp: number): string {
  const context = [['X', 'X', ['X', 'X'], null, null, 1, 1, 'TW:zh-Hant', null, 1, null, null, null, null, null, 0, 1], 'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0];
  const call = JSON.stringify(['garturlreq', context, id, timestamp, signature]);
  return new URLSearchParams({ 'f.req': JSON.stringify([[[BATCH_METHOD, call, null, 'generic']]]) }).toString();
}

function isWebAddress(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

/** The article address in a batch answer, or null when it holds none. Never throws. */
export function readBatchAnswer(text: string): string | null {
  for (const line of text.split('\n')) {
    if (!line.startsWith('[')) continue;
    try {
      const rows: unknown = JSON.parse(line);
      if (!Array.isArray(rows)) continue;
      for (const row of rows as unknown[]) {
        if (!Array.isArray(row) || row[0] !== 'wrb.fr' || row[1] !== BATCH_METHOD || typeof row[2] !== 'string') continue;
        const answer: unknown = JSON.parse(row[2]);
        if (Array.isArray(answer) && answer[0] === 'garturlres' && isWebAddress(answer[1])) return answer[1];
      }
    } catch {
      // A line that is not this JSON: not the one that carries the address.
    }
  }
  return null;
}

function isRefusal(answer: GoogleAnswer): boolean {
  return answer.status === 429 || /\/sorry\//.test(answer.finalUrl);
}

/** Turns a link id into its article address: paced, remembered, quiet after a refusal. */
export function createGoogleNewsResolver(
  fetchPage: GoogleFetch,
  gate: EngineGate = createEngineGate(LINK_GATE),
): (id: string, signal?: AbortSignal) => Promise<string> {
  const remembered = new Map<string, string>();

  const ask = async (url: string, options: Parameters<GoogleFetch>[1]): Promise<GoogleAnswer> => {
    const answer = await fetchPage(url, options);
    if (isRefusal(answer)) {
      gate.block(retryAfterMs(answer.headers?.['retry-after']));
      throw new GoogleNewsLinkError('busy', 'Google News is refusing requests from this address for now');
    }
    return answer;
  };

  const resolve = async (id: string, signal?: AbortSignal): Promise<string> => {
    const page = await ask(`${ARTICLE_PAGE}${id}?${REGION_QUERY}`, { signal });
    if (page.status === 404 || page.status === 410) throw new GoogleNewsLinkError('missing', 'Google News no longer has this link');
    const found = page.status < 400 ? readLinkSignature(page.text) : null;
    if (!found) throw new GoogleNewsLinkError('changed', `Google News article page answered ${page.status} without its signature`);
    const answer = await ask(BATCH_URL, {
      post: { contentType: FORM_TYPE, body: batchRequestBody(id, found.signature, found.timestamp) },
      signal,
    });
    const address = readBatchAnswer(answer.text);
    if (!address) throw new GoogleNewsLinkError('changed', `Google News answered ${answer.status} without an address`);
    gate.answered();
    return address;
  };

  return async (id, signal) => {
    const known = remembered.get(id);
    if (known) return known;
    let address: string;
    try {
      address = await gate.run(() => resolve(id, signal));
    } catch (err) {
      if (err instanceof SerpChallengeError || err instanceof EngineBusyError) {
        throw new GoogleNewsLinkError('busy', 'Google News is pacing or refusing requests for now');
      }
      throw err;
    }
    if (remembered.size >= REMEMBERED_MAX) remembered.delete(remembered.keys().next().value as string);
    remembered.set(id, address);
    return address;
  };
}
