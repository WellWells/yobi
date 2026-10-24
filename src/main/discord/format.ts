import { renderChatMarkdown, splitChatMessage, type ChatDialect } from '../botChat/chatMarkdown';

/** A Discord message's text limit. */
export const DISCORD_MESSAGE_MAX = 2_000;
/** Discord's limits on buttons: five to a row, five rows, an 80-character label. */
export const DISCORD_ROW_BUTTONS = 5;
export const DISCORD_ROWS = 5;
export const DISCORD_LABEL_MAX = 80;
/** Ten files to a message, and a free server's upload limit per file. */
export const DISCORD_FILES_MAX = 10;
export const DISCORD_FILE_MAX_BYTES = 10 * 1_024 * 1_024;

// Discord reads `\` before a markup character as the character itself.
const DISCORD_MARKUP = /([\\*_~`|>])/g;

export const DISCORD_DIALECT: ChatDialect = {
  bold: (text) => (text ? `**${text}**` : ''),
  italic: (text) => (text ? `*${text}*` : ''),
  strike: (text) => (text ? `~~${text}~~` : ''),
  code: (text) => (text.includes('`') ? `\`\` ${text} \`\`` : `\`${text}\``),
  link: (label, href) => `[${label.replace(/[[\]]/g, '')}](<${href}>)`,
  escape: (text) => text.replace(DISCORD_MARKUP, '\\$1'),
};

/** An answer as Discord messages: rendered for Discord, then split to its length limit. */
export function discordMessages(markdown: string): string[] {
  return splitChatMessage(renderChatMarkdown(markdown, DISCORD_DIALECT), DISCORD_MESSAGE_MAX);
}
