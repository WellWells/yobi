/**
 * LINE PC chats by the shape of their id (no imports: permissions read it too). A 1:1 chat's id
 * is the other person's (`u` and 32 hex digits) — the user's own id is their Keep memo chat,
 * which the bot never uses; a group's starts with `c`.
 */
const DIRECT_CHAT_ID = /^u[0-9a-f]{32}$/u;

/** A 1:1 chat: the bot reads only the user's own "Yobi" lines there, never the other side. */
export function isLineDirectChat(chatId: string): boolean {
  return DIRECT_CHAT_ID.test(chatId);
}

export function isLineGroupChat(chatId: string): boolean {
  return chatId.startsWith('c');
}

/** A chat the bot answers in: a group or a 1:1 chat — never an open chat or a multi-person room. */
export function isLineSelfChat(chatId: string): boolean {
  return isLineGroupChat(chatId) || isLineDirectChat(chatId);
}
