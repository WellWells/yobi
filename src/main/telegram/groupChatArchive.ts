import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { app } from 'electron';
import { writeFileAtomic } from '../atomicWrite';
import { sendLog } from '../helpers';
import { createGroupChatLog, type GroupChatLog, type GroupChatStore, type LoggedMessage, type StoredGroup } from './groupChatLog';

/**
 * Telegram group talk the bot heard, one file per group, for the @-mention context and the
 * `telegram_read` flow step. In userData, beside `agent-runs/`, not in the flow data folder: it is
 * other people's words, which nothing syncs, backs up or restores. Factory reset deletes it.
 */
export const GROUP_CHAT_DIR_NAME = 'telegram-groups';

export function groupChatDir(): string {
  return path.join(app.getPath('userData'), GROUP_CHAT_DIR_NAME);
}

const FILE_RE = /^-?\d+\.json$/;

function readMessage(value: unknown): LoggedMessage | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'number' || typeof raw.date !== 'number' || typeof raw.from !== 'string' || typeof raw.text !== 'string') return null;
  return {
    id: raw.id,
    date: raw.date,
    ...(typeof raw.fromId === 'number' ? { fromId: raw.fromId } : {}),
    from: raw.from,
    text: raw.text,
  };
}

/** A file is read, never trusted: a group whose file does not parse is skipped, not fatal. */
export function readStoredGroup(id: number, raw: string): StoredGroup | null {
  try {
    const parsed = JSON.parse(raw) as { title?: unknown; messages?: unknown };
    if (!Array.isArray(parsed.messages)) return null;
    return {
      id,
      title: typeof parsed.title === 'string' ? parsed.title : '',
      messages: parsed.messages.map(readMessage).filter((message): message is LoggedMessage => message !== null),
    };
  } catch {
    return null;
  }
}

export function fileGroupChatStore(dir: () => string = groupChatDir): GroupChatStore {
  const fileOf = (id: number): string => path.join(dir(), `${id}.json`);
  return {
    loadAll: async () => {
      let names: string[];
      try {
        names = await fs.readdir(dir());
      } catch {
        return [];
      }
      const groups = await Promise.all(names.filter((name) => FILE_RE.test(name)).map(async (name) => {
        const id = Number(name.slice(0, -'.json'.length));
        const raw = await fs.readFile(path.join(dir(), name), 'utf-8').catch(() => '');
        return raw ? readStoredGroup(id, raw) : null;
      }));
      return groups.filter((group): group is StoredGroup => group !== null);
    },
    save: async (group) => {
      await fs.mkdir(dir(), { recursive: true });
      await writeFileAtomic(fileOf(group.id), JSON.stringify({ title: group.title, messages: group.messages }));
    },
    remove: async (id) => {
      await fs.rm(fileOf(id), { force: true });
    },
    removeAll: async () => {
      await fs.rm(dir(), { recursive: true, force: true });
    },
  };
}

let shared: GroupChatLog | null = null;

/** The one log the bot records into and flows read from; created on first use. */
export function sharedGroupChatLog(): GroupChatLog {
  shared ??= createGroupChatLog({ store: fileGroupChatStore(), log: sendLog });
  return shared;
}

/** Factory reset: memory and disk, whether or not anything was loaded this run. */
export async function wipeGroupChatArchive(): Promise<void> {
  if (shared) await shared.wipe();
  await fs.rm(groupChatDir(), { recursive: true, force: true });
}
