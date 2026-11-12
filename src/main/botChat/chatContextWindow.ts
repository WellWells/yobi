/**
 * Which of a chat's messages go with a bot request as its group talk (`recentChat`), decided once
 * for every platform: Telegram reads its own group log, LINE PC reads LINE's database, and both
 * pick and trim the lines here so the windows and budgets live in one place.
 */
import type { AgentChatLine } from '../../shared/types';

/** The windows and budgets, also what a platform's own query needs to fetch enough rows. */
export const CHAT_CONTEXT_LIMITS = {
  /** A mention that replies to nothing is read against what was said just before it, not this morning. */
  unrepliedWindowMs: 2 * 60 * 60 * 1_000,
  /** "Sum up the chat above" means today's talk, not the days a log may keep. */
  recapWindowMs: 6 * 60 * 60 * 1_000,
  beforeReplied: 6,
  afterReplied: 12,
  unrepliedLines: 12,
  /** One message's text as the log keeps it. */
  lineTextMax: 500,
  contextCharsMax: 3_000,
  /**
   * "Sum up the chat above" is about the talk itself, so it gets all of it the window holds. The
   * engine trims it again, oldest first, to what the provider's prompt cap leaves.
   */
  recapCharsMax: 15_000,
  recapBeforeReplied: 3,
} as const;

/** One message of a chat, as a platform hands it in. */
export interface ChatTalkEntry {
  id: string | number;
  /** When it was sent, ms. */
  atMs: number;
  /** Who wrote it, to mark the asker's own lines. */
  fromId?: string | number;
  from: string;
  text: string;
}

/** The request the talk goes with. */
export interface ChatTalkRequest {
  atMs: number;
  /** The message it replies to, when that is one of the log's. */
  repliedId?: string | number;
  askerId?: string | number;
  /** The request is about the talk itself (`asksAboutTheChat`). */
  recap?: boolean;
}

/** "MM-DD HH:MM" on this computer's clock: the model can then say from when it saw the talk. */
export function chatStamp(ms: number): string {
  const date = new Date(ms);
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

/**
 * The talk around a request, oldest first, from `log` (the chat's messages before it, oldest
 * first): the messages around the one it replies to and the last ones after it, or, replying to
 * nothing, the last ones of the window before it. A recap gets the last six hours (from just
 * before the replied message, when there is one) up to a larger budget.
 */
export function chatContextLines(log: readonly ChatTalkEntry[], request: ChatTalkRequest): AgentChatLine[] {
  const limits = CHAT_CONTEXT_LIMITS;
  const at = request.repliedId === undefined ? -1 : log.findIndex((entry) => entry.id === request.repliedId);
  const picked = request.recap
    ? at >= 0
      ? log.slice(Math.max(0, at - limits.recapBeforeReplied))
      : log.filter((entry) => entry.atMs >= request.atMs - limits.recapWindowMs)
    : at >= 0
      ? [...log.slice(Math.max(0, at - limits.beforeReplied), at + 1), ...log.slice(at + 1).slice(-limits.afterReplied)]
      : log.filter((entry) => entry.atMs >= request.atMs - limits.unrepliedWindowMs).slice(-limits.unrepliedLines);
  const { askerId } = request;
  return fitToBudget(picked.map((entry) => ({
    from: entry.from,
    text: entry.text,
    at: chatStamp(entry.atMs),
    ...(askerId !== undefined && entry.fromId === askerId ? { asker: true as const } : {}),
    ...(at >= 0 && entry.id === request.repliedId ? { replied: true as const } : {}),
  })), request.recap ? limits.recapCharsMax : limits.contextCharsMax);
}
