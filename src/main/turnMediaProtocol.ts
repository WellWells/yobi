import { protocol } from 'electron';
import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import { Readable } from 'node:stream';
import { TURN_MEDIA_SCHEME, turnMediaMimeType, turnMediaPath } from '../shared/turnMedia';

/**
 * Serves the photos, videos and audio a turn saved (`shared/turnMedia.ts`). Only regular files that
 * are one of those by extension; nothing else on the disk is reachable through it. Answers range
 * requests, which a `<video>` or `<audio>` needs to start and seek.
 */

/**
 * Before the app is ready: `stream` is what lets a `<video>` play from a custom scheme, and
 * `standard` gives it a real origin — Chromium's media cache refuses a later range request (play
 * after idling, a seek past the buffer) whose origin differs from the first, and a non-standard
 * scheme's opaque origin never equals another.
 */
export function registerTurnMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: TURN_MEDIA_SCHEME, privileges: { standard: true, stream: true } }]);
}

export function handleTurnMediaScheme(): void {
  protocol.handle(TURN_MEDIA_SCHEME, (request) => serveTurnMedia(request.url, request.headers.get('range')));
}

/** The bytes a `Range` header asks for, null when it asks for the whole file, 'invalid' when it cannot be met. */
export function parseByteRange(header: string | null, size: number): { start: number; end: number } | null | 'invalid' {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return 'invalid';
  let start: number;
  let end: number;
  if (!match[1]) {
    // A suffix: the last N bytes.
    const suffix = Number(match[2]);
    if (suffix === 0) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  if (start >= size || start > end) return 'invalid';
  return { start, end };
}

export async function serveTurnMedia(url: string, rangeHeader: string | null): Promise<Response> {
  const filePath = turnMediaPath(url);
  if (!filePath) return new Response(null, { status: 404 });
  let size: number;
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return new Response(null, { status: 404 });
    size = stat.size;
  } catch {
    return new Response(null, { status: 404 });
  }
  const headers: Record<string, string> = { 'Content-Type': turnMediaMimeType(filePath), 'Accept-Ranges': 'bytes' };
  if (size === 0) return new Response(null, { status: 200, headers: { ...headers, 'Content-Length': '0' } });
  const range = parseByteRange(rangeHeader, size);
  if (range === 'invalid') {
    return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
  }
  const { start, end } = range ?? { start: 0, end: size - 1 };
  const body = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream<Uint8Array>;
  return new Response(body, {
    status: range ? 206 : 200,
    headers: {
      ...headers,
      'Content-Length': String(end - start + 1),
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
    },
  });
}
