import { net } from 'electron';
import { createWriteStream } from 'node:fs';
import { PassThrough, Transform } from 'node:stream';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/*
 * Downloads for the tool installer through Electron's `net`, which follows redirects and uses the
 * system proxy. Every response is capped (a server announcing or sending more is cut off) and a
 * stalled transfer gives up after a minute without data.
 */

export interface FetchedBytes {
  body: Buffer;
  /** The request URL followed by every redirect target, in order. */
  urls: string[];
}

export interface FetchedFile {
  bytes: number;
  urls: string[];
}

export interface ToolFetcher {
  fetchBytes(url: string, maxBytes: number): Promise<FetchedBytes>;
  fetchToFile(
    url: string,
    dest: string,
    options: { maxBytes: number; onProgress?: (receivedBytes: number, totalBytes: number) => void },
  ): Promise<FetchedFile>;
}

const IDLE_TIMEOUT_MS = 60_000;

type Response = Electron.IncomingMessage;

function openResponse(url: string, maxBytes: number): Promise<{ response: Response; urls: string[]; abort: () => void }> {
  return new Promise((resolve, reject) => {
    const urls = [url];
    const request = net.request({ url, redirect: 'follow' });
    request.on('redirect', (_status: number, _method: string, newUrl: string) => {
      urls.push(newUrl);
    });
    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        request.abort();
        reject(new Error(`HTTP ${response.statusCode} for ${url}`));
        return;
      }
      const announced = Number(response.headers['content-length']);
      if (Number.isFinite(announced) && announced > maxBytes) {
        request.abort();
        reject(new Error(`${url} is ${announced} bytes, over the ${maxBytes}-byte cap`));
        return;
      }
      resolve({ response, urls, abort: () => request.abort() });
    });
    request.on('error', reject);
    request.end();
  });
}

/** Electron's response is an event emitter, not a Node stream; this bridges the two. */
function bodyStream(response: Response): Readable {
  const stream = new PassThrough();
  response.on('data', (chunk: Buffer) => stream.write(chunk));
  response.on('end', () => stream.end());
  response.on('aborted', () => stream.destroy(new Error('the download was aborted')));
  response.on('error', (err: Error) => stream.destroy(err));
  return stream;
}

/** Counts bytes, enforces the cap, and fails a transfer that goes quiet. */
function meter(url: string, maxBytes: number, abort: () => void, onBytes?: (received: number) => void): Transform {
  let received = 0;
  let idle: NodeJS.Timeout | null = null;
  const stream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      arm();
      if (received > maxBytes) {
        abort();
        callback(new Error(`${url} sent more than ${maxBytes} bytes`));
        return;
      }
      onBytes?.(received);
      callback(null, chunk);
    },
    flush(callback) {
      if (idle) clearTimeout(idle);
      callback();
    },
  });
  function arm(): void {
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => {
      abort();
      stream.destroy(new Error(`${url} stalled for ${IDLE_TIMEOUT_MS / 1000} s`));
    }, IDLE_TIMEOUT_MS);
  }
  stream.on('close', () => {
    if (idle) clearTimeout(idle);
  });
  arm();
  return stream;
}

async function fetchBytes(url: string, maxBytes: number): Promise<FetchedBytes> {
  const { response, urls, abort } = await openResponse(url, maxBytes);
  const chunks: Buffer[] = [];
  await pipeline(bodyStream(response), meter(url, maxBytes, abort), async (source: AsyncIterable<Buffer>) => {
    for await (const chunk of source) chunks.push(chunk);
  });
  return { body: Buffer.concat(chunks), urls };
}

async function fetchToFile(
  url: string,
  dest: string,
  options: { maxBytes: number; onProgress?: (receivedBytes: number, totalBytes: number) => void },
): Promise<FetchedFile> {
  const { response, urls, abort } = await openResponse(url, options.maxBytes);
  const announced = Number(response.headers['content-length']);
  const total = Number.isFinite(announced) && announced > 0 ? announced : 0;
  let bytes = 0;
  await pipeline(
    bodyStream(response),
    meter(url, options.maxBytes, abort, (received) => {
      bytes = received;
      options.onProgress?.(received, total);
    }),
    createWriteStream(dest),
  );
  return { bytes, urls };
}

export const electronToolFetcher: ToolFetcher = { fetchBytes, fetchToFile };
