import { getBotGrants, setBotPermissions } from '../botPermissions';
import type { BotPairingProfileInput } from '../botChat/types';
import { setBotSelfMark } from '../memory';
import { announceSocketBotRuntime, pairSocketBotUserWithoutCode } from '../socketBotBridge';

/**
 * Pairs the LINE account the bot runs as — the user's own — the first time it connects, so there
 * is no code to send. It is
 * marked "me", which is every right but the ones that must be named, and given video previews,
 * which "me" leaves out (with downloads, which previews need should the mark not be written).
 * Shell stays a grant the user adds: it runs commands on this computer from a chat. An account
 * already paired keeps what the user made of it. Resolves whether it paired now.
 */
export async function pairLineSelfOwner(owner: BotPairingProfileInput): Promise<boolean> {
  if (!pairSocketBotUserWithoutCode('lineSelf', owner)) return false;
  setBotPermissions({ platform: 'lineSelf', userId: owner.userId, grants: [...getBotGrants('lineSelf', owner.userId), 'download', 'preview'] });
  try {
    await setBotSelfMark('lineSelf', owner.userId, true);
  } finally {
    announceSocketBotRuntime('lineSelf');
  }
  return true;
}
