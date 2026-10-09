import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { writeFileAtomic } from './atomicWrite';
import { getFlowDataDir } from './flow/paths';
import { sendLog } from './helpers';
import { extractTurnMetas } from '../shared/conversationDoc';
import type { BotPlatform } from '../shared/types';

type SessionMap = Record<string, string>;

let cache: SessionMap | null = null;
let writeChain: Promise<void> = Promise.resolve();

function storePath(): string {
  return path.join(getFlowDataDir(), 'bot-conversations.json');
}

async function load(): Promise<SessionMap> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(storePath(), 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    cache = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>)
          .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      )
      : {};
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
      await writeFileAtomic(file, JSON.stringify(snapshot, null, 2));
    })
    .catch((err: unknown) => {
      sendLog(`⚠️ [Bot] could not save conversation sessions: ${err instanceof Error ? err.message : String(err)}`);
    });
  return writeChain;
}

/**
 * A chat quiet this long starts a new conversation on its next message, as if `/new` had been sent.
 * The agent replays recent turns regardless of age; lasting facts belong in personal memory.
 */
export const BOT_CONVERSATION_IDLE_MS = 6 * 60 * 60_000;

/** When the conversation last had a turn: the newest turn's own time, else the file's. */
async function lastActivityAt(conversationPath: string): Promise<number> {
  const raw = await fs.readFile(conversationPath, 'utf-8');
  const stamp = extractTurnMetas(raw).at(-1)?.t;
  const parsed = stamp ? Date.parse(stamp) : Number.NaN;
  if (Number.isFinite(parsed)) return parsed;
  return (await fs.stat(conversationPath)).mtimeMs;
}

export async function getBotConversation(chatKey: string, now = Date.now()): Promise<string | null> {
  const sessions = await load();
  const conversationPath = sessions[chatKey];
  if (!conversationPath) return null;
  let lastAt: number;
  try {
    lastAt = await lastActivityAt(conversationPath);
  } catch {
    delete sessions[chatKey];
    await persist();
    return null;
  }
  if (now - lastAt < BOT_CONVERSATION_IDLE_MS) return conversationPath;
  // The entry stays until the new file replaces it: the keys double as the record of who was once
  // paired (listBotConversationKeys), and a reply that fails must not erase that.
  sendLog(`[Bot] ${chatKey} idle since ${new Date(lastAt).toISOString()} — starting a new conversation`);
  return null;
}

export async function setBotConversation(chatKey: string, conversationPath: string): Promise<void> {
  if (!chatKey || !conversationPath) return;
  const sessions = await load();
  if (sessions[chatKey] === conversationPath) return;
  sessions[chatKey] = conversationPath;
  await persist();
}

export async function clearBotConversation(chatKey: string): Promise<boolean> {
  const sessions = await load();
  if (!sessions[chatKey]) return false;
  delete sessions[chatKey];
  await persist();
  return true;
}

/**
 * A key only lands here after handleDirectMessage cleared isPairedUser, so the store is also the
 * only surviving record of which accounts once held a pairing.
 */
export async function listBotConversationKeys(): Promise<string[]> {
  return Object.keys(await load());
}

export function parseBotChatKey(
  key: string,
): { platform: string; chatId: string; userId: string } | null {
  const parts = key.split(':');
  if (parts.length !== 3) return null;
  const [platform, chatId, userId] = parts;
  if (!platform || !chatId || !userId) return null;
  return { platform, chatId, userId };
}

export function collectPairedUserIdsFromKeys(keys: string[], platform: BotPlatform): number[] {
  const ids = new Set<number>();
  for (const key of keys) {
    const parsed = parseBotChatKey(key);
    if (!parsed || parsed.platform !== platform) continue;
    const userId = Number(parsed.userId);
    if (!Number.isFinite(userId) || userId <= 0) continue;
    ids.add(userId);
  }
  return [...ids];
}

/**
 * Revoking a pairing has to drop the ledger entry too, or the next start would read it as proof of a
 * prior pairing and hand the access straight back.
 */
export async function clearBotConversationsForUser(platform: BotPlatform, userId: number): Promise<number> {
  const sessions = await load();
  const doomed = Object.keys(sessions).filter((key) => {
    const parsed = parseBotChatKey(key);
    return parsed?.platform === platform && Number(parsed.userId) === userId;
  });
  if (doomed.length === 0) return 0;
  for (const key of doomed) delete sessions[key];
  await persist();
  return doomed.length;
}

export function __resetBotConversationCache(): void {
  cache = null;
  writeChain = Promise.resolve();
}
