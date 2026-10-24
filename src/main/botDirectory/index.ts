import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { writeFileAtomic } from '../atomicWrite';
import { getFlowDataDir } from '../flow/paths';
import { sendLog } from '../helpers';
import type { BotPlatform } from '../../shared/types';
import {
  classifySendFailure,
  clearPairingRequest,
  contactKey,
  describeContact,
  forgetContact,
  listContacts,
  listPairedContacts,
  markPairingCard,
  normalizeContactMap,
  recordUse,
  revokeAllPairings,
  revokePairing,
  setPairingRequest,
  setReachability,
  upsertContact,
  type BotContact,
  type BotContactInput,
  type BotContactKind,
  type BotContactMap,
  type BotReachability,
} from './state';

export * from './state';

/**
 * Lives outside config.json on purpose: a second file with its own lifecycle lets pairings survive a
 * config reset or the restore of an older backup.
 */
let cache: BotContactMap | null = null;
let writeChain: Promise<void> = Promise.resolve();

function storePath(): string {
  return path.join(getFlowDataDir(), 'bot-directory.json');
}

let loading: Promise<void> | null = null;

/**
 * Reads the file once; callers arriving while it is read wait for that one read, so a second read
 * landing late cannot replace a change made in between. Writers read `cache` again after the
 * await, never the value from before it.
 */
async function load(): Promise<BotContactMap> {
  if (cache) return cache;
  loading ??= (async () => {
    try {
      const raw = await fs.readFile(storePath(), 'utf-8');
      cache = normalizeContactMap(JSON.parse(raw));
    } catch {
      cache = {};
    }
  })().finally(() => { loading = null; });
  await loading;
  return cache ?? {};
}

function persist(): Promise<void> {
  const snapshot = { ...(cache ?? {}) };
  writeChain = writeChain
    .then(async () => {
      const file = storePath();
      await fs.mkdir(path.dirname(file), { recursive: true });
      await writeFileAtomic(file, JSON.stringify(snapshot, null, 2));
    })
    .catch((err: unknown) => {
      sendLog(`⚠️ [Bot] could not save the contact directory: ${err instanceof Error ? err.message : String(err)}`);
    });
  return writeChain;
}

export async function recordBotContact(input: BotContactInput): Promise<void> {
  await load();
  const current = cache ?? {};
  const next = upsertContact(current, input, new Date().toISOString());
  if (next === current) return;
  cache = next;
  await persist();
}

/** An unpaired person addressed the bot in `chatId`; recorded for the owner's "used the bot" list. */
export async function recordBotUse(input: Omit<BotContactInput, 'kind'>, chatId: string): Promise<void> {
  await load();
  const current = cache ?? {};
  cache = recordUse(current, { ...input, kind: 'user' }, chatId, new Date().toISOString());
  await persist();
}

/** An unpaired person asked in a private chat to use the bot; recorded with the time. */
export async function recordBotPairingRequest(input: Omit<BotContactInput, 'kind'>, now = new Date().toISOString()): Promise<void> {
  await load();
  const current = cache ?? {};
  const next = setPairingRequest(current, { ...input, kind: 'user' }, now);
  if (next === current) return;
  cache = next;
  await persist();
}

/** The managers got the card of this person's waiting request. */
export async function markBotPairingCardSent(platform: BotPlatform, id: string, now = new Date().toISOString()): Promise<void> {
  await load();
  const current = cache ?? {};
  const next = markPairingCard(current, platform, id, now);
  if (next === current) return;
  cache = next;
  await persist();
}

/** Drops a person's request to pair (they were paired or blocked); the entry stays. */
export async function clearBotPairingRequest(platform: BotPlatform, id: string): Promise<void> {
  await load();
  const current = cache ?? {};
  const next = clearPairingRequest(current, platform, id);
  if (next === current) return;
  cache = next;
  await persist();
}

/** One entry, or undefined when the directory never saw it. */
export async function findBotContact(platform: BotPlatform, kind: BotContactKind, id: string): Promise<BotContact | undefined> {
  await load();
  return (cache ?? {})[contactKey(platform, kind, id.trim())];
}

export async function markBotUnreachable(
  platform: BotPlatform,
  kind: BotContactKind,
  id: string,
  reachability: BotReachability,
  lastError?: string,
): Promise<void> {
  await load();
  const current = cache ?? {};
  const key = contactKey(platform, kind, id);
  const next = setReachability(current, key, reachability, new Date().toISOString(), lastError);
  if (next === current) return;
  cache = next;
  await persist();
  const entry = next[key];
  sendLog(`⚠️ [Bot] ${describeContact(entry)} (${id}) is unreachable: ${reachability}`);
}

export async function markBotReachable(
  platform: BotPlatform,
  kind: BotContactKind,
  id: string,
): Promise<void> {
  await load();
  const current = cache ?? {};
  const key = contactKey(platform, kind, id);
  const next = setReachability(current, key, 'ok', new Date().toISOString());
  if (next === current) return;
  cache = next;
  await persist();
}

/**
 * Wraps one send. A permanent refusal is recorded against the recipient; anything else is left
 * alone so a network blip never greys out a working chat.
 */
export async function trackBotSend<T>(
  platform: BotPlatform,
  kind: BotContactKind,
  id: string,
  send: () => Promise<T>,
): Promise<T> {
  try {
    const result = await send();
    await markBotReachable(platform, kind, id);
    return result;
  } catch (err: unknown) {
    const verdict = classifySendFailure(err);
    if (verdict !== 'transient') {
      await markBotUnreachable(platform, kind, id, verdict, describeError(err));
    }
    throw err;
  }
}

export async function listBotContacts(
  filter: { platform?: BotPlatform; kind?: BotContactKind } = {},
): Promise<BotContact[]> {
  return listContacts(await load(), filter);
}

export async function listBotPairedContacts(platform: BotPlatform): Promise<BotContact[]> {
  return listPairedContacts(await load(), platform);
}

export async function revokeBotPairing(platform: BotPlatform, id: string): Promise<void> {
  await load();
  const current = cache ?? {};
  const next = revokePairing(current, platform, id);
  if (next === current) return;
  cache = next;
  await persist();
}

export async function revokeAllBotPairings(): Promise<void> {
  await load();
  const current = cache ?? {};
  const next = revokeAllPairings(current);
  if (next === current) return;
  cache = next;
  await persist();
}

export async function forgetBotChat(platform: BotPlatform, id: string): Promise<void> {
  await load();
  const current = cache ?? {};
  const next = forgetContact(current, contactKey(platform, 'chat', id));
  if (next === current) return;
  cache = next;
  await persist();
}

export function __resetBotDirectoryCache(): void {
  cache = null;
  loading = null;
  writeChain = Promise.resolve();
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 200);
  return String(err).slice(0, 200);
}
