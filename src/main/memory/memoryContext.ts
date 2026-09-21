import { config } from '../config';
import type { BotPlatform } from '../../shared/types';
import type { UserMemoryEntry } from '../../shared/userMemory';
import { memoryAccess } from './memoryRules';
import type { MemoryAccess, MemoryAccessContext } from './memoryRules';
import { loadUserMemory } from './memoryStore';
import type { UserMemoryState } from './memoryState';

/**
 * Marked as "me" in Settings AND still paired. Unpairing an account has to take its memory access
 * with it, without the user also remembering to untick it here.
 */
export function isBotSelfAccount(state: UserMemoryState, platform: BotPlatform, userId: string): boolean {
  const id = (userId ?? '').trim();
  if (!id || !state.botSelf[platform].includes(id)) return false;
  const paired = platform === 'telegram'
    ? config.telegram.pairing.pairedUsers.map((user) => String(user.userId))
    : config.line.pairing.pairedUsers.map((user) => user.userId);
  return paired.includes(id);
}

/**
 * A bot chat reaches the memory only from the user's own account in a private chat. Telegram and
 * LINE both give a private chat the user's own id as its chat id; a group or room never has it.
 */
export function botMemoryContext(
  state: UserMemoryState,
  platform: BotPlatform,
  chatId: string,
  userId: string,
): MemoryAccessContext {
  const privateChat = Boolean(chatId) && String(chatId) === String(userId);
  return { surface: 'bot', botSelfPrivate: privateChat && isBotSelfAccount(state, platform, String(userId)) };
}

/** `platform:chatId:userId`, the key bot conversations and agent runs are filed under. */
export function parseBotChatKey(chatKey: string): { platform: BotPlatform; chatId: string; userId: string } | null {
  const [platform, chatId, userId] = (chatKey ?? '').split(':');
  if ((platform !== 'telegram' && platform !== 'line') || !chatId || !userId) return null;
  return { platform, chatId, userId };
}

/** The memory context of a bot chat named by its chat key; an unreadable key reaches nothing. */
export async function botChatMemoryContext(chatKey: string): Promise<MemoryAccessContext> {
  const parsed = parseBotChatKey(chatKey);
  const state = parsed ? await loadUserMemory().catch(() => null) : null;
  if (!parsed || !state) return { surface: 'bot' };
  return botMemoryContext(state, parsed.platform, parsed.chatId, parsed.userId);
}

export interface ResolvedMemory {
  access: MemoryAccess;
  /** What this surface may show the model: empty when access is none. */
  entries: UserMemoryEntry[];
}

/** One read of the file per send, so access and the entries it shows cannot disagree. */
export async function resolveMemory(
  ctx: MemoryAccessContext | ((state: UserMemoryState) => MemoryAccessContext),
): Promise<ResolvedMemory> {
  const state = await loadUserMemory().catch(() => null);
  if (!state) return { access: 'none', entries: [] };
  const access = memoryAccess(state.enabled, typeof ctx === 'function' ? ctx(state) : ctx);
  return { access, entries: access === 'none' ? [] : state.entries };
}
