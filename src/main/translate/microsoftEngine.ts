/**
 * Microsoft's keyless translation endpoint. It is not a published API, so an answer of any other
 * shape is a failure, never a guess.
 */
import type { EngineLanguage } from './engineLanguages';

export type TranslateFetch = (url: string, init: RequestInit) => Promise<Response>;

const MICROSOFT_URL = 'https://edge.microsoft.com/translate/translatetext';
const REQUEST_TIMEOUT_MS = 30_000;

// Well inside what one request accepts (200 lines of 40 characters went through).
export const MAX_BATCH_LINES = 100;
export const MAX_BATCH_CHARS = 5_000;

export class EngineFailure extends Error {
  /** `retry` is set when the same request may work a moment later. */
  constructor(message: string, readonly retry: { afterMs?: number } | null = null) {
    super(message);
    this.name = 'EngineFailure';
  }
}

function retryAfterMs(res: Response): number | undefined {
  const seconds = Number(res.headers.get('retry-after') ?? Number.NaN);
  return Number.isFinite(seconds) ? seconds * 1_000 : undefined;
}

function connectionDetail(err: unknown): string {
  const code = (err as { cause?: { code?: unknown } })?.cause?.code;
  return typeof code === 'string' ? `Could not connect to Microsoft (${code})` : 'Could not connect to Microsoft';
}

async function postLines(fetchFn: TranslateFetch, url: string, lines: readonly string[], signal?: AbortSignal): Promise<unknown> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lines),
      redirect: 'manual',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (err) {
    signal?.throwIfAborted();
    throw new EngineFailure(connectionDetail(err), {});
  }
  if (res.status >= 300 && res.status < 400) throw new EngineFailure(`Microsoft refused this address for now (redirect ${res.status})`);
  if (res.status === 429 || res.status >= 500) throw new EngineFailure(`Microsoft answered ${res.status}`, { afterMs: retryAfterMs(res) });
  if (!res.ok) throw new EngineFailure(`Microsoft answered ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new EngineFailure('Microsoft answered something other than JSON');
  }
}

/** One request. The lines go as an array and come back as one, so no separator can be lost. */
export async function translateBatch(fetchFn: TranslateFetch, lines: readonly string[], to: EngineLanguage, from: EngineLanguage | null, signal?: AbortSignal): Promise<string[]> {
  const query = new URLSearchParams({ from: from?.code ?? '', to: to.code, isEnterpriseClient: 'false' });
  const body = await postLines(fetchFn, `${MICROSOFT_URL}?${query}`, lines, signal);
  if (!Array.isArray(body) || body.length !== lines.length) throw new EngineFailure(`Microsoft answered ${Array.isArray(body) ? body.length : 'no'} lines for ${lines.length}`);
  return body.map((item) => {
    const text = (item as { translations?: { text?: unknown }[] } | null)?.translations?.[0]?.text;
    if (typeof text !== 'string') throw new EngineFailure('Microsoft answered a line with no translation');
    return text;
  });
}
