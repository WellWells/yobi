import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getFlowDataDir } from '../flow/paths';
import { sendLog } from '../helpers';
import type { BotPlatform } from '../../shared/types';
import {
  classifySendFailure,
  contactKey,
  describeContact,
  forgetContact,
  listContacts,
  listPairedContacts,
  normalizeContactMap,
  revokePairing,
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
 * Lives outside config.json on purpose. The pairing list inside config was wiped twice by a test run
 * writing to the dev config, and restoring an older backup would do the same — a second file in a
 * different lifecycle is the only thing that makes recovery survive losing the first one.
 */
let cache: BotContactMap | null = null;
let writeChain: Promise<void> = Promise.resolve();

function storePath(): string {
  return path.join(getFlowDataDir(), 'bot-directory.json');
}

async function load(): Promise<BotContactMap> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(storePath(), 'utf-8');
    cache = normalizeContactMap(JSON.parse(raw));
  } catch {
    cache = {};
  }
  return cache;
}

function persist(): Promise<void> {
  const snapshot = { ...(cache ?? {}) };
  writeChain = writeChain
    .then(async () => {
      const file = storePath();
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify(snapshot, null, 2), 'utf-8');
    })
    .catch((err: unknown) => {
      sendLog(`⚠️ [Bot] could not save the contact directory: ${err instanceof Error ? err.message : String(err)}`);
    });
  return writeChain;
}

export async function recordBotContact(input: BotContactInput): Promise<void> {
  const current = await load();
  const next = upsertContact(current, input, new Date().toISOString());
  if (next === current) return;
  cache = next;
  await persist();
}

export async function markBotUnreachable(
  platform: BotPlatform,
  kind: BotContactKind,
  id: string,
  reachability: BotReachability,
  lastError?: string,
): Promise<void> {
  const current = await load();
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
  const current = await load();
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
  const current = await load();
  const next = revokePairing(current, platform, id);
  if (next === current) return;
  cache = next;
  await persist();
}

export async function forgetBotChat(platform: BotPlatform, id: string): Promise<void> {
  const current = await load();
  const next = forgetContact(current, contactKey(platform, 'chat', id));
  if (next === current) return;
  cache = next;
  await persist();
}

export function __resetBotDirectoryCache(): void {
  cache = null;
  writeChain = Promise.resolve();
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 200);
  return String(err).slice(0, 200);
}
