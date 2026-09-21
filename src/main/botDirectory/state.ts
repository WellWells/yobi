/*
 * `removed` covers a bot kicked out of a channel or group, `blocked` a user who blocked it and
 * `deactivated` a deleted account. `no_rights` is the one recoverable state — the bot is still a
 * member, it just lost the posting right. The shapes live in shared/types because the settings page
 * renders them.
 */
import type {
  BotContact,
  BotContactKind,
  BotPlatform,
  BotReachability,
  TelegramChatKind,
} from '../../shared/types';

export type { BotContact, BotContactKind, BotReachability };

export type BotContactMap = Record<string, BotContact>;

export interface BotContactInput {
  platform: BotPlatform;
  kind: BotContactKind;
  id: string;
  title?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  chatType?: TelegramChatKind;
  pairedAt?: string;
}

export function contactKey(platform: BotPlatform, kind: BotContactKind, id: string): string {
  return `${platform}:${kind}:${id}`;
}

/**
 * Fields are merged, never blanked: a lookup that came back without a username must not erase the
 * one recorded at pairing time.
 */
export function upsertContact(map: BotContactMap, input: BotContactInput, now: string): BotContactMap {
  const id = input.id.trim();
  if (!id) return map;
  const key = contactKey(input.platform, input.kind, id);
  const existing = map[key];
  const next: BotContact = {
    platform: input.platform,
    kind: input.kind,
    id,
    ...(input.title ?? existing?.title ? { title: input.title || existing?.title } : {}),
    ...(input.username ?? existing?.username ? { username: input.username || existing?.username } : {}),
    ...(input.firstName ?? existing?.firstName ? { firstName: input.firstName || existing?.firstName } : {}),
    ...(input.lastName ?? existing?.lastName ? { lastName: input.lastName || existing?.lastName } : {}),
    ...(input.chatType ?? existing?.chatType ? { chatType: input.chatType || existing?.chatType } : {}),
    ...(input.pairedAt ?? existing?.pairedAt ? { pairedAt: input.pairedAt || existing?.pairedAt } : {}),
    firstSeenAt: existing?.firstSeenAt ?? now,
    lastSeenAt: now,
    reachability: existing?.reachability ?? 'ok',
    ...(existing?.unreachableSince ? { unreachableSince: existing.unreachableSince } : {}),
    ...(existing?.lastError ? { lastError: existing.lastError } : {}),
  };
  return { ...map, [key]: next };
}

export function setReachability(
  map: BotContactMap,
  key: string,
  reachability: BotReachability,
  now: string,
  lastError?: string,
): BotContactMap {
  const existing = map[key];
  if (!existing) return map;
  if (existing.reachability === reachability && (reachability === 'ok' || existing.lastError === lastError)) {
    return map;
  }
  if (reachability === 'ok') {
    const { unreachableSince: _u, lastError: _e, ...rest } = existing;
    return { ...map, [key]: { ...rest, reachability: 'ok', lastSeenAt: now } };
  }
  return {
    ...map,
    [key]: {
      ...existing,
      reachability,
      unreachableSince: existing.reachability === reachability
        ? existing.unreachableSince ?? now
        : now,
      ...(lastError ? { lastError } : {}),
    },
  };
}

/**
 * Revoking keeps the name but drops the grant: a recipient still sitting in a flow should stay
 * readable, it just must never be handed authorization back by the start-up restore.
 */
export function revokePairing(map: BotContactMap, platform: BotPlatform, id: string): BotContactMap {
  const key = contactKey(platform, 'user', id);
  const existing = map[key];
  if (!existing?.pairedAt) return map;
  const { pairedAt: _dropped, ...rest } = existing;
  return { ...map, [key]: rest };
}

export function forgetContact(map: BotContactMap, key: string): BotContactMap {
  if (!map[key]) return map;
  const { [key]: _dropped, ...rest } = map;
  return rest;
}

export function listContacts(
  map: BotContactMap,
  filter: { platform?: BotPlatform; kind?: BotContactKind } = {},
): BotContact[] {
  return Object.values(map).filter((entry) => {
    if (filter.platform && entry.platform !== filter.platform) return false;
    if (filter.kind && entry.kind !== filter.kind) return false;
    return true;
  });
}

/**
 * Only entries carrying pairedAt were ever authorized. A chat the bot merely posts into must never
 * become a re-pairing candidate.
 */
export function listPairedContacts(map: BotContactMap, platform: BotPlatform): BotContact[] {
  return listContacts(map, { platform, kind: 'user' }).filter((entry) => Boolean(entry.pairedAt));
}

export interface ApiErrorShape {
  code?: number;
  description: string;
}

export function readApiError(err: unknown): ApiErrorShape {
  if (!err || typeof err !== 'object') {
    return { description: typeof err === 'string' ? err : '' };
  }
  const record = err as Record<string, unknown>;
  const code = pickNumber(record.error_code) ?? pickNumber(record.status) ?? pickNumber(record.statusCode);
  const description = pickString(record.description)
    ?? pickString(record.message)
    ?? '';
  return { ...(code === undefined ? {} : { code }), description };
}

/**
 * Anything not positively recognised as permanent stays `transient`. Marking a working recipient
 * unreachable because of one flaky night is far worse than reporting a real block a day late.
 */
export function classifySendFailure(err: unknown): BotReachability | 'transient' {
  const { code, description } = readApiError(err);
  const text = description.toLowerCase();

  if (text.includes('bot was blocked by the user')) return 'blocked';
  if (text.includes('user is deactivated')) return 'deactivated';
  if (text.includes('bot was kicked')) return 'removed';
  if (text.includes('bot is not a member')) return 'removed';
  if (text.includes('chat not found')) return 'not_found';
  if (text.includes('not enough rights')) return 'no_rights';
  if (text.includes('chat_write_forbidden')) return 'no_rights';
  if (text.includes('have no rights to send a message')) return 'no_rights';

  // A 403 the wording above did not name is still Telegram refusing outright, not a blip.
  if (code === 403) return 'removed';
  return 'transient';
}

/** Maps a my_chat_member status straight to reachability, which beats waiting for a send to fail. */
export function reachabilityFromStatus(kind: BotContactKind, status: string): BotReachability {
  if (status === 'kicked') return kind === 'user' ? 'blocked' : 'removed';
  if (status === 'left') return 'removed';
  return 'ok';
}

export function describeContact(contact: BotContact): string {
  if (contact.kind === 'chat') {
    return contact.title || (contact.username ? `@${contact.username}` : `chat ${contact.id}`);
  }
  const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(' ');
  if (fullName) return contact.username ? `${fullName} (@${contact.username})` : fullName;
  return contact.username ? `@${contact.username}` : `ID ${contact.id}`;
}

export function normalizeContactMap(raw: unknown): BotContactMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: BotContactMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const entry = normalizeContact(value);
    if (entry) out[key] = entry;
  }
  return out;
}

const REACHABILITY_VALUES: BotReachability[] = ['ok', 'blocked', 'deactivated', 'removed', 'not_found', 'no_rights'];

function normalizeContact(raw: unknown): BotContact | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Record<string, unknown>;
  const platform = entry.platform === 'telegram' || entry.platform === 'line' ? entry.platform : null;
  const kind = entry.kind === 'user' || entry.kind === 'chat' ? entry.kind : null;
  const id = pickString(entry.id);
  if (!platform || !kind || !id) return null;
  const reachability = REACHABILITY_VALUES.includes(entry.reachability as BotReachability)
    ? (entry.reachability as BotReachability)
    : 'ok';
  const now = new Date().toISOString();
  return {
    platform,
    kind,
    id,
    ...optional('title', pickString(entry.title)),
    ...optional('username', pickString(entry.username)?.replace(/^@/, '')),
    ...optional('firstName', pickString(entry.firstName)),
    ...optional('lastName', pickString(entry.lastName)),
    ...optional('chatType', pickChatKind(entry.chatType)),
    ...optional('pairedAt', pickString(entry.pairedAt)),
    firstSeenAt: pickString(entry.firstSeenAt) ?? now,
    lastSeenAt: pickString(entry.lastSeenAt) ?? now,
    reachability,
    ...optional('unreachableSince', pickString(entry.unreachableSince)),
    ...optional('lastError', pickString(entry.lastError)),
  };
}

function optional<K extends string, V>(key: K, value: V | undefined): Record<K, V> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

function pickString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text || undefined;
}

function pickNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function pickChatKind(value: unknown): TelegramChatKind | undefined {
  return value === 'group' || value === 'supergroup' || value === 'channel' ? value : undefined;
}
