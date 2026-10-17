import type { LinePairedUser, TelegramPairedUser, TelegramSettingsSnapshot } from '../../../shared/types';

type Translate = (key: string) => string;

/** The name fields every Telegram account record carries (paired users and directory contacts alike). */
type TelegramNamed = Pick<TelegramPairedUser, 'userId' | 'firstName' | 'lastName' | 'username'>;

function telegramName(user: TelegramNamed): string {
  return [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
}

/**
 * The one way a paired bot account is named in the app: the person's name, else their handle,
 * else their id. The paired lists, the flow pickers, the memory page and the "who can use"
 * captions all read this, so one account never shows under three spellings.
 */
export function telegramAccountLabel(user: TelegramNamed, t: Translate): string {
  const name = telegramName(user);
  if (name) return name;
  if (user.username) return `@${user.username}`;
  return t('settings.bot.account.id').replace('{{id}}', String(user.userId));
}

export function lineAccountLabel(user: LinePairedUser, t: Translate): string {
  const name = user.displayName?.trim();
  return name || t('settings.bot.account.id').replace('{{id}}', user.userId);
}

/** The handle shown next to a Telegram name, when the label is the name rather than the handle. */
export function telegramAccountHandle(user: TelegramNamed): string | null {
  return telegramName(user) && user.username ? `@${user.username}` : null;
}

/** The label with the handle appended, for pickers where two people may share a display name. */
export function telegramAccountChoiceLabel(user: TelegramNamed, t: Translate): string {
  const label = telegramAccountLabel(user, t);
  const handle = telegramAccountHandle(user);
  return handle ? `${label} (${handle})` : label;
}

/** Whether a Telegram record carries any name at all (a bare id is not worth showing as a name). */
export function telegramAccountHasName(user: TelegramNamed): boolean {
  return Boolean(telegramName(user) || user.username);
}

/**
 * Recipient ids the picker cannot offer as chips, named from the contact directory. Unpairing and
 * factory reset only take a contact's pairedAt, so a former account is still named here.
 */
export function namedTelegramRecipients(
  ids: string[],
  snapshot: Pick<TelegramSettingsSnapshot, 'contacts'>,
  t: Translate,
): Array<{ id: string; label: string }> {
  return ids.flatMap((id) => {
    const contact = snapshot.contacts.find((item) => item.kind === 'user' && item.id === id);
    if (!contact) return [];
    const user: TelegramNamed = {
      userId: Number(contact.id),
      firstName: contact.firstName,
      lastName: contact.lastName,
      username: contact.username,
    };
    return telegramAccountHasName(user) ? [{ id, label: telegramAccountChoiceLabel(user, t) }] : [];
  });
}
