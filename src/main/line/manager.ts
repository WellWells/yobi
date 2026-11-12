import { dailyAllowance } from '../botPermissions/dailyAllowance';

/**
 * Who may manage the bot from LINE (groups, accounts, invites): the owner ("me") or an account
 * with the admin grant, still paired, in their own private chat — checked on every command and
 * every tap, failing closed when the owner mark cannot be read. What each may change is the shared
 * account plan's (`accountAuthority`: only the owner touches admins and the owner-only grants).
 */
export interface LineManagerCheck {
  isPairedUser: (userId: string) => boolean;
  /** An admin in their own private chat (`botFlowAdminAllowed`); absent = nobody. */
  isFlowAdmin?: (chatId: string, userId: string) => Promise<boolean>;
  onLog: (message: string) => void;
}

export async function isLineManager(event: { userId: string; chatId: string; chatKind: string }, check: LineManagerCheck): Promise<boolean> {
  if (event.chatKind !== 'user' || event.chatId !== event.userId || !check.isPairedUser(event.userId)) return false;
  try {
    return (await check.isFlowAdmin?.(event.chatId, event.userId)) === true;
  } catch (err: unknown) {
    check.onLog(`[line] could not read whether ${event.userId} is an admin: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/**
 * How many cards LINE pushes to managers per local calendar day, across every manager and every
 * kind of card (a pairing request's, a joined group's). Each push costs the owner's monthly quota,
 * and with admins one request would be a push per admin; past this the desktop notification alone
 * tells the owner. Managers are asked owner first, so the owner is the last to go without.
 */
export const LINE_MANAGER_PUSHES_DAILY = 10;

const managerPushes = dailyAllowance(LINE_MANAGER_PUSHES_DAILY);

/** Takes one push to a manager from today's allowance; false when it is used up. */
export function takeLineManagerPush(now: Date = new Date()): boolean {
  return managerPushes.take(now);
}

export function __resetLineManagerPushes(): void {
  managerPushes.reset();
}
