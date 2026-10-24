/**
 * The Telegram account changes the settings page and the bot's own `/users` and `/invite` both
 * make, written once so the two can never differ: unpairing (pairing, grants, conversations, the
 * directory's `pairedAt`, the "/" menus) and issuing or revoking a pairing code.
 */
import { IPC } from '../shared/types';
import type { PendingPairingCode } from '../shared/types';
import { config, saveConfig } from './config';
import { sendLog, sendToRenderer } from './helpers';
import { issuePairingCode, normalizePairingState, revokePairingCode, unpairUser } from './telegram';
import { clearBotConversationsForUser } from './botConversations';
import { revokeBotPairing } from './botDirectory';
import { dropBotPermissions } from './botPermissions';
import { getTelegramRuntimeSnapshot } from './telegramBridge';

/**
 * Unpairs one account with its grants and its bot conversations; the directory keeps its name.
 * `refreshMenus` rebuilds the "/" menus (a chat menu listing what only its grants allowed has to go).
 */
export async function unpairTelegramAccount(userId: number, refreshMenus: () => Promise<void>): Promise<boolean> {
  if (!Number.isSafeInteger(userId) || userId <= 0) return false;
  config.telegram.pairing = unpairUser(config.telegram.pairing, userId);
  dropBotPermissions('telegram', String(userId));
  saveConfig({ telegram: config.telegram });
  await clearBotConversationsForUser('telegram', userId);
  await revokeBotPairing('telegram', String(userId));
  sendToRenderer(IPC.TELEGRAM_RUNTIME, getTelegramRuntimeSnapshot());
  void refreshMenus().catch(() => undefined);
  return true;
}

/** A new pairing code in the one store the settings page lists. */
export function issueTelegramPairingCode(): { code: string; expiresAt: string } {
  const issued = issuePairingCode(config.telegram.pairing);
  config.telegram.pairing = issued.nextState;
  saveConfig({ telegram: config.telegram });
  sendLog(`Telegram pairing code generated (expires at ${issued.expiresAt})`);
  // The settings page lists the codes; one issued from Telegram shows there too.
  sendToRenderer(IPC.TELEGRAM_RUNTIME, getTelegramRuntimeSnapshot());
  return { code: issued.code, expiresAt: issued.expiresAt };
}

export function revokeTelegramPairingCode(code: string): void {
  config.telegram.pairing = revokePairingCode(config.telegram.pairing, code);
  saveConfig({ telegram: config.telegram });
  sendToRenderer(IPC.TELEGRAM_RUNTIME, getTelegramRuntimeSnapshot());
}

/** The codes still valid, expired ones pruned (and the prune saved) first. */
export function validTelegramPairingCodes(): PendingPairingCode[] {
  const pruned = normalizePairingState(config.telegram.pairing);
  if (pruned.pendingCodes.length !== config.telegram.pairing.pendingCodes.length) {
    config.telegram.pairing = pruned;
    saveConfig({ telegram: config.telegram });
  }
  return pruned.pendingCodes;
}
