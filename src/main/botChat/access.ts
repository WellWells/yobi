import { isBotCommandAdminOnly, isBotCommandAllowed } from '../../shared/botCommandAccess';
import type { BotCommandAccess } from '../../shared/botCommandAccess';
import type { BotBuiltinCommandKey } from '../../shared/types';

/**
 * The questions every platform's handlers ask before anything runs, each failing closed: an error
 * reading the grants refuses, and is logged once with the platform's tag. Ids are strings here;
 * a platform with numeric ids (Telegram) converts at its edge.
 */
export interface BotChatAccessDeps {
  logTag: string;
  onLog: (message: string) => void;
  isPairedUser: (userId: string) => boolean;
  canChat?: (chatId: string, userId: string) => Promise<boolean>;
  canUseBuiltin?: (key: BotBuiltinCommandKey, chatId: string, userId: string) => Promise<boolean>;
  canUseDownloader?: (chatId: string, userId: string) => Promise<boolean>;
  isFlowAdmin?: (chatId: string, userId: string) => Promise<boolean>;
}

export interface BotChatAccess {
  /** Whether this person may talk to the bot here. Without the check, pairing alone decides. */
  mayChat: (chatId: string, userId: string) => Promise<boolean>;
  /** Whether this account may type this built-in command here. Without the check, anyone may. */
  mayUseBuiltin: (key: BotBuiltinCommandKey, chatId: string, userId: string) => Promise<boolean>;
  /** Whether this account may run the downloader here. Without the check, `fallback` decides. */
  mayDownload: (chatId: string, userId: string) => Promise<boolean>;
  /** The owner (or an admin) in their own private chat. Without the check, nobody. */
  isFlowAdmin: (chatId: string, userId: string) => Promise<boolean>;
  /** A flow command's own allow list, or for one limited to admins who is asking and where. */
  mayRunFlowCommand: (command: BotCommandAccess, chatId: string, userId: string) => Promise<boolean>;
}

export function createBotChatAccess(
  deps: BotChatAccessDeps,
  /** Who may download when the platform gives no check: LINE lets anyone, Telegram paired accounts. */
  downloadFallback: (userId: string) => boolean = () => true,
): BotChatAccess {
  async function failClosed(userId: string, what: 'rights' | 'grants', ask: () => Promise<boolean>): Promise<boolean> {
    try {
      return await ask();
    } catch (err: unknown) {
      deps.onLog(`${deps.logTag} could not read the ${what} of ${userId}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  const isFlowAdmin = async (chatId: string, userId: string): Promise<boolean> => {
    const check = deps.isFlowAdmin;
    if (!check) return false;
    return failClosed(userId, 'grants', () => check(chatId, userId));
  };

  return {
    mayChat: async (chatId, userId) => {
      const check = deps.canChat;
      if (!check) return deps.isPairedUser(userId);
      return failClosed(userId, 'rights', () => check(chatId, userId));
    },
    mayUseBuiltin: async (key, chatId, userId) => {
      const check = deps.canUseBuiltin;
      if (!check) return true;
      return failClosed(userId, 'grants', () => check(key, chatId, userId));
    },
    mayDownload: async (chatId, userId) => {
      const check = deps.canUseDownloader;
      if (!check) return downloadFallback(userId);
      return failClosed(userId, 'grants', () => check(chatId, userId));
    },
    isFlowAdmin,
    mayRunFlowCommand: async (command, chatId, userId) => {
      if (!isBotCommandAdminOnly(command)) return isBotCommandAllowed(command, userId);
      if (!deps.isFlowAdmin) return false;
      return isBotCommandAllowed(command, userId, { admin: await isFlowAdmin(chatId, userId) });
    },
  };
}
