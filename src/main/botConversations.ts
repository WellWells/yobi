import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { writeFileAtomic } from './atomicWrite';
import { getFlowDataDir } from './flow/paths';
import { sendLog } from './helpers';
import { extractTurnMetas } from '../shared/conversationDoc';
import { isConversationId } from '../shared/conversationHistory';
import { conversationPathKey } from './conversationPaths';
import { conversationIdAt, resolveConversationPath } from './conversationIndex';
import type { BotPlatform } from '../shared/types';

/** Where a chat's conversation is, and its id so a file moved into a folder is found again. */
export interface BotSession {
  path: string;
  id?: string;
}

type SessionMap = Record<string, BotSession>;

let cache: SessionMap | null = null;
let writeChain: Promise<void> = Promise.resolve();

function storePath(): string {
  return path.join(getFlowDataDir(), 'bot-conversations.json');
}

/**
 * One saved value. Files written before ids kept a bare path string; both shapes load, and a value
 * of any other shape is dropped as before.
 */
export function parseBotSession(value: unknown): BotSession | null {
  if (typeof value === 'string') return value ? { path: value } : null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { path: filePath, id } = value as Record<string, unknown>;
  if (typeof filePath !== 'string' || !filePath) return null;
  return isConversationId(id) ? { path: filePath, id } : { path: filePath };
}

async function load(): Promise<SessionMap> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(storePath(), 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    const sessions: SessionMap = {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        const session = parseBotSession(value);
        if (session) sessions[key] = session;
      }
    }
    cache = sessions;
  } catch {
    cache = {};
  }
  return cache;
}

/** A value without an id stays the bare path older versions wrote. */
function storedValue(session: BotSession): string | BotSession {
  return session.id ? { path: session.path, id: session.id } : session.path;
}

function persist(): Promise<void> {
  const snapshot = Object.fromEntries(Object.entries(cache ?? {}).map(([key, session]) => [key, storedValue(session)]));
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
  const session = sessions[chatKey];
  if (!session) return null;
  // Moved into a folder (in Yobi or in Explorer/Finder): found again by its id.
  const conversationPath = await resolveConversationPath(session);
  let lastAt: number;
  try {
    if (!conversationPath) throw new Error('conversation file is gone');
    lastAt = await lastActivityAt(conversationPath);
  } catch {
    delete sessions[chatKey];
    await persist();
    return null;
  }
  if (conversationPath !== session.path) {
    sessions[chatKey] = { ...session, path: conversationPath };
    await persist();
  }
  if (now - lastAt < BOT_CONVERSATION_IDLE_MS) return conversationPath;
  // The entry stays until the new file replaces it: the private-chat keys double as the record of
  // who was once paired (collectPairedUserIdsFromKeys), and a reply that fails must not erase that.
  sendLog(`[Bot] ${chatKey} idle since ${new Date(lastAt).toISOString()} — starting a new conversation`);
  return null;
}

export async function setBotConversation(chatKey: string, conversationPath: string): Promise<void> {
  if (!chatKey || !conversationPath) return;
  const sessions = await load();
  const current = sessions[chatKey];
  const id = (await conversationIdAt(conversationPath)) ?? undefined;
  if (current?.path === conversationPath && current.id === id) return;
  sessions[chatKey] = id ? { path: conversationPath, id } : { path: conversationPath };
  await persist();
}

/**
 * Points every chat whose conversation was just moved at the file's new place. Keys are never
 * removed here: they double as the record of who was once paired.
 */
export async function repointBotConversations(
  moves: ReadonlyArray<{ from: string; to: string; id?: string }>,
): Promise<number> {
  if (moves.length === 0) return 0;
  const sessions = await load();
  const byOldPath = new Map(moves.map((move) => [conversationPathKey(move.from), move]));
  let changed = 0;
  for (const [key, session] of Object.entries(sessions)) {
    const move = byOldPath.get(conversationPathKey(session.path));
    if (!move) continue;
    const id = move.id ?? session.id;
    sessions[key] = id ? { path: move.to, id } : { path: move.to };
    changed += 1;
  }
  if (changed > 0) await persist();
  return changed;
}

export async function clearBotConversation(chatKey: string): Promise<boolean> {
  const sessions = await load();
  if (!sessions[chatKey]) return false;
  delete sessions[chatKey];
  await persist();
  return true;
}

/**
 * Every saved key: one per private chat and one per person per group. A group key is written for
 * anyone the group's grants let talk to the bot, paired or not, so only the private-chat keys say
 * anything about who once held a pairing (`collectPairedUserIdsFromKeys`).
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

/**
 * The accounts a private-chat key (chat id = user id) shows were once paired: only a paired account
 * gets a run in its private chat. A group key proves nothing — unpaired members get runs there
 * through the group's grants — so reading it as a pairing would re-pair strangers on the next start.
 */
export function collectPairedUserIdsFromKeys(keys: string[], platform: BotPlatform): number[] {
  const ids = new Set<number>();
  for (const key of keys) {
    const parsed = parseBotChatKey(key);
    if (!parsed || parsed.platform !== platform || parsed.chatId !== parsed.userId) continue;
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
