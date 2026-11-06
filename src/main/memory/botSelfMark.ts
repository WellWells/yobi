/**
 * One bot account's "this is me" mark (the memory file's `botSelf`), changed inside the store's
 * lock: the other marks are whatever the file holds at write time, never a stale copy.
 */
import { botSelfFrom } from '../../shared/userMemory';
import type { UserMemoryBotSelf } from '../../shared/userMemory';
import type { BotPlatform } from '../../shared/types';
import { updateUserMemory } from './memoryStore';
import type { UserMemoryState } from './memoryState';

export function botSelfIdList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((value) => String(value ?? '').trim()).filter(Boolean))];
}

/** Marks or unmarks one account; `changed` is false when it already was as asked. */
export async function setBotSelfMark(
  platform: BotPlatform,
  userId: string,
  self: boolean,
): Promise<{ state: UserMemoryState; changed: boolean }> {
  const { state, result } = await updateUserMemory((current) => {
    const ids = botSelfIdList(current.botSelf?.[platform]);
    if (ids.includes(userId) === self) return null;
    const nextIds = self ? [...ids, userId] : ids.filter((id) => id !== userId);
    const botSelf: UserMemoryBotSelf = { ...botSelfFrom(current.botSelf, botSelfIdList), [platform]: nextIds };
    return { state: { ...current, botSelf }, result: true };
  });
  return { state, changed: result === true };
}
