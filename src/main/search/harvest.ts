import { lookup } from 'node:dns/promises';
import { fetchRawText, loadPageHtml } from '../pageLoader';
import { CLEAN_UA } from '../userAgent';
import { parseHtml } from '../urlParser';
import { extractPublishedAt } from './publishedAt';
import { searchRenderLane } from './renderLane';
import { sendLog } from '../helpers';
import type { SerpHit, SourceDoc } from './types';

export const DEFAULT_MAX_SOURCES = 3;
export const HARVEST_SPARE_TARGETS = 3;
const MAX_PER_HOST = 2;
const MIN_TEXT_CHARS = 400;
const PER_PAGE_TIMEOUT_MS = 35_000;

const SKIPPED_EXTENSIONS = /\.(pdf|zip|rar|7z|exe|dmg|pkg|iso|jpe?g|png|gif|webp|svg|mp3|mp4|webm|mov|avi)$/i;

export function selectTargets(hits: SerpHit[], limit: number): SerpHit[] {
  return dedupeHits(hits).slice(0, limit);
}

/**
 * `onDoc` receives each page the moment it lands, not when its wave settles. That is what
 * lets the BYOK summariser run underneath the remaining fetches instead of after all of
 * them; a wave is only as fast as its slowest page, and on a 12-source run that was twelve
 * seconds of the summariser sitting idle. The consequence is that ids are handed out in
 * completion order rather than in rank order — every stage downstream renumbers, and
 * `rankSourcesScored` re-sorts, so nothing depends on the old ordering.
 */
export async function harvest(
  targets: SerpHit[],
  maxSources: number = DEFAULT_MAX_SOURCES,
  onRead?: (url: string) => void,
  onDoc?: (doc: SourceDoc) => void,
): Promise<SourceDoc[]> {
  const docs: SourceDoc[] = [];
  let cursor = 0;
  while (docs.length < maxSources && cursor < targets.length) {
    const wave = targets.slice(cursor, cursor + (maxSources - docs.length));
    cursor += wave.length;
    if (docs.length > 0 || cursor > wave.length) {
      sendLog(`🔎 [Search] refilling ${wave.length} source(s) from spare results...`);
    }
    await Promise.all(wave.map(async (hit) => {
      const controller = new AbortController();
      try {
        const value = await withTimeout(
          fetchClean(hit, controller.signal),
          PER_PAGE_TIMEOUT_MS,
          () => controller.abort(),
        );
        const doc: SourceDoc = { ...value, id: docs.length + 1 };
        docs.push(doc);
        onRead?.(hit.url);
        sendLog(`🔎 [Search] ✓ ${hit.url} (${value.text.length} chars)`);
        onDoc?.(doc);
      } catch (err) {
        sendLog(`🔎 [Search] ✗ ${hit.url} — ${err instanceof Error ? err.message : String(err)}`);
      }
    }));
  }
  return docs;
}

function dedupeHits(hits: SerpHit[]): SerpHit[] {
  const seenUrls = new Set<string>();
  const hostCounts = new Map<string, number>();
  const unique: SerpHit[] = [];
  for (const hit of hits) {
    let parsed: URL;
    try {
      parsed = new URL(hit.url);
    } catch {
      continue;
    }
    if (SKIPPED_EXTENSIONS.test(parsed.pathname)) continue;
    parsed.hash = '';
    const key = parsed.href;
    if (seenUrls.has(key)) continue;
    const host = parsed.hostname.toLowerCase();
    const count = hostCounts.get(host) ?? 0;
    if (count >= MAX_PER_HOST) continue;
    seenUrls.add(key);
    hostCounts.set(host, count + 1);
    unique.push(hit.snippet ? { title: hit.title, url: key, snippet: hit.snippet } : { title: hit.title, url: key });
  }
  return unique;
}

async function fetchClean(hit: SerpHit, signal: AbortSignal): Promise<Omit<SourceDoc, 'id'>> {
  assertPublicHttpUrl(hit.url);
  await assertPublicDnsResolution(new URL(hit.url).hostname.toLowerCase());

  let text = '';
  let title = hit.title;
  let publishedAt = '';
  try {
    const raw = await fetchRawText(hit.url, {
      headers: { 'User-Agent': CLEAN_UA },
      validateRedirectHost: assertPublicHost,
    });
    const parsed = parseHtml(raw, hit.url, { blockBreaks: true });
    text = parsed.cleanedText;
    if (parsed.title && parsed.title !== hit.url) title = parsed.title;
    publishedAt = extractPublishedAt(raw);
  } catch {
  }

  if (text.length < MIN_TEXT_CHARS) {
    if (signal.aborted) throw new Error('page fetch cancelled (deadline exceeded)');
    const html = await searchRenderLane.runExclusive(async () => {
      if (signal.aborted) throw new Error('page fetch cancelled (deadline exceeded)');
      return loadPageHtml(hit.url, assertPublicHost);
    });
    const rendered = parseHtml(html, hit.url, { blockBreaks: true });
    if (rendered.cleanedText.length > text.length) {
      text = rendered.cleanedText;
      if (rendered.title && rendered.title !== hit.url) title = rendered.title;
    }
    // A page whose text only appears after rendering usually did not deliver its metadata
    // in the raw response either, so this is the run that finds the date for those.
    if (!publishedAt) publishedAt = extractPublishedAt(html);
  }

  if (text.length < MIN_TEXT_CHARS) {
    throw new Error(`too little readable text (${text.length} chars)`);
  }
  return { title, url: hit.url, text, ...(publishedAt ? { publishedAt } : {}) };
}

function assertPublicHttpUrl(raw: string): void {
  const u = new URL(raw);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`blocked non-http(s) URL (${u.protocol})`);
  }
  assertPublicHost(u.hostname.toLowerCase());
}

function assertPublicHost(host: string): void {
  if (!host) throw new Error('blocked empty host');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('blocked local hostname');
  }
  if (isBlockedAddressLiteral(host)) {
    throw new Error('blocked private address');
  }
}

async function assertPublicDnsResolution(host: string): Promise<void> {
  if (host.includes(':') || /^[\d.]+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return;
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    return;
  }
  for (const { address } of addresses) {
    if (isPrivateResolvedAddress(address)) {
      throw new Error(`blocked private address (${host} resolves to ${address})`);
    }
  }
}

function isPrivateResolvedAddress(address: string): boolean {
  const addr = address.toLowerCase();
  if (!addr.includes(':')) return isBlockedAddressLiteral(addr);
  if (addr === '::1' || addr === '::') return true;
  if (/^fe[89ab]/.test(addr)) return true;
  if (/^f[cd]/.test(addr)) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  return mapped ? isBlockedAddressLiteral(mapped[1]) : false;
}

function isBlockedAddressLiteral(host: string): boolean {
  if (/^0x[0-9a-f]+$/i.test(host) || /^\d+$/.test(host)) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  return host.includes(':');
}

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      reject(new Error(`timed out after ${ms / 1_000}s`));
    }, ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}
