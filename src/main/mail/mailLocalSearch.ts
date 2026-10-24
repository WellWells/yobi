/**
 * Yobi's own search for the text terms a server would not match. Outlook.com / Exchange answer a
 * UTF-8 IMAP SEARCH with nothing (2026-10-23: a draft saved with the Chinese subject 「JLCPCB 專案進度
 * 回報」 was in Drafts, yet searching Drafts for that subject found none), so a non-ASCII query that
 * finds nothing is checked here against the newest messages: sender, recipients and subject from
 * the headers already fetched, the body only for the newest few, since each needs a download.
 */
import type { RawMessage } from './mailBackend';
import { formatAddresses } from './mailMessage';
import type { LocalTerms } from './mailQuery';

/** Newest messages checked by headers when the server could not search the text itself. */
export const LOCAL_SCAN_MAX = 300;
/** Of those, how many may be downloaded to look for a word in the body. */
export const LOCAL_BODY_SCAN_MAX = 40;

function contains(haystack: string, needle: string): boolean {
  return haystack.normalize('NFKC').toLowerCase().includes(needle.normalize('NFKC').toLowerCase());
}

/**
 * `false` when the headers rule the message out, `true` when they match everything, else the words
 * that only the body can still match.
 */
export function matchHeaders(message: RawMessage, terms: LocalTerms): boolean | string[] {
  const from = formatAddresses(message.from);
  const to = formatAddresses(message.to);
  const subject = message.subject ?? '';
  if (!terms.from.every((term) => contains(from, term))) return false;
  if (!terms.to.every((term) => contains(to, term))) return false;
  if (!terms.subject.every((term) => contains(subject, term))) return false;
  const headerText = `${from}\n${to}\n${subject}`;
  const rest = terms.words.filter((word) => !contains(headerText, word));
  return rest.length === 0 ? true : rest;
}

export function bodyMatches(text: string, words: readonly string[]): boolean {
  return words.every((word) => contains(text, word));
}

/**
 * The UIDs among `candidates` (newest first) that match, reading at most `LOCAL_BODY_SCAN_MAX`
 * bodies. `complete` is false when a body that might have matched was left unread.
 */
export async function localSearch(
  candidates: readonly RawMessage[],
  terms: LocalTerms,
  bodyText: (uid: number) => Promise<string>,
): Promise<{ uids: number[]; complete: boolean }> {
  const uids: number[] = [];
  let bodiesRead = 0;
  let complete = true;
  for (const message of candidates) {
    const headers = matchHeaders(message, terms);
    if (headers === false) continue;
    if (headers === true) {
      uids.push(message.uid);
      continue;
    }
    if (bodiesRead >= LOCAL_BODY_SCAN_MAX) {
      complete = false;
      continue;
    }
    bodiesRead++;
    if (bodyMatches(await bodyText(message.uid).catch(() => ''), headers)) uids.push(message.uid);
  }
  return { uids, complete };
}
