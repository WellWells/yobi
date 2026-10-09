/**
 * Who may run a flow's bot command, on top of the pairing check. A non-empty list narrows the
 * command to those ids; under the legacy reading an empty list means anyone paired.
 *
 * Ids are compared as strings: Telegram's are numeric and LINE's start with `U`, so one list can
 * hold both without a namespace prefix.
 */
export function normalizeAllowedUserIds(raw: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw ?? []) {
    const id = String(entry).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function isBotUserAllowed(allowedUserIds: readonly string[] | undefined, userId: string): boolean {
  const allowed = normalizeAllowedUserIds(allowedUserIds);
  if (allowed.length === 0) return true;
  return allowed.includes(String(userId).trim());
}

/**
 * Who a flow's bot command is open to: `all` is every paired account, `users` is exactly the
 * listed ids, and an empty `users` list is nobody. Explicit so that emptying a restricted list, or
 * importing one with stripped ids, never opens the command to everyone.
 */
export type BotCommandAccessMode = 'all' | 'users';

export const BOT_COMMAND_ACCESS_MODES: readonly BotCommandAccessMode[] = ['all', 'users'] as const;

export function isBotCommandAccessMode(value: unknown): value is BotCommandAccessMode {
  return value === 'all' || value === 'users';
}

/** The access fields of a trigger or a registered command, whichever name the caller uses. */
export interface BotCommandAccess {
  access?: BotCommandAccessMode;
  allowedUserIds?: readonly string[];
}

/**
 * The mode a command actually runs under. A trigger without the field is one written before it
 * existed, so it keeps the legacy reading: an empty list is everyone, a non-empty one is those ids.
 */
export function botCommandAccessMode(
  access: unknown,
  allowedUserIds: readonly string[] | undefined,
): BotCommandAccessMode {
  if (isBotCommandAccessMode(access)) return access;
  return normalizeAllowedUserIds(allowedUserIds).length > 0 ? 'users' : 'all';
}

/** True when only some accounts may run the command, so only their own chats list it. */
export function isBotCommandRestricted(command: BotCommandAccess): boolean {
  return botCommandAccessMode(command.access, command.allowedUserIds) === 'users';
}

/** May this account run the command? Pairing is checked separately; this only narrows it. */
export function isBotCommandAllowed(command: BotCommandAccess, userId: string): boolean {
  if (!isBotCommandRestricted(command)) return true;
  return normalizeAllowedUserIds(command.allowedUserIds).includes(String(userId).trim());
}

/** A command limited to listed accounts with nobody listed: it answers no one. */
export function isBotCommandClosed(command: BotCommandAccess): boolean {
  return isBotCommandRestricted(command) && normalizeAllowedUserIds(command.allowedUserIds).length === 0;
}

/** A trigger's access fields under the names the predicates read. */
export function botTriggerAccess(trigger: {
  botAccess?: BotCommandAccessMode;
  botAllowedUserIds?: readonly string[];
}): BotCommandAccess {
  return { access: trigger.botAccess, allowedUserIds: trigger.botAllowedUserIds };
}
