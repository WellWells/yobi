import { fetchRawResponse } from '../pageLoader';
import type { RawFetchResponse } from '../pageLoader';
import { userAgentForUrl } from '../userAgent';
import { MAX_CONTENT_CHARS, parseHtml } from '../urlParser';
import { extractPublishedAt, toPlausibleDate } from './publishedAt';
import { blockSignal, retryAfterMs } from '../net/hostPolicy';
import type { HostPolicy } from '../net/hostPolicy';

/**
 * Markdown first, any HTML still welcome: a site that converts for agents (Cloudflare's Markdown
 * for Agents, Vercel, docs sites) answers with the article alone; every other site ignores it.
 * The trailing any-type entry keeps Rails-style servers treating it as a browser's Accept.
 */
export const MARKDOWN_ACCEPT = 'text/markdown, text/html;q=0.9, */*;q=0.8';

export interface RawPage {
  status: number;
  text: string;
  /** The page's own title, or empty. */
  title: string;
  publishedAt: string;
  /** The raw answer carried a script: a short 404 with one may be a single-page app's route. */
  scripted: boolean;
}

const FRONTMATTER = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const DATE_KEYS = ['date', 'published', 'datePublished', 'pubDate'] as const;

function frontmatterValue(block: string, key: string): string {
  const match = new RegExp(`^${key}:[ \\t]*(.+)$`, 'm').exec(block);
  return match ? match[1].trim().replace(/^(['"])(.*)\1$/, '$2') : '';
}

/** A markdown answer as a page: its frontmatter gives the title and date, the rest is the text. */
export function markdownPage(markdown: string): Pick<RawPage, 'text' | 'title' | 'publishedAt'> {
  const front = FRONTMATTER.exec(markdown);
  const block = front?.[1] ?? '';
  const body = (front ? markdown.slice(front[0].length) : markdown).trim();
  const title = frontmatterValue(block, 'title') || (/^#[ \t]+(.+)$/m.exec(body)?.[1].trim() ?? '');
  const rawDate = DATE_KEYS.map((key) => frontmatterValue(block, key)).find(Boolean) ?? '';
  return {
    text: body.length > MAX_CONTENT_CHARS ? body.slice(0, MAX_CONTENT_CHARS) : body,
    title,
    publishedAt: rawDate ? toPlausibleDate(rawDate) : '',
  };
}

function toPage(raw: RawFetchResponse, url: string): RawPage {
  if (/^text\/markdown\b/i.test(raw.headers?.['content-type'] ?? '')) {
    return { status: raw.status, scripted: false, ...markdownPage(raw.text) };
  }
  const parsed = parseHtml(raw.text, url, { blockBreaks: true });
  return {
    status: raw.status,
    text: parsed.cleanedText,
    title: parsed.title && parsed.title !== url ? parsed.title : '',
    publishedAt: extractPublishedAt(raw.text),
    scripted: /<script\b/i.test(raw.text),
  };
}

/**
 * One raw read of a page, paced and taught by `policy`: markdown first unless the host refused it
 * before; a markdown-first request its bot wall refuses is sent again at once as a plain one (a
 * wall that has started challenging after a burst still lets that through), and what the two
 * answers say is recorded for the host.
 */
export async function readRawPage(
  url: string,
  host: string,
  policy: HostPolicy,
  validateRedirectHost: (host: string) => void,
  signal: AbortSignal,
): Promise<RawPage> {
  const send = (markdown: boolean): Promise<RawFetchResponse> => fetchRawResponse(url, {
    headers: { 'User-Agent': userAgentForUrl(url), ...(markdown ? { Accept: MARKDOWN_ACCEPT } : {}) },
    validateRedirectHost,
    signal,
    // The markdown answer must not be stored for the URL: react.dev sends it cacheable for an
    // hour without `Vary: Accept`.
    ...(markdown ? { cache: 'no-store' as const } : {}),
  });

  const markdown = policy.sendsMarkdown(host);
  await policy.waitTurn(host, signal);
  const first = await send(markdown);
  const firstBlock = blockSignal(first.status, first.headers);
  if (!firstBlock) {
    policy.record(host, { kind: 'ok' });
    return toPage(first, url);
  }
  if (!markdown) {
    policy.record(host, { kind: 'blocked', block: firstBlock, markdownOnly: false, retryAfterMs: retryAfterMs(first.headers) });
    return toPage(first, url);
  }
  const plain = await send(false);
  const plainBlock = blockSignal(plain.status, plain.headers);
  policy.record(host, plainBlock
    ? { kind: 'blocked', block: plainBlock, markdownOnly: false, retryAfterMs: retryAfterMs(plain.headers) }
    : { kind: 'blocked', block: firstBlock, markdownOnly: true });
  return toPage(plain, url);
}
