import { loadUserMemory } from '../memory/memoryStore';
import type { UserMemoryState } from '../memory/memoryState';
import type { SignInUse } from '../flow/skills/readAccess';
import { computeBotFlowAdmin } from './rights';

/*
 * How far a run may read a pasted link with the site sign-ins in Settings (X, Instagram,
 * Facebook, bilibili). Those sessions are the owner's own accounts: what they show — a
 * friends-only post, a private account the owner follows, stories — is what the owner may see,
 * not what whoever pasted the link may. Decided once per run here; the steps only read the mark.
 *
 * - `full`: runs not started by a bot (anything started on this computer), and a bot message from
 *   an admin of the bot in their own private chat — the owner ("me", the memory file's `botSelf`)
 *   or a Telegram account with the `admin` grant, still paired: the same test as a flow command
 *   set to admins only (`computeBotFlowAdmin`).
 * - `others`: every other bot message — paired friends, unpaired strangers in an allowed group, an
 *   admin posting in a group (the group sees the reply). The sign-in may fetch the pasted post for
 *   them, which goes out whole unless its site marks it as shown to some people only; that one,
 *   and stories and profiles, are refused.
 * - `none`: a bot run whose sender cannot be told (a trigger missing a part, an unknown platform):
 *   a visitor's read and nothing else.
 */

/** Who sent the bot message a run was started for: the `bot.trigger*` variables of its context. */
export interface BotTrigger {
  platform: string;
  userId: string;
  chatId: string;
}

export function botTriggerOf(context: Readonly<Record<string, string>>): BotTrigger {
  return {
    platform: context['bot.triggerPlatform'] ?? '',
    userId: context['bot.triggerUserId'] ?? '',
    chatId: context['bot.triggerChatId'] ?? '',
  };
}

/**
 * A bot message's use of the sign-ins. `full` only for an admin (the owner, or a Telegram account
 * with the admin grant; still paired) in their own private chat; an unreadable memory file cannot
 * tell the owner, so only the admin grant counts then. Anyone else is `others`. A trigger missing
 * a part, or of an unknown platform, is nobody known: `none`.
 */
export function botSignInUse(state: UserMemoryState | null, trigger: BotTrigger): SignInUse {
  const { platform, userId, chatId } = trigger;
  if ((platform !== 'telegram' && platform !== 'line') || !userId || !chatId) return 'none';
  return computeBotFlowAdmin(state, platform, userId, chatId) ? 'full' : 'others';
}

/** For a run about to start: any run not started by a bot is `full`; a bot's, from the memory file and grants as they are now. */
export async function signInUseForRun(botRun: boolean, context: Readonly<Record<string, string>>): Promise<SignInUse> {
  if (!botRun) return 'full';
  const trigger = botTriggerOf(context);
  const state = await loadUserMemory().catch(() => null);
  return botSignInUse(state, trigger);
}
