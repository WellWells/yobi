/**
 * Pure transcript + watermark logic for the `line_read` skill.
 *
 * Deliberately free of the native cipher driver, Electron and i18n: it takes plain
 * ParsedMessage rows and an injected label map, so the whole of it is unit-tested offline
 * against the node:sqlite fixture. The native wiring lives in lineMessages.ts.
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
 * One watermark per chat, because a step can now read several at once. A single shared
 * watermark would let a busy chat's timestamp suppress a quiet chat's older-but-unreported
 * messages — they would be silently skipped, which is the one outcome this step must never
 * produce. The global (all-chats) search stores itself under GLOBAL_WATERMARK_KEY.
 */
export interface LineWatermarkFile {
  chats: Record<string, LineWatermark>;
}

export const GLOBAL_WATERMARK_KEY = '*';

/**
 * The skill previously stored a bare LineWatermark. Rather than guess which chat such a file
 * belonged to, an unrecognised shape is treated as no memory at all: one extra first-run
 * report is cheaper — and far more honest — than attributing a watermark to the wrong chat.
 */
export function readWatermarkFile(raw: unknown): LineWatermarkFile {
  if (!raw || typeof raw !== 'object') return { chats: {} };
  const chats = (raw as LineWatermarkFile).chats;
  if (!chats || typeof chats !== 'object') return { chats: {} };
  return { chats };
}

/**
 * LINE's local DB syncs lazily: a message received while the client was offline is written
 * later but keeps its original _createdTime. A strict `> lastTs` would skip those forever and
 * silently, so every query reaches this far back and the tail keys drop the duplicates.
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

/**
 * `<ts>:<hash>` rather than a row id: the message table's typed columns carry no stable
 * identifier, and embedding the timestamp lets an old key be aged out without a second lookup.
 */
export function messageKey(msg: ParsedMessage): string {
  const body = [msg.sender ?? '', msg.type, msg.content ?? '', msg.filename ?? '', msg.url ?? ''].join('|');
  return `${messageTs(msg)}:${createHash('sha1').update(body, 'utf-8').digest('hex').slice(0, 12)}`;
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
    // Only a minority of file messages carry FILE_NAME; the rest keep the name in _text.
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
 * Trims from the OLDEST end. The provider prompt cap is enforced downstream by truncating the
 * TAIL, which on a chronological transcript would silently eat the newest messages — exactly
 * the part worth summarizing — so the budget is spent here instead.
 */
export function budgetedTranscript(
  messages: ParsedMessage[],
  maxChars: number,
  labels: TranscriptLabels,
): { text: string; kept: number; dropped: number } {
  const cap = Math.max(0, maxChars);
  const days = new Set<string>();
  let cost = 0;
  let firstKept = messages.length;

  for (let i = messages.length - 1; i >= 0; i--) {
    const day = dayOf(messages[i]);
    // Every entry costs its own separator; the join emits one fewer than it counted.
    let add = lineOf(messages[i], labels).length + 1;
    if (day && !days.has(day)) add += day.length + 1;
    if (cost + add - 1 > cap) break;
    cost += add;
    if (day) days.add(day);
    firstKept = i;
  }

  const kept = messages.slice(firstKept);
  return { text: renderTranscript(kept, labels), kept: kept.length, dropped: messages.length - kept.length };
}

/**
 * Splits a freshly queried batch into "not reported before" and the watermark to store next.
 * The batch must already be bounded by `lastTs - WATERMARK_OVERLAP_MS`.
 *
 * `maxFresh` is the step's own limit. The watermark advances only as far as the last message
 * actually returned, so a backlog bigger than the limit is drained over several runs instead
 * of being stranded — the same failure mode a seen-cache has when it marks a batch it never
 * delivered. The caller must therefore over-fetch by the number of tail keys, or the
 * already-reported messages inside the overlap window would spend the whole limit.
 */
export function selectFresh(
  messages: ParsedMessage[],
  previous: LineWatermark | null,
  nowIso: string,
  options: { maxFresh?: number } = {},
): { fresh: ParsedMessage[]; next: LineWatermark } {
  const reported = new Set(previous?.tailKeys ?? []);
  const unreported = messages.filter((msg) => !reported.has(messageKey(msg)));
  const fresh = options.maxFresh === undefined ? unreported : unreported.slice(0, options.maxFresh);

  const advanced = Math.max(previous?.lastTs ?? 0, ...fresh.map(messageTs), 0);
  // A first run that found nothing must start from now, not from zero — otherwise the next
  // run would report the oldest matching messages in the whole history as if they were new.
  const lastTs = advanced > 0 ? advanced : Date.parse(nowIso);
  const cutoff = lastTs - WATERMARK_OVERLAP_MS;
  const tailKeys = new Set<string>();
  for (const key of previous?.tailKeys ?? []) {
    if (keyTs(key) >= cutoff) tailKeys.add(key);
  }
  for (const msg of fresh) {
    if (messageTs(msg) >= cutoff) tailKeys.add(messageKey(msg));
  }

  return { fresh, next: { lastTs, tailKeys: [...tailKeys], updatedAt: nowIso } };
}
