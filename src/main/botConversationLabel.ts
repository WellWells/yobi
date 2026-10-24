import { listBotContacts } from './botDirectory';
import { parseBotChatKey } from './botConversations';
import { config } from './config';
import { findBotPairedDisplayName } from './botChat/pairingState';
import { isBotPlatform } from '../shared/types';
import type { BotPlatform } from '../shared/types';

const PLATFORM_TAGS: Record<BotPlatform, string> = { telegram: 'tg', line: 'line', discord: 'discord', slack: 'slack' } as const;
const NAME_MAX = 40;

/** Characters Windows refuses in a file name, plus controls; trailing dots and spaces are refused too. */
function fileSafeName(raw: string): string {
  const cleaned = raw
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return [...cleaned].slice(0, NAME_MAX).join('').replace(/[. ]+$/, '');
}

/**
 * `tg-Alice`, `line-Bob`, `tg-Family group` — what a bot chat's conversation file is named
 * ahead of its timestamp, so the outputs folder says whose conversation each one is.
 */
export function botFileLabel(platform: string, name: string): string {
  const tag = PLATFORM_TAGS[platform as BotPlatform] ?? fileSafeName(platform);
  const safe = fileSafeName(name);
  return safe ? `${tag}-${safe}` : tag;
}

async function telegramName(kind: 'user' | 'chat', id: string): Promise<string> {
  const contact = (await listBotContacts({ platform: 'telegram', kind })).find((entry) => entry.id === id);
  if (!contact) return '';
  if (kind === 'chat') return contact.title || contact.username || '';
  return [contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.username || '';
}

async function chatName(platform: BotPlatform, group: boolean, chatId: string, userId: string): Promise<string> {
  try {
    if (platform === 'telegram') return await telegramName(group ? 'chat' : 'user', group ? chatId : userId);
    if (!group) return findBotPairedDisplayName(config[platform].pairing, userId) ?? '';
    // Platforms with string ids register a group's name in the directory when the bot first sees it.
    return (await listBotContacts({ platform, kind: 'chat' })).find((entry) => entry.id === chatId)?.title ?? '';
  } catch {
    // An unreadable directory only costs the file its name; the id stands in.
  }
  return '';
}

/** A private chat is named after the person, a group after the group; the id stands in for an unknown name. */
export async function botConversationFileLabel(chatKey: string): Promise<string> {
  const parsed = parseBotChatKey(chatKey);
  if (!parsed) return '';
  const { platform, chatId, userId } = parsed;
  if (!isBotPlatform(platform)) return '';
  const group = chatId !== userId;
  const name = await chatName(platform, group, chatId, userId);
  return botFileLabel(platform, name || (group ? chatId : userId));
}
