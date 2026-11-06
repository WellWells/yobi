/**
 * The notes line-cli prints on stderr, for the tools
 * to return beside their JSON (withNotes). The texts are line-cli's, with its flags and commands
 * named as this connector's tools and parameters (TOOL_WORDS), and without its `line: ` prefix.
 */

/** line-cli's flag and command words, as this connector's tools and parameters name them. */
export const TOOL_WORDS = {
  since: 'since',
  until: 'until',
  limit: 'limit',
  maxThreads: 'max_threads',
  offline: 'offline: true',
  limitChats: 'limit_chats',
  perChatLimit: 'per_chat_limit',
  ids: 'ids: true',
  read: 'line_get_history',
  around: 'line_read_around',
  search: 'line_search_messages',
  stats: 'line_get_stats',
  self: 'this tool',
} as const;

/** line-cli's `line read <chat_id>`. */
export function readCall(chatId: string): string {
  return `${TOOL_WORDS.read} with chat_id ${chatId}`;
}

/** Which chat a name resolved to, so a substring match that picked an unexpected chat is visible ('' = the arg was the chat_id). */
export function resolvedNote(arg: string, chat: { chat_id: string; type: string; name: string }): string {
  const a = arg.trim();
  return a === chat.chat_id ? '' : `note: resolved "${a}" -> ${chat.chat_id} (${chat.type}, ${chat.name})`;
}

/** A list that reached its limit, so the caller knows to page ('' = it did not). */
export function limitNote(n: number, limit: number, next: string): string {
  return n >= limit ? `note: returned ${n} = limit ${limit}, more may exist; ${next}` : '';
}

const BOUNDARY_REPEATS = ` (items in the boundary second repeat; dedupe by id, or for ${TOOL_WORDS.read} without ${TOOL_WORDS.ids} by sent_at, sender and content)`;

/**
 * limitNote for pages cut by sent_at. sent_at is second-precise, so when a full page sits in one
 * second, rerunning from that sent_at returns the same page; only a larger limit gets past it.
 */
export function pageNote(n: number, limit: number, first: string, last: string, next: string): string {
  if (n >= limit && first !== '' && first === last) {
    return `note: returned ${n} = limit ${limit}, all sent at ${first}; paging by sent_at cannot pass this second, rerun with a larger ${TOOL_WORDS.limit}`;
  }
  return limitNote(n, limit, next + BOUNDARY_REPEATS);
}
