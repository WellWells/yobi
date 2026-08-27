import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getFlowDataDir } from './flow/paths';
import { sendLog } from './helpers';

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
      await fs.writeFile(file, JSON.stringify(snapshot, null, 2), 'utf-8');
    })
    .catch((err: unknown) => {
      sendLog(`⚠️ [Bot] could not save conversation sessions: ${err instanceof Error ? err.message : String(err)}`);
    });
  return writeChain;
}

export async function getBotConversation(chatKey: string): Promise<string | null> {
  const sessions = await load();
  const conversationPath = sessions[chatKey];
  if (!conversationPath) return null;
  try {
    await fs.access(conversationPath);
    return conversationPath;
  } catch {
    delete sessions[chatKey];
    await persist();
    return null;
  }
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

export function __resetBotConversationCache(): void {
  cache = null;
  writeChain = Promise.resolve();
}
