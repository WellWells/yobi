/**
 * Someone who is not paired writes to the bot in a private chat: that is a request to use it. It is
 * kept on their contact-directory entry (`pairingRequestedAt`), so it survives a restart and the
 * settings page can list it, and a manager may pair them without a code. Groups never make one:
 * a group's own grants decide what people there get.
 *
 * Platform-neutral on purpose: each platform registers how it pairs an id (`registerBotPairer`,
 * from its setup), and asks here whether its managers should hear about a request.
 */
import { clearBotPairingRequest, findBotContact, markBotPairingCardSent, recordBotPairingRequest } from '../botDirectory';
import { sendWebNotification } from '../helpers';
import { getLangCache, t } from '../i18n';
import type { BotApprovePairingResult, BotSetBlockedResult } from '../../shared/botPermissions';
import { BOT_PLATFORMS, BOT_PLATFORM_NAMES, isBotPlatform } from '../../shared/types';
import type { BotContact, BotPlatform } from '../../shared/types';
import { isBotUserBlocked, isBotUserPaired } from './rights';
import { setBotUserBlocked } from './mutate';
import { dailyAllowance } from './dailyAllowance';

/** A request older than this is news again: the managers hear about it once more. */
export const PAIRING_REQUEST_RENEW_MS = 7 * 24 * 60 * 60 * 1_000;

/**
 * How many request cards a platform sends its managers per local calendar day. Over it, a request
 * is still recorded (settings lists it) but nobody is messaged — a LINE push costs quota.
 */
export const PAIRING_REQUEST_DAILY_CARDS: Readonly<Record<BotPlatform, number>> = { telegram: 20, line: 5, discord: 20, slack: 20 } as const;

/** Who asked, as the platform names them; the names can be anything the person typed. */
export interface BotPairingProfile {
  userId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
}

/** `alreadyPaired`: nothing to do (another manager was quicker); `failed`: nothing was paired. */
export type BotPairingOutcome = 'paired' | 'alreadyPaired' | 'failed';

/**
 * Pairs one id without a code, with every effect a code pairing has (default grants for an id not
 * paired before, the directory's `pairedAt`, the saved pairing, the broadcast, menus). Must be
 * idempotent: two managers may press at once.
 */
export type BotPairer = (profile: BotPairingProfile) => BotPairingOutcome | Promise<BotPairingOutcome>;

const pairers = new Map<BotPlatform, BotPairer>();
const cards = Object.fromEntries(
  BOT_PLATFORMS.map((platform) => [platform, dailyAllowance(PAIRING_REQUEST_DAILY_CARDS[platform])]),
) as Record<BotPlatform, ReturnType<typeof dailyAllowance>>;
let queue: Promise<unknown> = Promise.resolve();

/** A platform's setup says how it pairs an id; `null` takes it back (the bot is gone). */
export function registerBotPairer(platform: BotPlatform, pairer: BotPairer | null): void {
  if (pairer) pairers.set(platform, pairer);
  else pairers.delete(platform);
}

/** Whether a directory entry is a request still waiting for an answer. */
export function isPairingRequestWaiting(contact: Pick<BotContact, 'pairingRequestedAt'> | undefined, state: { paired: boolean; blocked: boolean }): boolean {
  return Boolean(contact?.pairingRequestedAt) && !state.paired && !state.blocked;
}

function displayName(profile: BotPairingProfile): string {
  const full = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();
  if (full) return full;
  return profile.username ? `@${profile.username}` : `ID ${profile.userId}`;
}

function notifyDesktop(platform: BotPlatform, profile: BotPairingProfile): void {
  const strings = getLangCache();
  sendWebNotification(
    t(strings, 'bot.pairingRequest.notify.title'),
    t(strings, 'bot.pairingRequest.notify.body', { platform: BOT_PLATFORM_NAMES[platform], name: displayName(profile) }),
    'info',
    { id: 'open-bot-settings', label: t(strings, 'bot.group.notify.action') },
  );
}

/** One at a time, so a burst of messages from one person is one request, not several. */
function serial<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => undefined);
  return run;
}

/**
 * An unpaired person wrote in a private chat. Records the request (once, or again when the stored
 * one is older than a week) and returns whether the managers should get its card: never for
 * someone blocked or paired, at most `PAIRING_REQUEST_DAILY_CARDS` a day, and once per request —
 * one recorded while the day's allowance was used up (no `pairingCardAt`) gets its card on that
 * person's next message once there is allowance again. A card comes with one desktop notification.
 */
export function noteBotPairingRequest(platform: BotPlatform, profile: BotPairingProfile, now: Date = new Date()): Promise<boolean> {
  return serial(async () => {
    const id = String(profile.userId ?? '').trim();
    if (!id || isBotUserBlocked(platform, id) || isBotUserPaired(platform, id)) return false;
    const existing = await findBotContact(platform, 'user', id);
    const since = Date.parse(existing?.pairingRequestedAt ?? '');
    const waiting = Number.isFinite(since) && now.getTime() - since < PAIRING_REQUEST_RENEW_MS;
    if (waiting && existing?.pairingCardAt) return false;
    if (!waiting) {
      await recordBotPairingRequest({
        platform,
        id,
        ...(profile.username ? { username: profile.username } : {}),
        ...(profile.firstName ? { firstName: profile.firstName } : {}),
        ...(profile.lastName ? { lastName: profile.lastName } : {}),
      }, now.toISOString());
    }
    if (!cards[platform].take(now)) return false;
    await markBotPairingCardSent(platform, id, now.toISOString());
    notifyDesktop(platform, { ...profile, userId: id });
    return true;
  });
}

/** The request still waiting from this person, or null (none, answered, paired, blocked). */
export async function waitingBotPairingRequest(platform: BotPlatform, userId: string): Promise<BotContact | null> {
  const id = String(userId ?? '').trim();
  if (!id) return null;
  const contact = await findBotContact(platform, 'user', id);
  const waiting = isPairingRequestWaiting(contact, { paired: isBotUserPaired(platform, id), blocked: isBotUserBlocked(platform, id) });
  return waiting && contact ? contact : null;
}

const USER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function readRequest(request: unknown): { platform: BotPlatform; userId: string } | null {
  const body = (request && typeof request === 'object') ? request as Record<string, unknown> : {};
  const { platform } = body;
  if (typeof platform !== 'string' || !isBotPlatform(platform)) return null;
  const raw = typeof body.userId === 'number' && Number.isSafeInteger(body.userId) ? String(body.userId) : body.userId;
  const userId = typeof raw === 'string' ? raw.trim() : '';
  if (!USER_ID_PATTERN.test(userId)) return null;
  if (platform === 'telegram' && !/^\d{1,20}$/.test(userId)) return null;
  return { platform, userId };
}

/**
 * Pairs, without a code, someone whose request is waiting — the settings page's "Allow" and a
 * manager's button. Strict like the other bot requests. Already paired = done (two managers
 * pressed at once); blocked, or no request on file = refused.
 */
export async function approveBotPairingRequest(request: unknown): Promise<BotApprovePairingResult> {
  const target = readRequest(request);
  if (!target) return { ok: false, reason: 'invalidRequest' };
  const { platform, userId } = target;
  if (isBotUserPaired(platform, userId)) return { ok: true, newlyPaired: false };
  if (isBotUserBlocked(platform, userId)) return { ok: false, reason: 'blocked' };
  const contact = await waitingBotPairingRequest(platform, userId);
  if (!contact) return { ok: false, reason: 'noRequest' };
  const pairer = pairers.get(platform);
  if (!pairer) return { ok: false, reason: 'unavailable' };
  let outcome: BotPairingOutcome;
  try {
    outcome = await pairer({
      userId,
      ...(contact.username ? { username: contact.username } : {}),
      ...(contact.firstName ? { firstName: contact.firstName } : {}),
      ...(contact.lastName ? { lastName: contact.lastName } : {}),
    });
  } catch {
    outcome = 'failed';
  }
  if (outcome === 'failed') return { ok: false, reason: 'unavailable' };
  await clearBotPairingRequest(platform, userId);
  return { ok: true, newlyPaired: outcome === 'paired' };
}

/**
 * Blocks or unblocks one person (`setBotUserBlocked`); blocking also answers their request, so
 * unblocking later and writing again is a new one.
 */
export async function setBotUserBlockedAnsweringRequest(request: unknown): Promise<BotSetBlockedResult> {
  const result = setBotUserBlocked(request);
  if (!result.ok || !result.blocked) return result;
  const { platform, userId } = request as { platform: BotPlatform; userId: unknown };
  await clearBotPairingRequest(platform, String(userId).trim()).catch(() => undefined);
  return result;
}

export function __resetPairingRequests(): void {
  pairers.clear();
  cards.telegram.reset();
  cards.line.reset();
  queue = Promise.resolve();
}
