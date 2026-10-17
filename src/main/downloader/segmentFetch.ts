import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { streamRequest } from './streamFetch';
import type { StreamRequestOptions } from './streamFetch';
import { StreamHttpError, StreamRefusedError, StreamTooLargeError, streamAbortError } from './streamTypes';
import type { FetchLimit, SegmentPlan, SegmentRef } from './streamTypes';

/*
 * Fetching a `SegmentPlan` into one file: a few segments in flight at once but written in order,
 * each retried on its own, the whole stopped by the step's Stop. A plan of one whole file (a
 * progressive mp4 or mp3) is streamed to disk instead, resuming with a Range after a dropped
 * connection. Everything goes to a hidden temporary file next to `file`, renamed only once
 * complete; on failure or Stop the partial file is deleted.
 *
 * A `ByteBudget` counts every byte received across the whole download against its `FetchLimit`,
 * since a playlist's declared sizes cannot be trusted, and stops the download the moment it is passed.
 */

/** The bytes a download has received, held to its limit; shared by every request of the download. */
export interface ByteBudget {
  /** Counts `n` more bytes received; past the limit throws `StreamTooLargeError` (and aborts `signal`). */
  take: (n: number) => void;
  /** Aborted once the limit is passed, so requests waiting on other segments end too. */
  signal: AbortSignal;
  /** The error the limit was passed with; null while within it. */
  overrun: () => StreamTooLargeError | null;
}

export function byteBudget(limit: FetchLimit): ByteBudget {
  const controller = new AbortController();
  let received = 0;
  let over: StreamTooLargeError | null = null;
  return {
    take: (n) => {
      received += n;
      if (received <= limit.bytes) return;
      over ??= new StreamTooLargeError(limit, received);
      controller.abort(over);
      throw over;
    },
    signal: controller.signal,
    overrun: () => over,
  };
}

export interface SegmentFetchOptions extends StreamRequestOptions {
  /** The site's name, for the Stop error (`Vimeo download stopped`). */
  label: string;
  /** Segments in flight (and held in memory) at once; 4 by default. */
  concurrency?: number;
  /** Further attempts per segment after the first; 3 by default. */
  retries?: number;
  /** The wait before attempt n+1 is n times this; 1 s by default. */
  retryDelayMs?: number;
  /** New bytes arrived; a retried segment does not count its bytes twice. */
  onBytes?: (added: number) => void;
  /** Every byte received counts against it, retries included; the download stops past its limit. */
  budget?: ByteBudget;
}

/** A download is given up when no byte arrives for this long, however long the whole file takes. */
export const STALL_TIMEOUT_MS = 30_000;
/**
 * One HLS or DASH segment is seconds of media, held whole in memory until its turn to be written
 * (up to `concurrency` of them at once): 10 s of 4K at 50 Mbit/s is about 62 MB, so anything
 * larger is not a segment. Bounds what a download holds in memory to concurrency × this.
 */
export const MAX_SEGMENT_BYTES = 64_000_000;

/** Network failures, timeouts, 5xx, 408 and 429 are worth another try; a refused URL, a 403/404 or a passed limit is not. */
export function isRetryable(err: unknown): boolean {
  if (err instanceof StreamRefusedError || err instanceof StreamTooLargeError) return false;
  if (err instanceof StreamHttpError) return err.status === 0 || err.status === 408 || err.status === 429 || err.status >= 500;
  return true;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Counts bytes towards progress only past the most this piece has reached on any attempt. */
function counter(onBytes: ((added: number) => void) | undefined): { reset: () => void; add: (n: number) => void } {
  let reached = 0;
  let current = 0;
  return {
    reset: () => {
      current = 0;
    },
    add: (n) => {
      current += n;
      if (current > reached) {
        onBytes?.(current - reached);
        reached = current;
      }
    },
  };
}

/** The response's chunks, with the stall timer re-armed on each one. */
async function* chunksOf(response: Response, stall: { arm: () => void }): AsyncGenerator<Uint8Array> {
  if (!response.body) throw new StreamHttpError('The answer has no body', response.status);
  stall.arm();
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    stall.arm();
    yield chunk;
  }
}

function stallTimer(): { signal: AbortSignal; arm: () => void; stop: () => void } {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = (): void => clearTimeout(timer);
  return {
    signal: controller.signal,
    arm: () => {
      stop();
      timer = setTimeout(() => controller.abort(new StreamHttpError(`No data for ${STALL_TIMEOUT_MS / 1_000} s`, 0)), STALL_TIMEOUT_MS);
    },
    stop,
  };
}

/** Whether the answer is the bytes asked for: a 206 for a range (or a 200 that is exactly that range), a 200 otherwise. */
function answersRange(response: Response, ref: SegmentRef): boolean {
  if (!ref.range) return response.ok;
  if (response.status === 206) return true;
  const length = Number(response.headers.get('content-length') ?? '');
  return response.status === 200 && ref.range.offset === 0 && length === ref.range.length;
}

async function fetchSegmentOnce(ref: SegmentRef, options: SegmentFetchOptions, count: ReturnType<typeof counter>): Promise<Uint8Array> {
  const stall = stallTimer();
  try {
    const { response } = await streamRequest(ref.url, options, { ...(ref.range ? { range: ref.range } : {}), signal: stall.signal });
    if (!answersRange(response, ref)) {
      await response.body?.cancel().catch(() => {});
      throw new StreamHttpError(`HTTP ${response.status} for a segment`, response.status === 200 ? 416 : response.status);
    }
    const parts: Uint8Array[] = [];
    let size = 0;
    // A declared range is the server's word too: never more than a segment is held, whatever it says.
    const most = Math.min(ref.range?.length ?? MAX_SEGMENT_BYTES, MAX_SEGMENT_BYTES);
    count.reset();
    for await (const chunk of chunksOf(response, stall)) {
      options.budget?.take(chunk.length);
      size += chunk.length;
      if (size > most) throw new StreamHttpError('A segment is larger than announced', 0);
      parts.push(chunk);
      count.add(chunk.length);
    }
    if (ref.range && size !== ref.range.length) throw new StreamHttpError(`A segment ended at ${size} of ${ref.range.length} bytes`, 0);
    return Buffer.concat(parts);
  } finally {
    stall.stop();
  }
}

async function withRetries<T>(options: SegmentFetchOptions, attempt: () => Promise<T>): Promise<T> {
  const retries = options.retries ?? 3;
  for (let n = 0; ; n++) {
    try {
      return await attempt();
    } catch (err) {
      options.signal?.throwIfAborted();
      if (n >= retries || !isRetryable(err)) throw err;
      await wait((options.retryDelayMs ?? 1_000) * (n + 1), options.signal);
    }
  }
}

/** Segments `concurrency` at a time, appended to `handle` strictly in order. */
async function fetchOrdered(plan: SegmentPlan, handle: fs.FileHandle, options: SegmentFetchOptions): Promise<number> {
  const concurrency = Math.max(1, options.concurrency ?? 4);
  // Ends the segments still in flight when one fails for good.
  const failed = new AbortController();
  const signals = [failed.signal, ...(options.signal ? [options.signal] : []), ...(options.budget ? [options.budget.signal] : [])];
  const inner: SegmentFetchOptions = { ...options, signal: AbortSignal.any(signals) };
  const inflight: Array<Promise<Uint8Array>> = [];
  let started = 0;
  const start = (): void => {
    const ref = plan.segments[started++];
    const count = counter(options.onBytes);
    const pending = withRetries(inner, () => fetchSegmentOnce(ref, inner, count));
    pending.catch(() => {});
    inflight.push(pending);
  };
  let written = 0;
  try {
    while (started < plan.segments.length && inflight.length < concurrency) start();
    while (inflight.length > 0) {
      const data = await (inflight.shift() as Promise<Uint8Array>);
      await handle.write(data);
      written += data.length;
      if (started < plan.segments.length) start();
    }
    return written;
  } finally {
    failed.abort();
  }
}

/** One whole file streamed to `handle`; a dropped connection resumes with a Range when the server allows it. */
async function fetchWhole(ref: SegmentRef, handle: fs.FileHandle, options: SegmentFetchOptions): Promise<number> {
  const count = counter(options.onBytes);
  let written = 0;
  await withRetries(options, async () => {
    const stall = stallTimer();
    try {
      const { response } = await streamRequest(ref.url, options, { ...(written > 0 ? { range: { offset: written } } : {}), signal: stall.signal });
      const resumed = written > 0 && response.status === 206 && (response.headers.get('content-range') ?? '').startsWith(`bytes ${written}-`);
      if (!resumed) {
        if (!response.ok || response.status === 206) {
          await response.body?.cancel().catch(() => {});
          throw new StreamHttpError(`HTTP ${response.status} for the file`, response.status);
        }
        // A fresh start: the server ignored the range, or this is the first attempt.
        await handle.truncate(0);
        written = 0;
        count.reset();
      }
      for await (const chunk of chunksOf(response, stall)) {
        options.budget?.take(chunk.length);
        await handle.write(chunk, 0, chunk.length, written);
        written += chunk.length;
        count.add(chunk.length);
      }
    } finally {
      stall.stop();
    }
  });
  return written;
}

/**
 * Fetches `plan` into `file` (a name in the job folder) and returns its size. Throws
 * `StreamHttpError` / `StreamRefusedError` for a failure retries did not heal, `StreamTooLargeError`
 * once `options.budget` is passed, and an error named AbortError on Stop; either way no partial
 * file is left.
 */
export async function fetchPlanToFile(plan: SegmentPlan, file: string, options: SegmentFetchOptions): Promise<number> {
  if (plan.segments.length === 0) throw new StreamHttpError('Nothing to download', 0);
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.part`);
  const handle = await fs.open(temp, 'w');
  let closed = false;
  try {
    const whole = plan.segments.length === 1 && !plan.segments[0].range;
    const size = whole ? await fetchWhole(plan.segments[0], handle, options) : await fetchOrdered(plan, handle, options);
    await handle.close();
    closed = true;
    await fs.rename(temp, file);
    return size;
  } catch (err) {
    if (!closed) await handle.close().catch(() => {});
    await fs.rm(temp, { force: true }).catch(() => {});
    if (options.signal?.aborted) throw streamAbortError(options.label);
    // The segment that passed the limit may not be the one awaited: its neighbours end as aborts.
    throw options.budget?.overrun() ?? err;
  }
}
