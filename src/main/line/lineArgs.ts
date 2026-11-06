/**
 * Argument checks shared by the LINE tools, matching line-cli's flag handling. line-cli's texts
 * name its flags (`--limit`, `--chat-type`); here they
 * name the tool parameter (`limit`, `chat_type`) and are otherwise the same. Every argument error
 * is INVALID_ARGUMENT. The notes themselves are in lineNotes.ts.
 */
import { LineError } from './errors';
import { pageNote } from './lineNotes';
import { CHAT_TYPE_FILTERS, isChatTypeFilter, saneLimit } from './schema';

export function invalid(message: string): LineError {
  return new LineError('INVALID_ARGUMENT', message);
}

/** The value of the first of `names` the call has (a parameter, then its older names). */
export function argOf(args: Readonly<Record<string, unknown>>, ...names: string[]): unknown {
  for (const name of names) {
    if (args[name] !== undefined && args[name] !== null) return args[name];
  }
  return undefined;
}

/** A text argument; a number is taken as its text (an id typed as a number), anything else as ''. */
export function stringArg(value: unknown): string {
  if (typeof value === 'number') return String(value);
  return typeof value === 'string' ? value : '';
}

/** 0 = the default; negative or non-integer is refused like line-cli's flag parsing. */
export function limitArg(value: unknown, name = 'limit'): number {
  if (value === undefined || value === null || value === '') return 0;
  const n = typeof value === 'number' ? value : /^[+-]?\d+$/.test(String(value).trim()) ? Number(String(value).trim()) : Number.NaN;
  if (!Number.isInteger(n)) throw invalid(`invalid value "${String(value)}" for ${name}: parse error`);
  if (n < 0) throw invalid(`${name} must not be negative`);
  return n;
}

const TRUE_WORDS = new Set(['1', 't', 'T', 'TRUE', 'true', 'True']);
const FALSE_WORDS = new Set(['0', 'f', 'F', 'FALSE', 'false', 'False']);

/** A boolean flag: JSON true/false, or the words Go's flag package takes. */
export function boolArg(value: unknown, name: string): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'boolean') return value;
  const text = String(value);
  if (TRUE_WORDS.has(text)) return true;
  if (FALSE_WORDS.has(text)) return false;
  throw invalid(`invalid boolean value "${text}" for ${name}: parse error`);
}

/** '' when not given; otherwise one of the chat types. */
export function chatTypeArg(value: unknown): string {
  const type = stringArg(value);
  if (type && !isChatTypeFilter(type)) {
    throw invalid(`invalid chat_type: ${type} (valid: ${CHAT_TYPE_FILTERS.join(', ')})`);
  }
  return type;
}

/**
 * desc unless asc is given; any other value is refused as line-cli does. An empty string counts as
 * not given, as for every parameter here: models fill optional fields with "".
 */
export function orderArg(value: unknown): 'asc' | 'desc' {
  if (value === undefined || value === null || value === '') return 'desc';
  const order = stringArg(value);
  if (order !== 'asc' && order !== 'desc') throw invalid(`invalid order: ${order} (valid: asc, desc)`);
  return order;
}

export const CHAT_AND_TYPE = 'chat and chat_type cannot be combined; chat already selects one chat (its chat_type is in the output)';

/** The sent_at of the first and last rows. */
export function pageEnds(rows: readonly { sent_at?: string }[]): [string, string] {
  if (rows.length === 0) return ['', ''];
  return [rows[0].sent_at ?? '', rows[rows.length - 1].sent_at ?? ''];
}

/** Notes without the empty strings lineNotes uses for "no note". */
export function notesOf(...notes: (string | readonly string[])[]): string[] {
  return notes.flat().filter((note) => note !== '');
}

/** pageNote for a read-like page: newest N (page older with until) or first N from since (newer). */
export function readPageNote(rows: readonly { sent_at?: string }[], limit: number, fallback: number, sinceTs: number): string[] {
  const [first, last] = pageEnds(rows);
  const next = sinceTs !== 0 ? 'newer: rerun with since <last sent_at>' : 'older: rerun with until <first sent_at>';
  return notesOf(pageNote(rows.length, saneLimit(limit, fallback), first, last, next));
}
