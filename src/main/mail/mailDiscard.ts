import type { MailFolder } from './mailBackend';

/**
 * The words the action gate reads in `move_to` to class a move as a delete: the tools' own role
 * names (trash, bin, junk, spam) and the common English and Chinese folder names. Folder names are
 * localized ("[Gmail]/ゴミ箱", "Papierkorb", "Корзина"), so this is never the only check: the mail
 * service refuses a move into the folder the server marks as the trash or spam whenever these words
 * do not name it, and the model has to say "trash" or "spam" for the gate to see it.
 */
const DISCARD_WORDS = /trash|bin|junk|spam|deleted|垃圾|已刪除|已删除/i;

/** Gmail's system labels for the trash and spam, as X-GM-LABELS spells them. */
const DISCARD_LABELS = /^\\(trash|spam|junk)$/i;

export function namesDiscardFolder(text: string): boolean {
  return DISCARD_WORDS.test(text);
}

/** The server's word, not the folder's name: RFC 6154 special-use (imapflow also maps localized names). */
export function isDiscardFolder(folder: MailFolder): boolean {
  return folder.specialUse === '\\Trash' || folder.specialUse === '\\Junk';
}

export function isDiscardLabel(label: string): boolean {
  return DISCARD_LABELS.test(label.trim());
}
