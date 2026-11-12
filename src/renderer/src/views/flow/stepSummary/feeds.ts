import { isRecipientId } from '../../../../../shared/botRecipients';
import { BOT_PLATFORMS, type BotPlatform } from '../../../../../shared/types';
import { flagged, isHttpUrl, num, outputPart, parts, shortUrl, someOf, t, unset, value, wholeRef } from './core';
import { describeRef } from './refs';
import { named } from './web';
import type { StepSummaryContext, Summarizer } from './types';

/** A token that is an ID on some platform (a Telegram number, a LINE `C…`/`u…` hex id). */
export function looksLikeId(token: string): boolean {
  return BOT_PLATFORMS.some((platform) => isRecipientId(token, platform)) || /^-?\d{5,}$/.test(token) || /^[0-9a-f]{16,}$/i.test(token);
}

/** The flow setting a whole-field `{{var.x}}` names, with its current value. */
function settingOf(ctx: StepSummaryContext, raw: string): { name: string; value: string } | null {
  const ref = wholeRef(raw);
  if (!ref?.startsWith('var.')) return null;
  const variable = ctx.variables?.find((item) => item.key === ref.slice(4));
  return { name: variable?.label.trim() || ref.slice(4), value: variable?.value.trim() ?? '' };
}

const rss: Summarizer = (step, ctx) => {
  const url = value(step, 'url');
  if (!url) return unset(ctx, 'rss', ['url']);
  const setting = settingOf(ctx, url);
  if (setting) {
    const summary = named(step, ctx, setting.value ? shortUrl(setting.value) : setting.name, t(ctx, 'flow.summary.rss.setting', { name: setting.name }), { code: Boolean(setting.value) });
    return setting.value ? summary : flagged(summary, 'warning', t(ctx, 'flow.summary.issue.settingEmpty', { name: setting.name }));
  }
  const summary = named(step, ctx, wholeRef(url) ? url : shortUrl(url), outputPart(ctx, step), { code: true });
  return !wholeRef(url) && !isHttpUrl(url) ? flagged(summary, 'error', t(ctx, 'flow.summary.issue.badUrl')) : summary;
};

const ptt: Summarizer = (step, ctx) => {
  const board = value(step, 'board');
  if (!board) return unset(ctx, 'ptt_board', ['board']);
  const keyword = value(step, 'keyword');
  const mode = value(step, 'scoreMode');
  const score = value(step, 'score');
  const bar = mode === 'push' || mode === 'boo' ? t(ctx, `flow.summary.ptt.${mode}`, { score }) : undefined;
  const summary = named(step, ctx, parts(board, keyword ? t(ctx, 'flow.summary.quoted', { text: keyword }) : undefined, bar) ?? board, outputPart(ctx, step));
  const n = Number(score);
  if (bar && !wholeRef(score) && !(Number.isInteger(n) && n >= 1 && n <= 100)) return flagged(summary, 'error', t(ctx, 'flow.summary.ptt.badScore'));
  return summary;
};

/**
 * Chats by name, never by ID: a paired chat's name from the directory, a name typed as a name,
 * and an ID nobody has named only as how many of them there are.
 */
function chatNames(ctx: StepSummaryContext, platform: BotPlatform, tokens: readonly string[], noun: 'chats' | 'groups'): { text: string; unknown: number } {
  let unknown = 0;
  const names = tokens.map((token) => {
    const ref = wholeRef(token);
    if (ref) return describeRef(ref, ctx).text;
    if (!looksLikeId(token)) return token;
    const found = ctx.lookup?.chatName?.(platform, token);
    if (found) return found;
    unknown += 1;
    return t(ctx, `flow.summary.chat.unknown.${noun}`, { number: unknown });
  });
  return { text: someOf(ctx, names, noun), unknown };
}

const LINE_RANGES = new Set(['today', 'yesterday', 'last7d', 'last30d']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const lineRead: Summarizer = (step, ctx) => {
  const chat = value(step, 'chat');
  const tokens = chat.split(/[,，]/).map((token) => token.trim()).filter(Boolean);
  const range = value(step, 'range') || 'all';
  const since = value(step, 'since');
  const until = value(step, 'until');
  const source = tokens.length === 0 ? t(ctx, 'flow.summary.line.allChats') : chatNames(ctx, 'lineSelf', tokens, 'chats').text;
  const window = range === 'custom'
    ? t(ctx, 'flow.summary.dateSpan', { from: since || '…', to: until || '…' })
    : LINE_RANGES.has(range)
      ? t(ctx, `flow.skill.line_read.range.${range}`)
      : t(ctx, 'flow.summary.line.latest', { count: num(ctx, Number(value(step, 'limit') || '200')) });
  const keyword = value(step, 'query');
  const summary = named(step, ctx, parts(
    source, window,
    keyword ? t(ctx, 'flow.summary.contains', { text: keyword }) : undefined,
    step.config.sinceLastRun === 'true' ? t(ctx, 'flow.summary.line.newOnly') : undefined,
  ) ?? source, outputPart(ctx, step));
  if (range === 'custom' && !since && !until) return flagged(summary, 'error', t(ctx, 'flow.summary.line.noDates'));
  if (range === 'custom' && [since, until].some((date) => date && !DATE_RE.test(date))) return flagged(summary, 'error', t(ctx, 'flow.summary.issue.badDate'));
  return summary;
};

const TELEGRAM_RANGES = new Set(['last24h', 'today', 'yesterday', 'last3d']);

const telegramRead: Summarizer = (step, ctx) => {
  const tokens = value(step, 'chat').split(/[,，]/).map((token) => token.trim()).filter(Boolean);
  const range = TELEGRAM_RANGES.has(value(step, 'range')) ? value(step, 'range') : 'last24h';
  const chats = tokens.length === 0 ? null : chatNames(ctx, 'telegram', tokens, 'groups');
  const source = chats?.text ?? t(ctx, 'flow.summary.telegram.allGroups');
  const summary = named(step, ctx, parts(source, t(ctx, `flow.skill.telegram_read.range.${range}`)) ?? source, outputPart(ctx, step));
  return chats && chats.unknown > 0 ? flagged(summary, 'warning', t(ctx, 'flow.summary.telegram.unknownGroup')) : summary;
};

export const FEED_SUMMARIES = { rss, ptt_board: ptt, line_read: lineRead, telegram_read: telegramRead } as const;
