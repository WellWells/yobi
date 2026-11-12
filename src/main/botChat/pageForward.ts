/**
 * A page a bot forwards as it stands, written each platform's way. The conversation keeps the plain
 * message; folding and clipping happen only on the way out.
 */
import { LINE_TEXT_MAX } from '../../shared/botMessageLimits';
import { expandableQuote } from '../../shared/expandableQuote';
import { xAnalyzeInput } from '../../shared/linkSites/registry';
import type { BotPageForward } from '../../shared/types';
import { foldsInTelegram } from '../../shared/xMedia';
import { t } from '../i18n';

function withBody(forward: BotPageForward, body: string): string {
  return [forward.opening, body, forward.closing].filter(Boolean).join('\n\n');
}

export function pageForwardMessage(forward: BotPageForward): string {
  return withBody(forward, forward.body);
}

/** What the title and the link stay outside of, as under a forwarded post. */
export function pageForwardFolded(forward: BotPageForward): string {
  return foldsInTelegram(forward.body) ? withBody(forward, expandableQuote(forward.body.trim())) : pageForwardMessage(forward);
}

/** Discord and Slack split what they are given: a page of 80,000 characters would be dozens of messages. */
export const PAGE_FORWARD_CHAT_MAX = 6_000;

/** The start and a pointer to the page, when the whole will not do. */
function pageForwardWithin(forward: BotPageForward, strings: Record<string, string>, limit: number): string {
  const message = pageForwardMessage(forward);
  if (Array.from(message).length <= limit) return message;
  const notice = t(strings, 'bot.page.tooLong');
  const room = limit - Array.from(withBody(forward, notice)).length - 2;
  return withBody(forward, `${Array.from(forward.body).slice(0, Math.max(room, 0)).join('').trimEnd()}\n\n${notice}`);
}

/**
 * LINE takes one message and no file. `reserved` is what goes under it in the same message (LINE
 * PC's numbered menu).
 */
export function pageForwardForLine(forward: BotPageForward, strings: Record<string, string>, reserved = 0): string {
  return pageForwardWithin(forward, strings, LINE_TEXT_MAX - reserved);
}

export function pageForwardForChat(forward: BotPageForward, strings: Record<string, string>): string {
  return pageForwardWithin(forward, strings, PAGE_FORWARD_CHAT_MAX);
}

/** The analyze button: its label and the line it stands for. */
export function pageAnalyzeChoice(forward: BotPageForward, strings: Record<string, string>): { label: string; line: string } {
  return { label: t(strings, 'x.analyze.button'), line: xAnalyzeInput(forward.link) };
}
