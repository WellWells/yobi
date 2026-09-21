/**
 * `line_read` — reads the local LINE message store as a flow data source.
 *
 * The orchestration here takes an injected reader, checkpoint store and clock, so the whole
 * skill is unit-tested offline against a node:sqlite fixture. execLineRead() is the only part
 * that touches the native driver, and it imports it lazily for exactly that reason.
 */
import type { CheckpointStore } from '../checkpoint';
import { makeCheckpointStore } from '../checkpoint';
import { resolveLineRange, type ResolvedRange } from './lineRange';
import { planTranscript, type ChatBatch } from './lineBudget';
import {
  charBudgetFor,
  GLOBAL_WATERMARK_KEY,
  messageTs,
  readWatermarkFile,
  selectFresh,
  WATERMARK_OVERLAP_MS,
  type LineWatermark,
  type LineWatermarkFile,
  type TranscriptLabels,
} from './lineTranscript';
import { envelope } from './dataSources';
import { config as appConfig } from '../../config';
import { sendLog } from '../../helpers';
import { getLangCache, t } from '../../i18n';
import { detectProvider, PROVIDER_PROMPT_POLICIES } from '../../providers';
import type { FlowExecutorDeps } from '../types';
import type { ChatSummary, MessageHit, SearchOptions } from '../../line/reader';
import type { ParsedMessage } from '../../line/schema';
import { MAX_LIMIT, saneLimit } from '../../line/schema';

/** The slice of LineReader this skill uses; kept structural so tests inject a fixture reader. */
export interface LineReaderLike {
  listChats(opts?: { query?: string; chatType?: string; limit?: number }): ChatSummary[];
  searchMessages(opts?: SearchOptions): MessageHit[];
}

/**
 * The failures a flow author has to be able to act on, as templates with `{{placeholder}}`
 * holes. Injected for the same reason TranscriptLabels is: this module is unit-tested offline,
 * so it must not reach for the language cache — and since these now travel back to whoever sent
 * the bot command, they can no longer be hardcoded English either.
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
 * One fragment can name half the address book — a bare "群" would. Reading them all spends the
 * whole character budget on headings and takes minutes, so past this many the step says the
 * fragment is too broad rather than returning a transcript of nothing.
 */
const MAX_MATCHED_CHATS = 20;

function fill(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (text, [key, value]) => text.replaceAll(`{{${key}}}`, value),
    template,
  );
}

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
 * A chat id, or a name typed in full, is a precise request and resolves to that one chat. Any
 * other text is read as a FRAGMENT and matches every chat containing it — which is what makes a
 * command work when the group is really called "<fragment> 專案討論", and what lets one word
 * gather the several groups that share it into a single summary.
 *
 * A fragment that matches nothing still aborts the run. An empty transcript is indistinguishable
 * from a quiet day, the step after this one is always a stop, and a mistyped name would
 * otherwise report "nothing happened" every morning forever.
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

/**
 * One query per chat. Draining a watermark reads OLDEST-first so a backlog bigger than the
 * limit is delivered in order across runs; every other read is "the newest N inside the
 * range", which is what `limit` has always meant.
 */
function fetchMessages(reader: LineReaderLike, args: FetchArgs): ParsedMessage[] {
  const { chatId, query, limit, range, previous, nowMs } = args;
  const draining = previous !== null;
  const sinceMs = draining ? lowerOf(range.sinceMs, previous.lastTs - WATERMARK_OVERLAP_MS) : range.sinceMs;
  const untilMs = draining ? upperOf(range.untilMs, nowMs) : range.untilMs;
  // Over-fetch by the tail so the messages the overlap window re-reads cannot spend the limit.
  const overFetch = Math.min(MAX_LIMIT, limit + (previous?.tailKeys.length ?? 0));

  const hits = reader.searchMessages({
    query: query || undefined,
    chatId: chatId ?? undefined,
    excludeOfficial: chatId === null,
    sinceTs: sinceMs === null ? undefined : toSeconds(sinceMs),
    untilTs: untilMs === null ? undefined : toSeconds(untilMs),
    order: draining ? 'asc' : 'desc',
    limit: draining ? overFetch : limit,
  });
  return draining ? hits : [...hits].reverse();
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

  // Never soft-fail: "" already means "nothing new", and the step after this one is a stop.
  // A mistyped chat name that returned "" would look exactly like a quiet day, every run.
  const reader = await deps.getReader();
  const targets = resolveChats(reader, config.chat ?? '', deps.errorLabels);
  const global = targets.length === 0;

  const previousFile = sinceLastRun ? readWatermarkFile(await deps.store.load(stepId)) : { chats: {} };
  const hadMemory = Object.keys(previousFile.chats).length > 0;
  // Only the chats this run actually read are carried forward. Keeping the rest would grow the
  // file with every edit and, worse, resurrect a months-old watermark if a chat were ever
  // re-added — dumping a backlog the author never asked for.
  const nextChats: Record<string, LineWatermark> = {};
  const nowIso = new Date(nowMs).toISOString();

  const keys = global ? [GLOBAL_WATERMARK_KEY] : targets.map((target) => target.chatId);
  const batches: ChatBatch[] = keys.map((key, index) => {
    const previous = sinceLastRun ? previousFile.chats[key] ?? null : null;
    const fetched = fetchMessages(reader, {
      chatId: global ? null : key,
      query,
      limit,
      range,
      previous,
      nowMs,
    });
    let fresh = fetched;
    if (sinceLastRun) {
      const selected = selectFresh(fetched, previous, nowIso, { maxFresh: limit });
      fresh = selected.fresh;
      nextChats[key] = selected.next;
    }
    return { name: global ? '' : targets[index].chatName, messages: global ? tagWithChat(fresh) : fresh };
  });

  const assembled = assemble(batches, { targets, global, hadMemory, sinceLastRun, deps, log });
  // Saved only once the transcript is in hand. Advancing the watermark first would mark a batch
  // as reported that a failed assembly never delivered — the exact way a seen-cache strands a
  // backlog for good.
  if (sinceLastRun) await deps.store.save(stepId, { chats: nextChats });

  return envelope(...assembled);
}

interface AssembleContext {
  targets: ResolvedChat[];
  global: boolean;
  hadMemory: boolean;
  sinceLastRun: boolean;
  deps: LineReadDeps;
  log: (message: string) => void;
}

/** Renders the batches inside the provider budget and derives every sub-variable from them. */
function assemble(batches: ChatBatch[], ctx: AssembleContext): [string, Record<string, string>] {
  const { targets, global, deps } = ctx;
  const headings = targets.length > 1;
  const plan = planTranscript(batches, deps.maxChars, deps.labels, { headings });
  // "" means "there were no messages" everywhere else in this skill, so a budget too small to
  // show even one must say so out loud rather than hand a stop step a quiet-looking blank.
  if (plan.starved) throw new Error(deps.errorLabels.starved);

  const shown = plan.sections
    .flatMap((section, index) => batches[index].messages.slice(batches[index].messages.length - section.kept))
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

  return [plan.text, {
    count: String(plan.kept),
    dropped: String(plan.dropped),
    chatName,
    chatCount: String(chatCount),
    firstAt: shown[0]?.sent_at ?? '',
    lastAt: shown[shown.length - 1]?.sent_at ?? '',
    isFirstRun: ctx.sinceLastRun && !ctx.hadMemory ? '1' : '0',
  }];
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
        throw new Error('the LINE connector is off — enable it in Settings before a flow can read LINE messages');
      }
      // Lazy: pulls in the native cipher driver, which must stay out of the offline test path.
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
