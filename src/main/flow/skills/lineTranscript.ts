/**
 * Pure transcript + watermark logic for the `line_read` skill.
 *
 * Free of the native cipher driver, Electron and i18n: it takes plain ParsedMessage rows and an
 * injected label map. The native wiring lives in lineMessages.ts.
 */
import { createHash } from 'node:crypto';
import type { ParsedMessage } from '../../line/schema';

export interface LineWatermark {
  /** Epoch ms of the newest message reported so far. */
  lastTs: number;
  /** Keys of messages already reported inside the overlap window, `<ts>:<hash>`. */
  tailKeys: string[];
  updatedAt: string;
}

/**
 * One watermark per chat: a shared one would let a busy chat's timestamp suppress a quiet chat's
 * older, unreported messages. The global (all-chats) search stores itself under GLOBAL_WATERMARK_KEY.
 */
export interface LineWatermarkFile {
  chats: Record<string, LineWatermark>;
}

export const GLOBAL_WATERMARK_KEY = '*';

/**
 * Any unrecognised shape (including the legacy bare LineWatermark) is treated as no memory: one
 * extra first-run report beats attributing a watermark to the wrong chat.
 */
export function readWatermarkFile(raw: unknown): LineWatermarkFile {
  if (!raw || typeof raw !== 'object') return { chats: {} };
  const chats = (raw as LineWatermarkFile).chats;
  if (!chats || typeof chats !== 'object') return { chats: {} };
  return { chats };
}

/**
 * Messages can land in the local DB after newer ones, keeping their original timestamp. Every
 * query reaches this far back and the tail keys drop the duplicates.
 */
export const WATERMARK_OVERLAP_MS = 600_000;

/** Placeholders for messages whose body is not text. Injected so the module stays i18n-free. */
export interface TranscriptLabels {
  image: string;
  video: string;
  audio: string;
  file: string;
  location: string;
  contact: string;
  other: string;
  /** Speaker label for the user's own messages; `{{name}}` is their LINE name. */
  me: string;
}

const PLACEHOLDER_BY_TYPE: Record<string, keyof TranscriptLabels> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  location: 'location',
  contact: 'contact',
};

const DATE_CHARS = 10;

/** Reserve for the summarizing prompt that will wrap the transcript. */
const PROMPT_HEADROOM = 0.85;
/** A CJK character costs three bytes, so a byte cap converts at its worst case. */
const BYTES_PER_CHAR = 3;
/** Used when a provider declares no cap; low enough to be safe for the tightest one. */
const FALLBACK_BUDGET = 4_000;

/**
 * How much transcript may be handed to the next llm step. Derived rather than configured:
 * preparePrompt() enforces the provider cap by cutting the TAIL, which on a chronological
 * transcript is the newest — and most relevant — messages.
 */
export function charBudgetFor(policy: { maxBytes: number | null; maxCharsPlusBreaks: number | null }): number {
  const chars = policy.maxCharsPlusBreaks
    ?? (policy.maxBytes ? Math.floor(policy.maxBytes / BYTES_PER_CHAR) : FALLBACK_BUDGET);
  return Math.floor(chars * PROMPT_HEADROOM);
}

export function messageTs(msg: ParsedMessage): number {
  const parsed = msg.sent_at ? Date.parse(msg.sent_at) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

/** A search hit carries the chat it came from; a bare ParsedMessage does not. */
type MaybeChatMessage = ParsedMessage & { chat_id?: string };

function hashKey(ts: number, fields: string[]): string {
  return `${ts}:${createHash('sha1').update(fields.join('|'), 'utf-8').digest('hex').slice(0, 12)}`;
}

function bodyFields(msg: ParsedMessage): string[] {
  return [msg.sender ?? '', msg.type, msg.content ?? '', msg.filename ?? '', msg.url ?? ''];
}

/**
 * `<ts>:<hash>`: rows carry no stable id, and the timestamp lets old keys age out without a lookup.
 * The chat is part of the key so the same text posted to two chats in the same second stays two messages.
 */
export function messageKey(msg: ParsedMessage): string {
  const chatId = (msg as MaybeChatMessage).chat_id;
  if (!chatId) return legacyMessageKey(msg);
  return hashKey(messageTs(msg), [`chat:${chatId}`, ...bodyFields(msg)]);
}

/**
 * Legacy key without the chat id. Still matched on read so an upgrade does not re-send reported
 * messages; it ages out of the tail within one overlap window.
 */
function legacyMessageKey(msg: ParsedMessage): string {
  return hashKey(messageTs(msg), bodyFields(msg));
}

function keyTs(key: string): number {
  return Number.parseInt(key.slice(0, key.indexOf(':')), 10) || 0;
}

function flatten(value: string | null | undefined): string {
  return (value ?? '').replace(/\s*\r?\n\s*/g, ' ').trim();
}

function messageBody(msg: ParsedMessage, labels: TranscriptLabels): string {
  const text = flatten(msg.content);
  if (msg.type === 'file') {
    // The file name may be in either field.
    const name = flatten(msg.filename) || text;
    return name ? `${labels.file} ${name}` : labels.file;
  }
  if (msg.type === 'link') {
    return flatten(msg.title) || flatten(msg.url) || text || labels.other;
  }
  if (text) return text;
  return labels[PLACEHOLDER_BY_TYPE[msg.type] ?? 'other'];
}

function dayOf(msg: ParsedMessage): string {
  return (msg.sent_at ?? '').slice(0, DATE_CHARS);
}

function speakerOf(msg: ParsedMessage, labels: TranscriptLabels): string {
  const name = msg.sender ?? '';
  // A replacer function, so a `$&` inside a LINE name is inserted literally.
  return msg.from_me ? labels.me.replace('{{name}}', () => name) : name;
}

function lineOf(msg: ParsedMessage, labels: TranscriptLabels): string {
  const time = (msg.sent_at ?? '').slice(11, 16);
  return `${time} ${speakerOf(msg, labels)}：${messageBody(msg, labels)}`;
}

export function renderTranscript(messages: ParsedMessage[], labels: TranscriptLabels): string {
  const lines: string[] = [];
  let currentDay = '';
  for (const msg of messages) {
    const day = dayOf(msg);
    if (day && day !== currentDay) {
      lines.push(day);
      currentDay = day;
    }
    lines.push(lineOf(msg, labels));
  }
  return lines.join('\n');
}

/**
 * Which end of a batch survives the budget. `newest` (default) drops from the oldest end, because
 * the provider cap downstream truncates the tail, i.e. the newest messages. `oldest` is for
 * sinceLastRun reads, which deliver in order and leave the rest for the next run.
 */
export type TranscriptKeep = 'newest' | 'oldest';

/** The messages a batch trimmed to `kept` actually shows. */
export function keptMessages<T>(messages: T[], kept: number, keep: TranscriptKeep = 'newest'): T[] {
  return keep === 'oldest' ? messages.slice(0, kept) : messages.slice(messages.length - kept);
}

export function budgetedTranscript(
  messages: ParsedMessage[],
  maxChars: number,
  labels: TranscriptLabels,
  keep: TranscriptKeep = 'newest',
): { text: string; kept: number; dropped: number } {
  const cap = Math.max(0, maxChars);
  const days = new Set<string>();
  const order = messages.map((_, i) => i);
  if (keep === 'newest') order.reverse();
  let cost = 0;
  let count = 0;

  for (const i of order) {
    const day = dayOf(messages[i]);
    // Every entry costs its own separator; the join emits one fewer than it counted. A date
    // header is paid once per day whichever end the walk starts from.
    let add = lineOf(messages[i], labels).length + 1;
    if (day && !days.has(day)) add += day.length + 1;
    if (cost + add - 1 > cap) break;
    cost += add;
    if (day) days.add(day);
    count += 1;
  }

  const kept = keptMessages(messages, count, keep);
  return { text: renderTranscript(kept, labels), kept: kept.length, dropped: messages.length - kept.length };
}

/**
 * The messages of a freshly queried, oldest-first batch that were not reported before, capped
 * at `maxFresh` (the step's own limit) from the oldest end. The batch must already be bounded
 * by `lastTs - WATERMARK_OVERLAP_MS`.
 */
export function pickUnreported(
  messages: ParsedMessage[],
  previous: LineWatermark | null,
  maxFresh?: number,
): ParsedMessage[] {
  const reported = new Set(previous?.tailKeys ?? []);
  const unreported = messages.filter((msg) => !reported.has(messageKey(msg)) && !reported.has(legacyMessageKey(msg)));
  return maxFresh === undefined ? unreported : unreported.slice(0, maxFresh);
}

/**
 * The watermark to store once `delivered` (and only it) has been shown. It advances only to the last
 * delivered message so a backlog drains over several runs; that holds only if everything held back is
 * newer, which is why sinceLastRun reads keep the oldest end. Tail keys stay at or below `lastTs`.
 */
export function advanceWatermark(
  previous: LineWatermark | null,
  delivered: ParsedMessage[],
  nowIso: string,
): LineWatermark {
  const advanced = Math.max(previous?.lastTs ?? 0, ...delivered.map(messageTs), 0);
  // A first run that found nothing must start from now, not from zero — otherwise the next
  // run would report the oldest matching messages in the whole history as if they were new.
  const lastTs = advanced > 0 ? advanced : Date.parse(nowIso);
  const cutoff = lastTs - WATERMARK_OVERLAP_MS;
  const tailKeys = new Set<string>();
  for (const key of previous?.tailKeys ?? []) {
    if (keyTs(key) >= cutoff) tailKeys.add(key);
  }
  for (const msg of delivered) {
    if (messageTs(msg) >= cutoff) tailKeys.add(messageKey(msg));
  }
  return { lastTs, tailKeys: [...tailKeys], updatedAt: nowIso };
}

/** pickUnreported + advanceWatermark, for a caller that delivers everything it picks. */
export function selectFresh(
  messages: ParsedMessage[],
  previous: LineWatermark | null,
  nowIso: string,
  options: { maxFresh?: number } = {},
): { fresh: ParsedMessage[]; next: LineWatermark } {
  const fresh = pickUnreported(messages, previous, options.maxFresh);
  return { fresh, next: advanceWatermark(previous, fresh, nowIso) };
}
