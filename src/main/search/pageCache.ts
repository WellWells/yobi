import { isPublicWebOnly } from '../net/publicWebScope';
import type { SourceDoc } from './types';

export type ReadPage = Omit<SourceDoc, 'id'>;

/**
 * A follow-up question reads the same pages again within a minute or two (dev log 2026-10). Kept
 * short so a flow on a frequent schedule still reads a page that changes (a status or price page),
 * and so a page that failed for a moment is tried again soon.
 */
const PAGE_TTL_MS = 5 * 60_000;

const MAX_ENTRIES = 100;

/** Cleaned text kept across all entries (a long page is tens of thousands of characters); oldest go first. */
const MAX_TOTAL_CHARS = 4_000_000;

type Entry =
  | { page: ReadPage; expiresAt: number }
  | { failure: string; expiresAt: number };

const entries = new Map<string, Entry>();
let totalChars = 0;

/**
 * A read under a chat-app message (`isPublicWebOnly`) checks every redirect hop's address; one from
 * the desktop checks only literal addresses, so a page it read may have come from the local
 * network. Each kind of read recalls only its own pages.
 */
function keyOf(url: string): string {
  return `${isPublicWebOnly() ? 'public' : 'desktop'} ${url}`;
}

/** The page as last read, or why it failed, while that is still fresh. */
export function recalledPage(url: string): Entry | undefined {
  const key = keyOf(url);
  const entry = entries.get(key);
  if (!entry) return undefined;
  forget(key);
  if (Date.now() >= entry.expiresAt) return undefined;
  remember(key, entry);
  return entry;
}

export function rememberPage(url: string, page: ReadPage): void {
  if (page.text.length > MAX_TOTAL_CHARS) return;
  remember(keyOf(url), { page, expiresAt: Date.now() + PAGE_TTL_MS });
}

export function rememberFailure(url: string, failure: string): void {
  remember(keyOf(url), { failure, expiresAt: Date.now() + PAGE_TTL_MS });
}

export function clearPageCache(): void {
  entries.clear();
  totalChars = 0;
}

function charsOf(entry: Entry): number {
  return 'page' in entry ? entry.page.text.length : 0;
}

function forget(key: string): void {
  const entry = entries.get(key);
  if (!entry) return;
  totalChars -= charsOf(entry);
  entries.delete(key);
}

function remember(key: string, entry: Entry): void {
  forget(key);
  entries.set(key, entry);
  totalChars += charsOf(entry);
  while (entries.size > MAX_ENTRIES || totalChars > MAX_TOTAL_CHARS) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    forget(oldest);
  }
}
