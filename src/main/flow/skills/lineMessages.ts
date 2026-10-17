/**
 * `line_read` — reads the local LINE message store as a flow data source.
 *
 * The orchestration here takes an injected reader, checkpoint store and clock. execLineRead() is
 * the only part that touches the native driver, and it imports it lazily.
 */
import type { CheckpointStore } from '../checkpoint';
import { makeCheckpointStore } from '../checkpoint';
import { fillTemplate as fill } from '../../../shared/fillTemplate';
import { resolveLineRange, type ResolvedRange } from './lineRange';
import { planTranscript, type ChatBatch } from './lineBudget';
import {
  advanceWatermark,
  charBudgetFor,
  GLOBAL_WATERMARK_KEY,
  keptMessages,
  messageTs,
  pickUnreported,
  readWatermarkFile,
  WATERMARK_OVERLAP_MS,
  type LineWatermark,
  type LineWatermarkFile,
  type TranscriptKeep,
  type TranscriptLabels,
} from './lineTranscript';
import { envelope } from './dataSources';
import { config as appConfig } from '../../config';
import { sendLog } from '../../helpers';
import { getLangCache, t } from '../../i18n';
import { detectProvider, PROVIDER_PROMPT_POLICIES } from '../../providers';
import type { FlowExecutorDeps } from '../types';
import { FlowUserError } from '../userError';
import type { ChatSummary, MessageHit, SearchOptions } from '../../line/reader';
import type { ParsedMessage } from '../../line/schema';
import { MAX_LIMIT, saneLimit } from '../../line/schema';

/** The slice of LineReader this skill uses; structural, so any reader of this shape fits. */
export interface LineReaderLike {
  listChats(opts?: { query?: string; chatType?: string; limit?: number }): ChatSummary[];
  searchMessages(opts?: SearchOptions): MessageHit[];
}

/**
 * Failures a flow author can act on, as `{{placeholder}}` templates. Injected, like TranscriptLabels,
 * so this module stays off the language cache; they reach bot users, so they are localized.
 */
export interface LineReadErrorLabels {
  /** `{{name}}` — nothing in the local LINE store carries that name. */
  noChatMatch: string;
  /** `{{name}}`, `{{count}}`, `{{max}}` — the fragment names more chats than one run may read. */
  tooManyChats: string;
  /** Not one message fits the AI provider's input budget. */
  starved: string;
}

export interface LineReadDeps {
  getReader: () => Promise<LineReaderLike>;
  store: CheckpointStore<LineWatermarkFile>;
  labels: TranscriptLabels;
  errorLabels: LineReadErrorLabels;
  maxChars: number;
  now: () => Date;
  log?: (message: string) => void;
}

const DEFAULT_LIMIT = 200;

/**
 * One fragment can name half the address book (a single common word would). Past this many
 * matches the step reports the fragment as too broad instead of spending the budget on headings.
 */
const MAX_MATCHED_CHATS = 20;

interface ResolvedChat {
  chatId: string;
  chatName: string;
}

function toSeconds(ms: number): number {
  return Math.floor(ms / 1000);
}

/**
 * Turns one entry the author typed into the chats it names.
 *
 * A chat id or a full name resolves to that one chat; any other text is a fragment matching every
 * chat whose name contains it. A fragment that matches nothing aborts the run: an empty transcript
 * would look like a quiet day, so a mistyped name would never be noticed.
 */
function resolveOne(chats: ChatSummary[], wanted: string, labels: LineReadErrorLabels): ResolvedChat[] {
  const byId = chats.find((chat) => chat.chat_id === wanted);
  if (byId) return [{ chatId: byId.chat_id, chatName: byId.name }];

  const lowered = wanted.toLowerCase();
  const exact = chats.filter((chat) => chat.name.toLowerCase() === lowered);
  const matches = exact.length > 0 ? exact : chats.filter((chat) => chat.name.toLowerCase().includes(lowered));
  if (matches.length === 0) throw new Error(fill(labels.noChatMatch, { name: wanted }));
  if (matches.length > MAX_MATCHED_CHATS) {
    throw new Error(fill(labels.tooManyChats, {
      name: wanted,
      count: String(matches.length),
      max: String(MAX_MATCHED_CHATS),
    }));
  }
  return matches.map((chat) => ({ chatId: chat.chat_id, chatName: chat.name }));
}

/** Empty means "every chat": one global search rather than a per-chat pass. */
function resolveChats(reader: LineReaderLike, raw: string, labels: LineReadErrorLabels): ResolvedChat[] {
  const wanted = raw.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (wanted.length === 0) return [];
  // Listed once, not once per entry: listChats() rebuilds every name table it touches.
  const chats = reader.listChats({ limit: MAX_LIMIT });
  const seen = new Set<string>();
  const out: ResolvedChat[] = [];
  for (const entry of wanted) {
    // A chat two entries both reach — by id once and as a fragment once — must not be read,
    // or counted, twice.
    for (const resolved of resolveOne(chats, entry, labels)) {
      if (seen.has(resolved.chatId)) continue;
      seen.add(resolved.chatId);
      out.push(resolved);
    }
  }
  return out;
}

/** In global mode the chat is not implied by the step, so each line has to carry it. */
function tagWithChat(messages: ParsedMessage[]): ParsedMessage[] {
  return messages.map((msg) => {
    const chatName = (msg as MessageHit).chat_name;
    return chatName ? { ...msg, sender: `[${chatName}] ${msg.sender ?? ''}`.trim() } : msg;
  });
}

function upperOf(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

function lowerOf(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

interface FetchArgs {
  chatId: string | null;
  query: string;
  limit: number;
  range: ResolvedRange;
  previous: LineWatermark | null;
  nowMs: number;
}

interface QueryWindow {
  sinceMs: number | null;
  untilMs: number | null;
  order: 'asc' | 'desc';
  limit: number;
}

function search(reader: LineReaderLike, args: FetchArgs, window: QueryWindow): ParsedMessage[] {
  const sinceTs = window.sinceMs === null ? undefined : toSeconds(window.sinceMs);
  const untilTs = window.untilMs === null ? undefined : toSeconds(window.untilMs);
  // An empty window is a full table scan for nothing.
  if (sinceTs !== undefined && untilTs !== undefined && sinceTs > untilTs) return [];
  return reader.searchMessages({
    query: args.query || undefined,
    chatId: args.chatId ?? undefined,
    excludeOfficial: args.chatId === null,
    sinceTs,
    untilTs,
    order: window.order,
    limit: window.limit,
  });
}

/**
 * Draining a watermark reads oldest-first so a backlog larger than `limit` is delivered in order
 * across runs; every other read is the newest N inside the range.
 *
 * The drain is two queries: the overlap re-scan (up to the watermark's own second) only catches
 * late-synced rows, and the forward read from the next second spends its whole limit on messages
 * never reported, so reported rows in the overlap cannot crowd out new ones. Every reported key
 * sits at or below `lastTs` (see advanceWatermark).
 */
function fetchMessages(reader: LineReaderLike, args: FetchArgs): ParsedMessage[] {
  const { limit, range, previous, nowMs } = args;
  if (previous === null) {
    const newest = search(reader, args, { sinceMs: range.sinceMs, untilMs: range.untilMs, order: 'desc', limit });
    return [...newest].reverse();
  }

  // Bounds are whole seconds and inclusive at both ends, so the boundary second is read by
  // both queries; sent_at (whole seconds) decides which side a row belongs to.
  const nextSecondMs = (toSeconds(previous.lastTs) + 1) * 1000;
  const overlap = search(reader, args, {
    sinceMs: lowerOf(range.sinceMs, previous.lastTs - WATERMARK_OVERLAP_MS),
    untilMs: upperOf(range.untilMs, Math.min(nowMs, nextSecondMs)),
    order: 'asc',
    // Over-fetch by the tail so the reported rows the window re-reads cannot spend the limit.
    limit: Math.min(MAX_LIMIT, limit + previous.tailKeys.length),
  }).filter((msg) => messageTs(msg) <= previous.lastTs);
  const forward = search(reader, args, {
    sinceMs: lowerOf(range.sinceMs, nextSecondMs),
    untilMs: upperOf(range.untilMs, nowMs),
    order: 'asc',
    limit,
  });
  return [...overlap, ...forward];
}

export async function runLineRead(
  config: Record<string, string>,
  stepId: string,
  deps: LineReadDeps,
): Promise<string> {
  const log = deps.log ?? (() => undefined);
  const limit = saneLimit(config.limit, DEFAULT_LIMIT);
  const query = (config.query ?? '').trim();
  const sinceLastRun = config.sinceLastRun === 'true';
  const nowDate = deps.now();
  const nowMs = nowDate.getTime();
  // Throws on a malformed or inverted range: a typo must not widen the window to all time.
  const range = resolveLineRange(config, nowDate);

  // Never soft-fail: "" already means "nothing new" (see resolveOne).
  const reader = await deps.getReader();
  const targets = resolveChats(reader, config.chat ?? '', deps.errorLabels);
  const global = targets.length === 0;

  const previousFile = sinceLastRun ? readWatermarkFile(await deps.store.load(stepId)) : { chats: {} };
  const hadMemory = Object.keys(previousFile.chats).length > 0;
  // A watermark run delivers in order and leaves what the budget cannot carry for its next run,
  // as it does with what `limit` cannot carry; any other read is "the newest N".
  const keep: TranscriptKeep = sinceLastRun ? 'oldest' : 'newest';

  const keys = global ? [GLOBAL_WATERMARK_KEY] : targets.map((target) => target.chatId);
  const reads = keys.map((key) => {
    const previous = sinceLastRun ? previousFile.chats[key] ?? null : null;
    const fetched = fetchMessages(reader, {
      chatId: global ? null : key,
      query,
      limit,
      range,
      previous,
      nowMs,
    });
    // Untagged: the dedupe key hashes the sender, which tagWithChat rewrites.
    const fresh = sinceLastRun ? pickUnreported(fetched, previous, limit) : fetched;
    return { key, previous, fresh };
  });
  const batches: ChatBatch[] = reads.map(({ fresh }, index) => ({
    name: global ? '' : targets[index].chatName,
    messages: global ? tagWithChat(fresh) : fresh,
    keep,
  }));

  const { output, kept } = assemble(batches, { targets, global, hadMemory, sinceLastRun, deps, log });
  // Saved only once the transcript is in hand, and built from what it actually shows. Advancing
  // the watermark first, or over what the budget cut, would mark a batch as reported that was
  // never delivered — the exact way a seen-cache strands a backlog for good.
  if (sinceLastRun) {
    const nowIso = new Date(nowMs).toISOString();
    await deps.store.save(stepId, { chats: nextWatermarks(reads, kept, keep, nowIso) });
  }

  return envelope(...output);
}

/**
 * Only the chats this run actually read are carried forward. Keeping the rest would grow the
 * file with every edit and, worse, resurrect a months-old watermark if a chat were ever re-added
 * — dumping a backlog the author never asked for.
 *
 * A chat read for the first time that the budget left out entirely gets no watermark at all: the
 * "nothing found, start from now" rule would otherwise skip the very messages it just held back.
 * Its next run is simply its first run again.
 */
function nextWatermarks(
  reads: { key: string; previous: LineWatermark | null; fresh: ParsedMessage[] }[],
  kept: number[],
  keep: TranscriptKeep,
  nowIso: string,
): Record<string, LineWatermark> {
  const next: Record<string, LineWatermark> = {};
  reads.forEach(({ key, previous, fresh }, index) => {
    const delivered = keptMessages(fresh, kept[index], keep);
    if (previous === null && delivered.length === 0 && fresh.length > 0) return;
    next[key] = advanceWatermark(previous, delivered, nowIso);
  });
  return next;
}

interface AssembleContext {
  targets: ResolvedChat[];
  global: boolean;
  hadMemory: boolean;
  sinceLastRun: boolean;
  deps: LineReadDeps;
  log: (message: string) => void;
}

/**
 * Renders the batches inside the provider budget and derives every sub-variable from them.
 * `kept` is how many messages of each batch the transcript shows — the watermark is built from it.
 */
function assemble(
  batches: ChatBatch[],
  ctx: AssembleContext,
): { output: [string, Record<string, string>]; kept: number[] } {
  const { targets, global, deps } = ctx;
  const headings = targets.length > 1;
  const plan = planTranscript(batches, deps.maxChars, deps.labels, { headings });
  // "" means "there were no messages" everywhere else in this skill, so a budget too small to
  // show even one must say so out loud rather than hand a stop step a quiet-looking blank.
  if (plan.starved) throw new Error(deps.errorLabels.starved);

  const shown = plan.sections
    .flatMap((section, index) => keptMessages(batches[index].messages, section.kept, batches[index].keep))
    .sort((a, b) => messageTs(a) - messageTs(b));

  const contributing = plan.sections.filter((section) => section.kept > 0);
  const chatName = global
    ? ''
    : (targets.length === 1 ? targets[0].chatName : contributing.map((section) => section.name).join(', '));
  const chatCount = global
    ? new Set(shown.map((msg) => (msg as MessageHit).chat_id).filter(Boolean)).size
    : contributing.length;

  const label = global ? 'all chats' : (targets.length === 1 ? targets[0].chatName : `${targets.length} chats`);
  ctx.log(`💬 [Flow] line_read: ${plan.kept} message(s) from ${label}${plan.dropped > 0 ? ` (${plan.dropped} dropped to fit)` : ''}`);

  const output: [string, Record<string, string>] = [plan.text, {
    count: String(plan.kept),
    dropped: String(plan.dropped),
    chatName,
    chatCount: String(chatCount),
    firstAt: shown[0]?.sent_at ?? '',
    lastAt: shown[shown.length - 1]?.sent_at ?? '',
    isFirstRun: ctx.sinceLastRun && !ctx.hadMemory ? '1' : '0',
  }];
  return { output, kept: plan.sections.map((section) => section.kept) };
}

const lineWatermarkStore = makeCheckpointStore<LineWatermarkFile>('line_read');

function errorLabels(): LineReadErrorLabels {
  const strings = getLangCache();
  return {
    noChatMatch: t(strings, 'flow.skill.line_read.error.noChatMatch'),
    tooManyChats: t(strings, 'flow.skill.line_read.error.tooManyChats'),
    starved: t(strings, 'flow.skill.line_read.error.starved'),
  };
}

function transcriptLabels(): TranscriptLabels {
  const strings = getLangCache();
  return {
    image: t(strings, 'lineRead.placeholder.image'),
    video: t(strings, 'lineRead.placeholder.video'),
    audio: t(strings, 'lineRead.placeholder.audio'),
    file: t(strings, 'lineRead.placeholder.file'),
    location: t(strings, 'lineRead.placeholder.location'),
    contact: t(strings, 'lineRead.placeholder.contact'),
    other: t(strings, 'lineRead.placeholder.other'),
    me: t(strings, 'lineRead.speaker.me'),
  };
}

export async function execLineRead(
  config: Record<string, string>,
  stepId: string,
  deps: FlowExecutorDeps,
): Promise<string> {
  return runLineRead(config, stepId, {
    getReader: async () => {
      // Reading LINE is opt-in for the whole app; a flow must not be a way around that switch.
      if (!appConfig.lineReaderEnabled) {
        throw new FlowUserError(
          'flow.error.lineReaderOff',
          {},
          'the LINE connector is off — enable it in Settings before a flow can read LINE messages',
        );
      }
      // Lazy: the native cipher driver is only loaded when a flow actually reads LINE.
      const { getSharedLineService } = await import('../../line/sharedService');
      return getSharedLineService().getReader();
    },
    store: lineWatermarkStore,
    labels: transcriptLabels(),
    errorLabels: errorLabels(),
    maxChars: charBudgetFor(PROVIDER_PROMPT_POLICIES[detectProvider(deps.getTargetUrl())]),
    now: () => new Date(),
    log: sendLog,
  });
}
