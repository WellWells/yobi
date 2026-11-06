/**
 * "Yobi" as the first word of a message: how people address the bot by name. LINE PC answers
 * only such lines in a chat with other people; on every platform a pasted link after the name is
 * still the pasted link.
 */

/**
 * "Yobi" (or "@Yobi") as the first word, in any case and in full-width letters (a CJK keyboard
 * types those): followed by anything but more of a Latin word, so "yobi你好" with no space is a
 * request and "Yobiko", "yobi-san" or "yobi2" are not.
 */
const WAKE_WORD = /^\s*[@＠]?[yｙ][oｏ][bｂ][iｉ](?![\p{Script=Latin}\p{Nd}_'’－-])[\s,，:：、]*/iu;

/** The request in a line addressed to Yobi ("Yobi，明天天氣？" → "明天天氣？"); null when it is not. */
export function addressedText(text: string): string | null {
  const match = WAKE_WORD.exec(text);
  return match ? text.slice(match[0].length).trim() : null;
}

/**
 * The text a pasted link is looked for in: without a "Yobi" it starts with, so "Yobi <link>" is
 * the link alone (its menu), as the link by itself is.
 */
export function linkRequestText(text: string): string {
  return addressedText(text) ?? text;
}
