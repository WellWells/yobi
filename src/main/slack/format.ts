import { renderChatMarkdown, splitChatMessage, type ChatDialect } from '../botChat/chatMarkdown';

/**
 * Slack keeps up to 40,000 characters of a message but asks for far fewer; a section block holds
 * 3,000. Pieces stay under the block's limit so a long answer reads as several messages, not one
 * cut off.
 */
export const SLACK_MESSAGE_MAX = 2_900;
/** Slack's limits on a button: 75 characters of label, 25 elements in an actions block. */
export const SLACK_LABEL_MAX = 75;
export const SLACK_BUTTONS_MAX = 25;
/** What Slack's free workspaces take per file is far more; the bot keeps to this so a send never hangs. */
export const SLACK_FILE_MAX_BYTES = 50 * 1_024 * 1_024;
export const SLACK_FILES_MAX = 10;

/** `&`, `<` and `>` are the only characters Slack asks to escape. */
function escapeSlack(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const SLACK_DIALECT: ChatDialect = {
  bold: (text) => (text ? `*${text}*` : ''),
  italic: (text) => (text ? `_${text}_` : ''),
  strike: (text) => (text ? `~${text}~` : ''),
  code: (text) => `\`${escapeSlack(text).replace(/`/g, 'ˋ')}\``,
  link: (label, href) => `<${href.replace(/[|>]/g, encodeURIComponent)}|${label.replace(/[|>]/g, ' ')}>`,
  escape: escapeSlack,
  escapeCode: escapeSlack,
};

/** An answer as Slack messages: rendered as mrkdwn, then split under a block's limit. */
export function slackMessages(markdown: string): string[] {
  return splitChatMessage(renderChatMarkdown(markdown, SLACK_DIALECT), SLACK_MESSAGE_MAX);
}
