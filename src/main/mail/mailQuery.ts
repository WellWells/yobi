/**
 * The mail search query the model writes, in Gmail's own syntax. Gmail gets it verbatim (X-GM-RAW,
 * dates rewritten to the slash form it documents); any other server gets it translated into IMAP
 * SEARCH criteria. Terms are ANDed, like Gmail.
 */
import type { SearchObject } from 'imapflow';

export class MailQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailQueryError';
  }
}

export interface MailQuery {
  from: string[];
  to: string[];
  subject: string[];
  words: string[];
  unread?: boolean;
  starred?: boolean;
  /** No IMAP criterion matches attachments; the caller filters on the body structure. */
  hasAttachment?: boolean;
  since?: Date;
  before?: Date;
}

const DAY_MS = 86_400_000;
const AGE_UNIT_DAYS: Readonly<Record<string, number>> = { d: 1, w: 7, m: 30, y: 365 };

/** Splits on whitespace, keeping `"quoted phrases"` and `op:"quoted value"` whole. */
export function tokenizeMailQuery(input: string): string[] {
  const tokens: string[] = [];
  const pattern = /(\S+?:)?"([^"]*)"|\S+/g;
  for (const match of input.matchAll(pattern)) {
    tokens.push(match[2] !== undefined ? `${match[1] ?? ''}${match[2]}` : match[0]);
  }
  return tokens.filter((token) => token.length > 0);
}

function parseDay(value: string): Date {
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(value.trim());
  if (!match) throw new MailQueryError(`Dates in a mail query are YYYY-MM-DD, got "${value}"`);
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (date.getMonth() !== Number(match[2]) - 1) throw new MailQueryError(`Not a real date: "${value}"`);
  return date;
}

function parseAge(value: string, now: Date): Date {
  const match = /^(\d+)([dwmy])$/i.exec(value.trim());
  if (!match) throw new MailQueryError(`Ages in a mail query look like 7d, 2w, 3m or 1y, got "${value}"`);
  return new Date(now.getTime() - Number(match[1]) * AGE_UNIT_DAYS[match[2].toLowerCase()] * DAY_MS);
}

export function parseMailQuery(input: string, now: Date): MailQuery {
  const query: MailQuery = { from: [], to: [], subject: [], words: [] };
  for (const token of tokenizeMailQuery(input)) {
    // Gmail's OR, exclusions and grouping have no translation here; searched as words they would
    // match nothing, and an empty result reads as "no such mail".
    if (token === 'OR' || token === '|' || /^-./.test(token) || /^[({]|[)}]$/.test(token)) {
      throw new MailQueryError(`"${token}": OR, exclusions (-) and grouping work only on Gmail; search once per alternative instead`);
    }
    const colon = token.indexOf(':');
    const op = colon > 0 ? token.slice(0, colon).toLowerCase() : '';
    const value = colon > 0 ? token.slice(colon + 1) : token;
    switch (op) {
      case 'from': query.from.push(value); break;
      case 'to': query.to.push(value); break;
      case 'subject': query.subject.push(value); break;
      case 'is': {
        const flag = value.toLowerCase();
        if (flag === 'unread') query.unread = true;
        else if (flag === 'read') query.unread = false;
        else if (flag === 'starred' || flag === 'flagged') query.starred = true;
        else throw new MailQueryError(`Unsupported "is:${value}"; use is:unread, is:read or is:starred`);
        break;
      }
      case 'has':
        if (value.toLowerCase() !== 'attachment') throw new MailQueryError(`Unsupported "has:${value}"; only has:attachment works here`);
        query.hasAttachment = true;
        break;
      case 'after': case 'since': query.since = parseDay(value); break;
      case 'before': case 'until': query.before = parseDay(value); break;
      case 'newer_than': query.since = parseAge(value, now); break;
      case 'older_than': query.before = parseAge(value, now); break;
      case 'label': case 'category': case 'in':
        throw new MailQueryError(`"${op}:" works only on Gmail; pick the folder with the folder argument instead`);
      default:
        // Not an operator this translation knows ("10:30", "re:"): search for it as text.
        query.words.push(token);
    }
  }
  return query;
}

/**
 * IMAP has one value per criterion, so a repeated term (two `from:`) becomes its own search; the
 * caller intersects the results. Never empty: a blank query is `{ all: true }`.
 */
export function toImapSearches(query: MailQuery): SearchObject[] {
  const base: SearchObject = {};
  const extra: SearchObject[] = [];
  const put = (key: 'from' | 'to' | 'subject' | 'text', values: string[]): void => {
    values.forEach((value, index) => {
      if (index === 0) base[key] = value;
      else extra.push({ [key]: value });
    });
  };
  put('from', query.from);
  put('to', query.to);
  put('subject', query.subject);
  put('text', query.words);
  if (query.unread !== undefined) base.seen = !query.unread;
  if (query.starred) base.flagged = true;
  if (query.since) base.since = query.since;
  if (query.before) base.before = query.before;
  const searches = [base, ...extra];
  return Object.keys(base).length === 0 && extra.length === 0 ? [{ all: true }] : searches;
}

/** Text terms a server may not match: any outside ASCII (Chinese, accents…). */
export interface LocalTerms {
  from: string[];
  to: string[];
  subject: string[];
  words: string[];
}

function isAscii(value: string): boolean {
  return /^[\x20-\x7e]*$/.test(value);
}

/**
 * Splits a query into what every IMAP server matches (dates, flags, ASCII text) and the non-ASCII
 * text terms. Outlook.com / Exchange answer a UTF-8 SEARCH with nothing at all (2026-10-23: a draft
 * saved with a Chinese subject could not be found by that subject), so those terms can be checked
 * by Yobi itself; `local` is null when there are none.
 */
export function splitNonAsciiTerms(query: MailQuery): { server: MailQuery; local: LocalTerms | null } {
  const local: LocalTerms = { from: [], to: [], subject: [], words: [] };
  const server: MailQuery = { ...query };
  for (const key of ['from', 'to', 'subject', 'words'] as const) {
    server[key] = query[key].filter(isAscii);
    local[key] = query[key].filter((value) => !isAscii(value));
  }
  const any = local.from.length + local.to.length + local.subject.length + local.words.length > 0;
  return { server, local: any ? local : null };
}

function slashDate(value: string): string {
  return value.replace(/^(\d{4})-(\d{1,2})-(\d{1,2})$/, '$1/$2/$3');
}

/** Gmail's own search, with ISO dates in the slash form Gmail documents. Blank means everything. */
export function toGmailRaw(input: string): string {
  return tokenizeMailQuery(input)
    .map((token) => {
      const match = /^(after|before|since|until):(.+)$/i.exec(token);
      if (!match) {
        if (!/\s/.test(token)) return token;
        const op = /^([a-z_]+):(.*)$/i.exec(token);
        return op ? `${op[1]}:"${op[2]}"` : `"${token}"`;
      }
      const op = match[1].toLowerCase() === 'since' ? 'after' : match[1].toLowerCase() === 'until' ? 'before' : match[1].toLowerCase();
      return `${op}:${slashDate(match[2])}`;
    })
    .join(' ')
    .trim();
}
