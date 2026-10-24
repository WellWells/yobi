/**
 * Who may manage the bot from LINE (groups, accounts, invites). LINE has no admin grant, so it is
 * the owner ("me"), still paired, in their own private chat — checked on every command and every
 * tap, failing closed when the owner mark cannot be read.
 */
export interface LineManagerCheck {
  isPairedUser: (userId: string) => boolean;
  /** The owner in their own private chat (`botFlowAdminAllowed`); absent = nobody. */
  isFlowAdmin?: (chatId: string, userId: string) => Promise<boolean>;
  onLog: (message: string) => void;
}

export async function isLineManager(event: { userId: string; chatId: string; chatKind: string }, check: LineManagerCheck): Promise<boolean> {
  if (event.chatKind !== 'user' || event.chatId !== event.userId || !check.isPairedUser(event.userId)) return false;
  try {
    return (await check.isFlowAdmin?.(event.chatId, event.userId)) === true;
  } catch (err: unknown) {
    check.onLog(`[line] could not read whether ${event.userId} is the owner: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}
