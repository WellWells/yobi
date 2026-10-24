import type { Message } from 'grammy/types';
import type { AgentChatLine } from '../../shared/types';

/**
 * Kept per group for three days (the user's choice, 2026-10-17): long enough for a daily summary
 * to catch up on a day the computer was off. Saved through `GroupChatStore` so a restart loses
 * nothing; anything older is dropped from memory and disk alike.
 */
export const GROUP_CHAT_RETENTION_SECONDS = 3 * 24 * 60 * 60;
const MAX_PER_CHAT = 5_000;
const MAX_CHATS = 50;
const PRUNE_EVERY_MS = 60 * 60 * 1000;
const SAVE_DELAY_MS = 3_000;
/** A mention that replies to nothing is read against what was said just before it, not this morning. */
const UNREPLIED_WINDOW_SECONDS = 2 * 60 * 60;
/** "Sum up the chat above" means today's talk, not the three days the log keeps for the daily summary. */
const RECAP_WINDOW_SECONDS = 6 * 60 * 60;
const BEFORE_REPLIED = 6;
const AFTER_REPLIED = 12;
const UNREPLIED_LINES = 12;
const LINE_TEXT_MAX = 500;
const CONTEXT_CHARS_MAX = 3_000;
/**
 * "Sum up the chat above" is about the talk itself, so it gets all of it the window holds. The
 * engine trims it again, oldest first, to what the provider's prompt cap leaves.
 */
const RECAP_CHARS_MAX = 15_000;
const RECAP_BEFORE_REPLIED = 3;

/**
 * Words asking about the chat itself — sum it up, catch me up, what were they on about — rather
 * than about one message. A summary of something else ("summarise this article") does not count:
 * the verb needs the chat as its object, or nothing at all after it. Only a thing named right
 * after the verb counts as that something else; a thing later in the sentence ("everything I
 * missed during the movie", 「上面影片的討論總結一下」) leaves the request a recap.
 */
const ZH_THING = '(?:文章|影片|視頻|视频|連結|链接|網址|网址|網頁|网页|網站|网站|檔案|档案|文件|PDF|pdf|報告|报告|新聞|新闻|論文|论文|貼文|帖子)';
const ZH_YOUTUBE = '(?:\\s*(?:YouTube|youtube|YT|yt))?\\s*';
const ZH_SUMMARISE = '(?:統整|统整|總結|总结|摘要|整理|歸納|归纳|重點|重点|回顧|回顾|懶人包|懒人包|概括|彙整|汇整)';
/**
 * Talk, the group, the chat's own messages or a time window after the thing in the same clause
 * (「這篇文章引發的討論」「這部影片之前的訊息」「這篇文章和上面的訊息」「報告群」).
 */
const ZH_TALK_AHEAD = '(?:[^。！？!?，,]|[，,]\\s*(?=還有|还有|以及|和|跟)){0,12}(?:討論|讨论|對話|对话|聊天|(?<![給给幫帮讓让為为])大家|群|留言|回覆|回复|反應|反应|回應|回应|評論|评论|意見|意见|評價|评价|反饋|反馈|心得|看法|說法|说法|爭論|争论|之後|之后|以後|以后|後的|后的|後面|后面|下面|底下|下方|以來|以来|至今|到目前|之前|以前|前的|時(?![間间長长])|时(?![間间長长])|期間|期间|到現在|到现在|錯過|错过|漏掉|(?:上面|上方|前面|剛剛|剛才|刚刚|刚才|稍早)的?(?:訊息|消息))';
const ZH_ABOVE = '(?:上面|上方|前面|剛剛|剛才|刚刚|刚才)';
const ZH_THIS = '(?:(?:這|这|那)(?:個|个|篇|份|部|支|段|則|则|條|条|些)?)';
/** 「摘要這個影片…」「總結一下上面那篇文章」 — unless what is asked about is the talk over it. */
const ZH_POINTED_THING = `(?:一下|下)?${ZH_ABOVE}?${ZH_THIS}${ZH_YOUTUBE}${ZH_THING}(?!${ZH_TALK_AHEAD})`;
/**
 * 「影片(裡)的重點訊息」 is what the video says, not messages in the chat — but only with the thing
 * right after the verb (or 給我); after any other word it is the chat's messages that post or
 * mention it (「有附連結的訊息」「丟影片的訊息」「提到這份報告的訊息」).
 */
const ZH_CHAT_MESSAGES = `(?<!(?:^|${ZH_SUMMARISE}(?:一下|下)?|給我|给我)${ZH_ABOVE}?${ZH_THIS}?(?:今天|今日|昨天|最新)?${ZH_YOUTUBE}${ZH_THING}\\s*(?:裡|里|中|上|內|内)?的\\s*(?:重點|重点|重要|主要|核心|關鍵|关键|最新)?)(?:訊息|消息)`;
/**
 * "this PDF", "the latest YouTube video", "my report" — a thing the verb sums up instead of the
 * chat, unless the talk over it is what is asked about ("the website redesign discussion", "the
 * report feedback"). Plural "posts" are the chat's own messages.
 */
const EN_TALK = String.raw`(?:discussions?|chats?|channels?|groups?|rooms?|threads?|talks?|conversations?|convos?|comments?|replies|messages|debates?|arguments?|drama|reactions?|responses?|views|questions|reviews|feedback|updates?|progress|status|plans?|decisions?|opinions?|thoughts)(?![a-z])`;
const EN_PREPOSITION = String.raw`(?:for|to|in|on|at|from|into|with|by|about|of|via)(?![\w'’-])`;
/**
 * Words that cannot describe the thing: "summarize this as a report", "summarize this then email
 * it" — the report or email is what to make of the chat, not what to read.
 */
const EN_FUNCTION_WORD = String.raw`(?:and|or|but|n|as|like|then|than|so|also|too|if|when|while|before|after|until|since|because|once|unless|a|an|the|this|that|these|those|my|our|your|his|her|their|its|i|we|you|they|he|she|it|me|us|them|him|will|can|could|would|should|may|might|must|need|want|gonna|wanna|is|are|was|were|be|do|does|did|have|has|had|quick|quickly|briefly|now|here|there|again|just|only|asap|please|pls|plz|over|up|out)(?![\w'’-])`;
/** "the last few pages", "the previous page" — pages of the chat. */
const EN_PAGE = String.raw`(?<!(?:last|first|previous|prev|next|past|few|couple|several|earlier|\d+|two|three|four|five|six|seven|eight|nine|ten)\s+)pages?(?!\s+of\s+(?:the\s+|this\s+|our\s+)?(?:group\s+)?${EN_TALK})`;
const EN_THING = String.raw`(?:(?!${EN_TALK}|${EN_PREPOSITION}|${EN_FUNCTION_WORD})[\w'’-]+\s+){0,2}(?:(?:article|video|vid|clip|link|file|document|pdf|webpage|website|url|report|paper|doc|tweet|email|podcast|blog)s?|post|${EN_PAGE})(?![a-z-])(?!\s+(?:style|format)(?![a-z]))(?![\w'’/-]*(?:,?\s+(?!${EN_PREPOSITION})[\w'’/-]+){0,3}?,?\s+${EN_TALK})`;
const EN_URL = String.raw`(?:https?:\/\/|www\.)`;
const EN_CONTENT_OF = String.raw`(?:the\s+)?(?:contents?|gist|main\s+points|key\s+points|key\s+takeaways|takeaways|highlights|main\s+ideas?)\s+(?:of|from|in)\s+(?:this|that|the|these|my)\s+${EN_THING}`;
const RECAP_PHRASES: readonly RegExp[] = [
  new RegExp(`${ZH_SUMMARISE}(?!${ZH_POINTED_THING}).{0,12}(?:上面|上方|以上|前面|剛剛|剛才|刚刚|刚才|稍早|之前|這段|这段|大家|群組|群组|群裡|群里|對話|对话|聊天|討論|讨论|${ZH_CHAT_MESSAGES})`),
  /(?:上面|上方|以上|前面|剛剛|剛才|刚刚|刚才|稍早|大家|群組|群组|群裡|群里).{0,12}(?:統整|统整|總結|总结|摘要|整理|歸納|归纳|重點|重点|回顧|回顾|懶人包|懒人包|概括|彙整|汇整)/,
  /^(?:幫我|帮我|請|请)?(?:統整|统整|總結|总结|摘要|整理|歸納|归纳|彙整|汇整)(?:一下|下)?(?:重點|重点)?[。.!！?？]*$/,
  /(?:剛剛|剛才|刚刚|刚才|上面|前面|稍早|大家|他們|他们|你們|你们).{0,6}(?:在|有)?(?:聊|說|说|講|讲|討論|讨论|吵)(?:了)?(?:些)?(?:什麼|什么|啥|甚麼)/,
  // "List what was discussed", "how many people were in it", "what did they discuss" (2026-10-17:
  // 「逐一列出面討論的內容，幾個人討論」 — a typo for 上面 — matched nothing and was answered from
  // the bot's own earlier answers).
  /(?:列出|列一下|條列|条列|列舉|列举|整理出).{0,12}(?:討論|讨论|對話|对话|聊天|聊了|說了|说了)/,
  /(?:討論|讨论|聊)(?:了|過|过)?(?:的)?(?:什麼|什么|啥|甚麼|內容|内容|話題|话题|主題|主题)/,
  /(?:幾|几|多少)(?:個|个|位)?人(?:在|有)?(?:討論|讨论|聊|說話|说话|發言|发言|參與|参与)/,
  new RegExp(String.raw`(?<![a-z])(?:summari[sz]e|summary|recap|tl;?dr|catch me up)(?![a-z])(?!(?:\s*[:：]\s*|\s+)(?:(?:this|that|the|an?)\s+(?:article|page|video|link|post|file|document)|(?:of\s+)?(?:(?:this|that|the|an?|these|my)\s+(?:${EN_THING}|${EN_URL})|${EN_URL})|(?:on|for)\s+(?:this|that|these)\s+${EN_THING}|${EN_CONTENT_OF}|what\s+(?:this|that|the)\s+${EN_THING}\s+(?:says|said|is\s+about|was\s+about|argues|covers|claims)))`, 'i'),
  /what (?:did|have|were) (?:we|they|you guys|people|everyone) (?:been )?(?:talk|discuss|say|said|chat)/i,
];

export function asksAboutTheChat(text: string): boolean {
  const haystack = text.trim();
  return haystack !== '' && RECAP_PHRASES.some((pattern) => pattern.test(haystack));
}

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

/** "MM-DD HH:MM" on this computer's clock: the model can then say from when it saw the talk. */
function stampOf(seconds: number): string {
  const date = new Date(seconds * 1000);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Drops the oldest lines until the whole fits; the newest lines are nearest the request. */
function fitToBudget(lines: AgentChatLine[], budget: number): AgentChatLine[] {
  let total = lines.reduce((sum, line) => sum + line.from.length + line.text.length + 4, 0);
  let start = 0;
  while (total > budget && start < lines.length - 1) {
    total -= lines[start].from.length + lines[start].text.length + 4;
    start += 1;
  }
  return lines.slice(start);
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
      const log = (chats.get(message.chat.id)?.messages ?? []).filter((entry) => entry.id < message.message_id);
      const repliedId = message.reply_to_message?.forum_topic_created ? undefined : message.reply_to_message?.message_id;
      const at = repliedId === undefined ? -1 : log.findIndex((entry) => entry.id === repliedId);
      const picked = opts.recap
        ? at >= 0
          ? log.slice(Math.max(0, at - RECAP_BEFORE_REPLIED))
          : log.filter((entry) => entry.date >= message.date - RECAP_WINDOW_SECONDS)
        : at >= 0
          ? [...log.slice(Math.max(0, at - BEFORE_REPLIED), at + 1), ...log.slice(at + 1).slice(-AFTER_REPLIED)]
          : log.filter((entry) => entry.date >= message.date - UNREPLIED_WINDOW_SECONDS).slice(-UNREPLIED_LINES);
      // Anonymous admins and channel posters share one service-bot `from`; the chat they speak as tells them apart.
      const askerId = speakerId(message);
      return fitToBudget(picked.map((entry) => ({
        from: entry.from,
        text: entry.text,
        at: stampOf(entry.date),
        ...(askerId !== undefined && entry.fromId === askerId ? { asker: true as const } : {}),
        ...(entry.id === repliedId ? { replied: true as const } : {}),
      })), opts.recap ? RECAP_CHARS_MAX : CONTEXT_CHARS_MAX);
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
