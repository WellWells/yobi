import type {
  AgentFlowRecipient, BotPlatform, FlowDefinition, LinePairedUser, TelegramChannel, TelegramPairedUser, TriggerType,
} from './types';
import { BOT_PLATFORMS, isBotPlatform } from './types';
import { escapeRegExp } from './regex';

/**
 * Who a flow's bot step can send to, and how a recipient the user NAMED becomes the chat id the
 * step needs.
 *
 * The model writing a flow never sees this list. It writes what the user said — "me", a name,
 * "all" — and the program looks that up here, so neither the names nor the ids of the people the
 * user paired travel to a provider just to fill in one field. The only time names leave the
 * machine is a question that offers them as choices, which the user is about to read anyway.
 */

export interface RecipientEntry {
  platform: BotPlatform;
  /** What the step sends to: a Telegram chat id, a LINE user id. */
  id: string;
  /** How the recipient picker shows it. */
  label: string;
  /** Normalized names it answers to: the label, the first name, the @username, a chat's title. */
  keys: string[];
  kind: 'person' | 'chat';
  /** Marked as the user themself in Settings, and still paired. */
  self: boolean;
}

export interface RecipientDirectory {
  connected: Record<BotPlatform, boolean>;
  entries: RecipientEntry[];
}

function noneConnected(): Record<BotPlatform, boolean> {
  return Object.fromEntries(BOT_PLATFORMS.map((platform) => [platform, false])) as Record<BotPlatform, boolean>;
}

export const EMPTY_RECIPIENT_DIRECTORY: RecipientDirectory = {
  connected: noneConnected(),
  entries: [],
};

/** A bot whose accounts pair by string id (LINE, Discord, Slack): its paired people are its recipients. */
interface PairedPeopleSource {
  connected: boolean;
  pairedUsers: readonly LinePairedUser[];
}

type StringIdPlatform = Exclude<BotPlatform, 'telegram'>;
const STRING_ID_PLATFORMS: readonly StringIdPlatform[] = ['line', 'discord', 'slack'];

export interface RecipientSources extends Partial<Record<Exclude<StringIdPlatform, 'line'>, PairedPeopleSource>> {
  telegram: { connected: boolean; pairedUsers: readonly TelegramPairedUser[]; channels: readonly TelegramChannel[] };
  line: PairedPeopleSource;
  /** The ids ticked as "this is me" in Settings, per platform. */
  self: Partial<Record<BotPlatform, readonly string[]>>;
}

export const PLATFORM_ORDER: readonly BotPlatform[] = BOT_PLATFORMS;

/** NFKC folds the styled letters people put in display names ("Alice 𝕏" is typed "Alice X"). */
export function normalizeRecipientName(value: string): string {
  return value.normalize('NFKC').toLowerCase().trim().replace(/^@+/, '').replace(/\s+/g, ' ').trim();
}

function keysOf(...names: Array<string | undefined>): string[] {
  return [...new Set(names.map((name) => normalizeRecipientName(name ?? '')).filter(Boolean))];
}

export function buildRecipientDirectory(src: RecipientSources): RecipientDirectory {
  const entries: RecipientEntry[] = [];
  if (src.telegram.connected) {
    for (const user of src.telegram.pairedUsers) {
      const id = String(user.userId);
      const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ');
      const label = fullName || (user.username ? `@${user.username}` : id);
      entries.push({
        platform: 'telegram', id, label, kind: 'person',
        keys: keysOf(fullName, user.firstName, user.username),
        self: (src.self.telegram ?? []).includes(id),
      });
    }
    for (const channel of src.telegram.channels) {
      if (!channel.canPost) continue;
      const id = String(channel.chatId);
      entries.push({
        platform: 'telegram', id, label: channel.title || (channel.username ? `@${channel.username}` : id), kind: 'chat',
        keys: keysOf(channel.title, channel.username),
        self: false,
      });
    }
  }
  const connected = { ...noneConnected(), telegram: src.telegram.connected };
  for (const platform of STRING_ID_PLATFORMS) {
    const source = src[platform];
    if (!source?.connected) continue;
    connected[platform] = true;
    for (const user of source.pairedUsers) {
      entries.push({
        platform, id: user.userId, label: user.displayName || user.userId, kind: 'person',
        keys: keysOf(user.displayName),
        self: (src.self[platform] ?? []).includes(user.userId),
      });
    }
  }
  return { connected, entries };
}

/**
 * The directory as one bot account sees it: "me" is that account, not whoever is marked as the user
 * in Settings. An admin asking the bot for a flow 「推送到我這個帳號」 means their own chat.
 */
export function directorySeenBy(dir: RecipientDirectory, platform: BotPlatform, id: string): RecipientDirectory {
  return {
    ...dir,
    entries: dir.entries.map((entry) => ({ ...entry, self: entry.kind === 'person' && entry.platform === platform && entry.id === id })),
  };
}

/** The step's recipients as written: `chatIds`, or the older `chatId` it replaced. */
export function botStepTargets(config: Record<string, string>): string {
  return (config.chatIds ?? '').trim() || (config.chatId ?? '').trim();
}

export function splitTargets(raw: string): string[] {
  return raw.split(/[,，、]/).map((part) => part.trim()).filter(Boolean);
}

const TEMPLATE_RE = /\{\{[^}]+\}\}/;
const TELEGRAM_ID_RE = /^-?\d+$/;
const LINE_ID_RE = /^[UCR][0-9a-f]{32}$/i;
/** A Discord snowflake: a user (their DM) or a channel. */
const DISCORD_ID_RE = /^\d{17,20}$/;
/** A Slack user (their DM) or a channel: an uppercase letter and 8–12 more. */
const SLACK_ID_RE = /^[UWCGD][A-Z0-9]{8,12}$/;

const RECIPIENT_ID_PATTERNS: Readonly<Record<StringIdPlatform, RegExp>> = { line: LINE_ID_RE, discord: DISCORD_ID_RE, slack: SLACK_ID_RE };
const SELF_TOKENS = new Set(['me', 'myself', 'self', '我', '我自己', '自己', '本人', '我本人']);
const ALL_TOKENS = new Set(['all', 'everyone', '*', '所有人', '全部', '大家']);

export function isRecipientId(token: string, platform: BotPlatform): boolean {
  const value = token.trim();
  if (platform === 'telegram') return TELEGRAM_ID_RE.test(value) && Number(value) !== 0;
  return RECIPIENT_ID_PATTERNS[platform].test(value);
}

export type RecipientMatch =
  /** Already an id, or a variable the run fills in. */
  | { kind: 'keep' }
  | { kind: 'all' }
  | { kind: 'entry'; entry: RecipientEntry }
  | { kind: 'unknown' }
  | { kind: 'ambiguous'; candidates: RecipientEntry[] };

function pickOne(candidates: readonly RecipientEntry[]): RecipientMatch {
  if (candidates.length === 0) return { kind: 'unknown' };
  if (candidates.length === 1) return { kind: 'entry', entry: candidates[0]! };
  return { kind: 'ambiguous', candidates: [...candidates] };
}

/** The one paired person is the user whether or not they ticked "this is me"; among several, only the ticked ones. */
function selfCandidates(pool: readonly RecipientEntry[]): RecipientEntry[] {
  const people = pool.filter((entry) => entry.kind === 'person');
  const marked = people.filter((entry) => entry.self);
  return marked.length > 0 ? marked : people;
}

/** Exact name first; a fragment only when it names exactly one chat, since sending to a guess is worse than asking. */
export function matchRecipient(token: string, platform: BotPlatform, dir: RecipientDirectory): RecipientMatch {
  const raw = token.trim();
  if (TEMPLATE_RE.test(raw) || isRecipientId(raw, platform)) return { kind: 'keep' };
  const key = normalizeRecipientName(raw);
  if (!key) return { kind: 'unknown' };
  if (ALL_TOKENS.has(key)) return { kind: 'all' };
  const pool = dir.entries.filter((entry) => entry.platform === platform);
  if (SELF_TOKENS.has(key)) return pickOne(selfCandidates(pool));
  const exact = pool.filter((entry) => entry.keys.includes(key));
  if (exact.length > 0) return pickOne(exact);
  return pickOne(key.length >= 2 ? pool.filter((entry) => entry.keys.some((name) => name.includes(key))) : []);
}

export interface SendTargets {
  targets: string[];
  /** Names that matched no chat, or more than one. */
  missing: string[];
  /** "all" was written: every paired user. */
  everyone: boolean;
}

/** The recipient field at send time: ids pass through, names become ids, and an unclear name is not guessed. */
export function resolveTargetsForSend(tokens: readonly string[], platform: BotPlatform, dir: RecipientDirectory): SendTargets {
  const targets: string[] = [];
  const missing: string[] = [];
  let everyone = false;
  for (const token of tokens) {
    const match = matchRecipient(token, platform, dir);
    if (match.kind === 'keep') targets.push(token);
    else if (match.kind === 'all') everyone = true;
    else if (match.kind === 'entry') targets.push(match.entry.id);
    else missing.push(token);
  }
  return { targets: everyone ? [] : [...new Set(targets)], missing, everyone };
}

const SELF_PHRASES: readonly RegExp[] = [
  /(?:給|给|傳給|传给|推給|推给|推到|發給|发给|寄給|寄给|送給|送给|通知|私訊|私信|提醒|告訴|告诉)我/,
  /我的\s*(?:手機|手机|電話|电话|帳號|账号|機器人|机器人|個人|个人|telegram|line|bot)/i,
  /個人(?!化)|个人(?!化)|我自己|本人/,
  /(?<![a-z])(?:me|myself)(?![a-z])|(?<![a-z])my (?:phone|telegram|line|account|bot|chat)(?![a-z])/i,
];
const EVERYONE_PHRASES = /所有人|每個人|每个人|大家|全部的人|所有已配對|所有已配对|廣播|广播|(?<![a-z])(?:everyone|everybody|broadcast)(?![a-z])|(?<![a-z])all (?:paired|users|of us)(?![a-z])/i;

/** Whether the user's own words say the message is for them ("send it to me", "my phone"). */
export function saysForMe(words: string): boolean {
  return SELF_PHRASES.some((pattern) => pattern.test(words));
}

export function saysEveryone(words: string): boolean {
  return EVERYONE_PHRASES.test(words);
}

const ASCII_KEY_RE = /^[\x20-\x7e]+$/;

/** The chats the user's words name. An ASCII name must stand as its own word, so "Test" is not found in "testing". */
export function namedIn(words: string, entries: readonly RecipientEntry[]): RecipientEntry[] {
  const haystack = normalizeRecipientName(words);
  return entries.filter((entry) => entry.keys.some((key) => {
    if (key.length < 2) return false;
    if (!ASCII_KEY_RE.test(key)) return haystack.includes(key);
    return new RegExp(`(?<![a-z0-9])${escapeRegExp(key)}(?![a-z0-9])`).test(haystack);
  }));
}

export function connectedPlatforms(dir: RecipientDirectory): BotPlatform[] {
  return PLATFORM_ORDER.filter((platform) => dir.connected[platform]);
}

const BOT_COMMAND_TRIGGER: TriggerType = 'bot';

export interface RecipientIssue {
  /** Index into `flow.steps`. */
  index: number;
  /** `unknown`/`ambiguous`: a name that matched no chat or several. `broadcast`: blank, so everyone gets it. */
  kind: 'unknown' | 'ambiguous' | 'broadcast';
  token: string;
  /** For `broadcast`: how many people that is. */
  count: number;
}

function platformChoice(config: Record<string, string>): BotPlatform | 'auto' {
  const value = (config.platform ?? '').trim().toLowerCase();
  return isBotPlatform(value) ? value : 'auto';
}

function withTargets(config: Record<string, string>, platform: BotPlatform | 'auto', ids: string): Record<string, string> {
  const { chatId: _legacy, ...rest } = config;
  return { ...rest, platform, chatIds: ids };
}

interface StepResult {
  config: Record<string, string>;
  issue?: Omit<RecipientIssue, 'index'>;
}

/** "auto" outside a bot command falls back to Telegram at run time, which is wrong when another bot is the only one. */
function defaultPlatform(dir: RecipientDirectory): BotPlatform {
  return connectedPlatforms(dir)[0] ?? 'telegram';
}

function resolveBlank(
  config: Record<string, string>,
  choice: BotPlatform | 'auto',
  dir: RecipientDirectory,
  words: string,
): StepResult {
  const platform: BotPlatform = choice !== 'auto' ? choice : defaultPlatform(dir);
  const people = dir.entries.filter((entry) => entry.platform === platform && entry.kind === 'person');
  const settled = choice === platform ? config : { ...config, platform };
  if (people.length <= 1 || saysEveryone(words)) return { config: settled };
  // Only "it's for me" fills a blank. A name in the request is the model's to write: guessing one
  // out of free text could hand the digest to a channel whose title happens to be a common word.
  const self = people.filter((entry) => entry.self);
  if (saysForMe(words) && self.length === 1) return { config: withTargets(config, platform, self[0]!.id) };
  return { config: settled, issue: { kind: 'broadcast', token: '', count: people.length } };
}

function resolveStep(
  config: Record<string, string>,
  dir: RecipientDirectory,
  botTriggered: boolean,
  words: string,
): StepResult {
  // A flow variable picks the bot at run time (the X gallery template's Telegram/LINE setting).
  if (TEMPLATE_RE.test(config.platform ?? '')) return { config };
  const choice = platformChoice(config);
  const tokens = splitTargets(botStepTargets(config));
  if (tokens.length === 0) return botTriggered ? { config } : resolveBlank(config, choice, dir, words);

  const platforms: BotPlatform[] = choice !== 'auto' ? [choice] : (connectedPlatforms(dir).length > 0 ? connectedPlatforms(dir) : ['telegram']);
  const attempts = platforms.map((platform) => {
    const matches = tokens.map((token) => ({ token, match: matchRecipient(token, platform, dir) }));
    const failed = matches.filter(({ match }) => match.kind === 'unknown' || match.kind === 'ambiguous');
    return { platform, matches, failed };
  });
  const best = attempts.reduce((winner, attempt) => (attempt.failed.length < winner.failed.length ? attempt : winner));

  // A recipient that names a chat pins the platform. Otherwise a bot command keeps "auto" — sending
  // to {{bot.triggerChatId}} or "all" answers on whichever bot the command came from — and anything
  // else takes the same platform a blank field would.
  const pinned = best.matches.some(({ token, match }) => match.kind === 'entry' || isRecipientId(token, best.platform));
  const platform: BotPlatform | 'auto' = choice !== 'auto' || pinned ? best.platform : botTriggered ? 'auto' : defaultPlatform(dir);
  const everyone = best.matches.some(({ match }) => match.kind === 'all');
  // Unresolved names stay in the field: at run time they fail loudly instead of turning into a broadcast.
  const ids = everyone ? '' : [...new Set(best.matches.map(({ token, match }) => (match.kind === 'entry' ? match.entry.id : token)))].join(',');
  const resolved = withTargets(config, platform, ids);
  const firstFailure = best.failed[0];
  if (!firstFailure) return { config: resolved };
  return { config: resolved, issue: { kind: firstFailure.match.kind as 'unknown' | 'ambiguous', token: firstFailure.token, count: 0 } };
}

const SENDER_TOKEN = '{{bot.triggerChatId}}';

/**
 * Who the bot steps send to, by name — for the confirmation the user approves before a flow is
 * saved. The generator writes recipients from the agent's rewording of the request, so this line
 * is where the user sees who will actually get the messages.
 */
export function flowRecipients(
  flow: FlowDefinition,
  dir: RecipientDirectory,
  only?: ReadonlySet<number>,
): AgentFlowRecipient[] {
  const out: AgentFlowRecipient[] = [];
  const seen = new Set<string>();
  const add = (recipient: AgentFlowRecipient): void => {
    const key = `${recipient.kind}:${recipient.name ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(recipient);
  };
  flow.steps.forEach((step, index) => {
    if (step.type !== 'bot' || (only && !only.has(index))) return;
    const tokens = splitTargets(botStepTargets(step.config));
    if (tokens.length === 0) add({ kind: 'everyone' });
    for (const token of tokens) {
      if (token.replace(/\s+/g, '') === SENDER_TOKEN) add({ kind: 'sender' });
      else add({ kind: 'name', name: dir.entries.find((entry) => entry.id === token)?.label ?? token });
    }
  });
  return out;
}

export interface ResolveRecipientsOptions {
  /** The user's own words for this request, read for "send it to me". */
  words: string;
  /** Only these steps (indexes into `flow.steps`); the rest are the user's and stay as they are. */
  only?: ReadonlySet<number>;
}

/** Every bot step's recipients turned into ids where the user's words make that unambiguous. */
export function resolveFlowRecipients(
  flow: FlowDefinition,
  dir: RecipientDirectory,
  options: ResolveRecipientsOptions,
): { flow: FlowDefinition; issues: RecipientIssue[] } {
  const botTriggered = [flow.trigger, ...(flow.extraTriggers ?? [])].some((trigger) => trigger.type === BOT_COMMAND_TRIGGER);
  const issues: RecipientIssue[] = [];
  const steps = flow.steps.map((step, index) => {
    if (step.type !== 'bot' || (options.only && !options.only.has(index))) return step;
    const result = resolveStep(step.config, dir, botTriggered, options.words);
    if (result.issue) issues.push({ index, ...result.issue });
    return result.config === step.config ? step : { ...step, config: result.config };
  });
  return { flow: { ...flow, steps }, issues };
}
