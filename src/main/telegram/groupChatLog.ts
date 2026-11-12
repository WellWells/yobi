import type { Message } from 'grammy/types';
import type { AgentChatLine } from '../../shared/types';
import { CHAT_CONTEXT_LIMITS, chatContextLines } from '../botChat/chatContextWindow';

/**
 * Kept per group for three days: long enough for a daily summary
 * to catch up on a day the computer was off. Saved through `GroupChatStore` so a restart loses
 * nothing; anything older is dropped from memory and disk alike.
 */
export const GROUP_CHAT_RETENTION_SECONDS = 3 * 24 * 60 * 60;
const MAX_PER_CHAT = 5_000;
const MAX_CHATS = 50;
const PRUNE_EVERY_MS = 60 * 60 * 1000;
const SAVE_DELAY_MS = 3_000;
/** One message's text as the log keeps it. */
const LINE_TEXT_MAX = CHAT_CONTEXT_LIMITS.lineTextMax;

// The recap rule and the talk's windows are every platform's; Telegram's callers keep this path.
export { asksAboutTheChat } from '../botChat/chatRecap';
export interface LoggedMessage {
  id: number;
  /** Telegram's epoch seconds. */
  date: number;
  fromId?: number;
  from: string;
  text: string;
}

export interface StoredGroup {
  id: number;
  title: string;
  messages: LoggedMessage[];
}

/** Where the log is kept between runs; `groupChatArchive.ts` is the file-backed one. */
export interface GroupChatStore {
  loadAll: () => Promise<StoredGroup[]>;
  save: (group: StoredGroup) => Promise<void>;
  remove: (id: number) => Promise<void>;
  removeAll: () => Promise<void>;
}

export interface GroupChatLog {
  /** A message (or its edit) seen in a group; anything else is ignored. */
  record: (message: Message) => void;
  /**
   * The talk around a message that addresses the bot, oldest first and without that message: the
   * messages around the one it replies to and everything after it, or, replying to nothing, the
   * last ones before it. A `recap` request gets the last six hours (from just before the replied
   * message, when there is one) up to a larger budget. Empty outside a group or when nothing was heard.
   */
  contextFor: (message: Message, options?: { recap?: boolean }) => AgentChatLine[];
  /** Resolves once what the store kept from earlier runs is back in memory. */
  ready: () => Promise<void>;
  /** The groups with anything kept, most recently active first. */
  groups: () => Array<{ id: number; title: string; count: number }>;
  /** One group's messages with `sinceSec <= date < untilSec`, oldest first. */
  messagesBetween: (chatId: number, sinceSec: number, untilSec: number) => LoggedMessage[];
  /** Writes every pending change now (the bot stopping, the app quitting). */
  flush: () => Promise<void>;
  /** Forgets everything, memory and store (factory reset). */
  wipe: () => Promise<void>;
}

function isGroup(message: Message): boolean {
  return message.chat.type === 'group' || message.chat.type === 'supergroup';
}

/** Who spoke: the chat an anonymous admin or a channel poster speaks as, else the person. */
function speakerId(message: Message): number | undefined {
  return message.sender_chat?.id ?? message.from?.id;
}

function senderName(message: Message): string {
  const person = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(' ');
  return (message.sender_chat?.title ?? person).trim();
}

function textOf(message: Message): string {
  const text = (message.text ?? message.caption ?? '').trim();
  const media = message.photo ? 'photo' : message.video ? 'video' : message.sticker ? 'sticker'
    : message.voice ? 'voice message' : message.document ? 'file' : '';
  if (!media) return text.slice(0, LINE_TEXT_MAX);
  return `[${media}]${text ? ` ${text.slice(0, LINE_TEXT_MAX)}` : ''}`;
}

interface ChatEntry {
  title: string;
  messages: LoggedMessage[];
}

export function createGroupChatLog(options: {
  store?: GroupChatStore;
  nowMs?: () => number;
  log?: (message: string) => void;
} = {}): GroupChatLog {
  const { store } = options;
  const nowMs = options.nowMs ?? Date.now;
  const report = options.log ?? (() => {});
  // Insertion order = least recently active first, so the oldest group is the one evicted.
  const chats = new Map<number, ChatEntry>();
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  const writes = new Map<number, Promise<void>>();
  let lastPrune = nowMs();
  let wiped = 0;

  const queue = (chatId: number, write: () => Promise<void>): Promise<void> => {
    const next = (writes.get(chatId) ?? Promise.resolve())
      .then(write)
      .catch((err: unknown) => report(`⚠️ [telegram] could not save the group log of ${chatId}: ${err instanceof Error ? err.message : String(err)}`));
    writes.set(chatId, next);
    return next;
  };

  const persist = (chatId: number): Promise<void> => {
    if (!store) return Promise.resolve();
    const generation = wiped;
    return queue(chatId, async () => {
      if (generation !== wiped) return;
      const entry = chats.get(chatId);
      if (!entry || entry.messages.length === 0) {
        await store.remove(chatId);
        return;
      }
      await store.save({ id: chatId, title: entry.title, messages: entry.messages.map((message) => ({ ...message })) });
    });
  };

  const scheduleSave = (chatId: number): void => {
    if (!store || timers.has(chatId)) return;
    timers.set(chatId, setTimeout(() => {
      timers.delete(chatId);
      void persist(chatId);
    }, SAVE_DELAY_MS));
  };

  const prune = (entry: ChatEntry): boolean => {
    const oldest = Math.floor(nowMs() / 1000) - GROUP_CHAT_RETENTION_SECONDS;
    const before = entry.messages.length;
    entry.messages = entry.messages.filter((message) => message.date >= oldest).slice(-MAX_PER_CHAT);
    return entry.messages.length !== before;
  };

  const pruneAll = (): void => {
    lastPrune = nowMs();
    for (const [chatId, entry] of chats) {
      if (!prune(entry)) continue;
      if (entry.messages.length === 0) chats.delete(chatId);
      scheduleSave(chatId);
    }
  };

  const merge = (group: StoredGroup): void => {
    const entry = chats.get(group.id) ?? { title: group.title, messages: [] };
    const known = new Set(entry.messages.map((message) => message.id));
    entry.messages = [...group.messages.filter((message) => !known.has(message.id)), ...entry.messages]
      .sort((a, b) => a.id - b.id);
    if (!entry.title) entry.title = group.title;
    if (!chats.has(group.id)) {
      // Loaded groups go in front: a message heard while loading made its group the newest.
      const rest = [...chats];
      chats.clear();
      chats.set(group.id, entry);
      for (const [id, other] of rest) chats.set(id, other);
    }
    if (prune(entry)) scheduleSave(group.id);
    if (entry.messages.length === 0) chats.delete(group.id);
  };

  const loading: Promise<void> = store
    ? store.loadAll()
      .then((groups) => {
        // The store returns file-name order. Each merged group goes to the front, so merging the
        // most recently active first leaves the least recently active at the front, next to evict.
        const lastDate = (group: StoredGroup): number => group.messages.reduce((latest, message) => Math.max(latest, message.date), 0);
        for (const group of [...groups].sort((a, b) => lastDate(b) - lastDate(a))) merge(group);
      })
      .catch((err: unknown) => report(`⚠️ [telegram] could not read the group log: ${err instanceof Error ? err.message : String(err)}`))
    : Promise.resolve();

  return {
    record: (message) => {
      // A bot never receives its own or other bots' messages; `is_bot` with a `sender_chat` is a
      // person speaking as the group (anonymous admin) or as their channel, and is kept.
      if (!isGroup(message) || (message.from?.is_bot && !message.sender_chat)) return;
      const text = textOf(message);
      if (!text) return;
      if (nowMs() - lastPrune > PRUNE_EVERY_MS) pruneAll();
      const chatId = message.chat.id;
      const entry = chats.get(chatId) ?? { title: '', messages: [] };
      chats.delete(chatId);
      chats.set(chatId, entry);
      const title = 'title' in message.chat ? message.chat.title : '';
      if (title) entry.title = title;
      const existing = entry.messages.find((logged) => logged.id === message.message_id);
      if (existing) {
        existing.text = text;
      } else {
        const speaker = speakerId(message);
        entry.messages.push({
          id: message.message_id,
          date: message.date,
          ...(speaker !== undefined ? { fromId: speaker } : {}),
          from: senderName(message),
          text,
        });
        entry.messages.sort((a, b) => a.id - b.id);
        prune(entry);
      }
      scheduleSave(chatId);
      while (chats.size > MAX_CHATS) {
        const evicted = chats.keys().next().value as number;
        chats.delete(evicted);
        void persist(evicted);
      }
    },

    contextFor: (message, opts = {}) => {
      if (!isGroup(message)) return [];
      const log = (chats.get(message.chat.id)?.messages ?? [])
        .filter((entry) => entry.id < message.message_id)
        .map((entry) => ({ id: entry.id, atMs: entry.date * 1_000, from: entry.from, text: entry.text, ...(entry.fromId !== undefined ? { fromId: entry.fromId } : {}) }));
      const repliedId = message.reply_to_message?.forum_topic_created ? undefined : message.reply_to_message?.message_id;
      // Anonymous admins and channel posters share one service-bot `from`; the chat they speak as tells them apart.
      const askerId = speakerId(message);
      return chatContextLines(log, {
        atMs: message.date * 1_000,
        ...(repliedId !== undefined ? { repliedId } : {}),
        ...(askerId !== undefined ? { askerId } : {}),
        ...(opts.recap ? { recap: true } : {}),
      });
    },

    ready: () => loading,

    groups: () => [...chats]
      .reverse()
      .filter(([, entry]) => entry.messages.length > 0)
      .map(([id, entry]) => ({ id, title: entry.title, count: entry.messages.length })),

    messagesBetween: (chatId, sinceSec, untilSec) => {
      const entry = chats.get(chatId);
      if (!entry) return [];
      if (prune(entry)) scheduleSave(chatId);
      return entry.messages.filter((message) => message.date >= sinceSec && message.date < untilSec)
        .map((message) => ({ ...message }));
    },

    flush: async () => {
      const pending = [...timers.keys()];
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      await Promise.all([...pending.map(persist), ...writes.values()]);
    },

    wipe: async () => {
      wiped += 1;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      chats.clear();
      await Promise.all(writes.values());
      await store?.removeAll();
    },
  };
}
