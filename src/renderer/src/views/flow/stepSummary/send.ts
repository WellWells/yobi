import { botStepTargets, isRecipientId, namesEveryone, namesSelf, splitTargets } from '../../../../../shared/botRecipients';
import { isShareLinkFormat } from '../../../../../shared/shareFormat';
import { BOT_PLATFORMS, type BotPlatform } from '../../../../../shared/types';
import { cut, firstLine, flagged, lines, outputPart, parts, someOf, t, unset, value, wholeRef } from './core';
import { looksLikeId } from './feeds';
import { describeRef, sourceOf } from './refs';
import { named } from './web';
import type { StepSummaryContext, Summarizer } from './types';

function platformName(ctx: StepSummaryContext, raw: string): { name: string; platform: BotPlatform | null } {
  const platform = BOT_PLATFORMS.find((item) => item === raw) ?? null;
  if (platform) return { name: t(ctx, `flow.skill.bot.platform.${platform}`), platform };
  const ref = wholeRef(raw);
  if (ref) return { name: t(ctx, 'flow.summary.bot.platformVar', { name: describeRef(ref, ctx).text }), platform: null };
  return { name: t(ctx, 'flow.summary.bot.platformAuto'), platform: null };
}

/**
 * Recipients the way the recipient picker names them: 你自己, 所有已配對的人, a setting by its
 * name, a paired chat by its name. An ID never shows, only "清單外的聊天 N".
 */
function recipients(ctx: StepSummaryContext, platform: BotPlatform | null, raw: string): string {
  const tokens = splitTargets(raw);
  if (tokens.length === 0) return t(ctx, 'flow.summary.bot.everyone');
  let unknown = 0;
  const names = tokens.map((token) => {
    if (wholeRef(token) === 'bot.triggerChatId') return t(ctx, 'flow.summary.bot.triggerChat');
    const ref = wholeRef(token);
    if (ref) return describeRef(ref, ctx).text;
    if (namesSelf(token)) return t(ctx, 'flow.summary.bot.me');
    if (namesEveryone(token)) return t(ctx, 'flow.summary.bot.everyone');
    if (!(platform && isRecipientId(token, platform)) && !looksLikeId(token)) return token;
    const found = (platform ? [platform] : BOT_PLATFORMS).map((item) => ctx.lookup?.chatName?.(item, token)).find(Boolean);
    if (found) return found;
    unknown += 1;
    return t(ctx, 'flow.summary.chat.unknown.recipients', { number: unknown });
  });
  return someOf(ctx, names, 'recipients');
}

function attachmentLine(ctx: StepSummaryContext, raw: string): string | undefined {
  if (!raw) return undefined;
  const ref = wholeRef(raw);
  const from = ref ? describeRef(ref, ctx) : null;
  if (from?.resolved) return t(ctx, 'flow.summary.bot.attachmentFrom', { file: raw, source: from.text });
  return t(ctx, 'flow.summary.bot.attachment', { file: cut(raw, 32) });
}

const bot: Summarizer = (step, ctx) => {
  const { name, platform } = platformName(ctx, value(step, 'platform'));
  const who = `${name} → ${recipients(ctx, platform, botStepTargets(step.config))}`;
  const message = value(step, 'message');
  const attachment = value(step, 'attachment');
  if (!message && !attachment) return unset(ctx, 'bot', ['message'], who);
  const buttons = lines(value(step, 'buttons')).length;
  const choices = buttons > 0
    ? t(ctx, platform === 'line' || platform === 'lineSelf' ? 'flow.summary.bot.options' : 'flow.summary.bot.buttons', { count: buttons })
    : undefined;
  return named(step, ctx, who, parts(message ? firstLine(message, 40) : attachmentLine(ctx, attachment), choices));
};

const emailSend: Summarizer = (step, ctx) => {
  const to = value(step, 'to');
  const subject = value(step, 'subject');
  const from = t(ctx, 'flow.summary.email.from', { account: value(step, 'account') || t(ctx, 'flow.summary.email.defaultBox') });
  const absent = [to ? '' : 'to', subject ? '' : 'subject'].filter(Boolean);
  if (absent.length > 0) return unset(ctx, 'email_send', absent, from);
  const ref = wholeRef(to);
  const people = ref ? describeRef(ref, ctx).text : someOf(ctx, splitTargets(to), 'people', 1);
  const files = splitTargets(value(step, 'attachments').replace(/\r?\n/g, ',')).length;
  return named(step, ctx, t(ctx, 'flow.summary.email.to', { to: people, subject: cut(subject, 32) }), parts(
    from, files > 0 ? t(ctx, 'flow.summary.email.files', { count: files }) : undefined,
  ));
};

const notify: Summarizer = (step, ctx) => {
  const title = value(step, 'title');
  const body = value(step, 'body');
  if (!title && !body) return unset(ctx, 'notify', ['body']);
  // A body that is one reference reads as where it comes from ("← #2 讀取訂閱"), not as `{{article}}`.
  const bodyLine = !body ? undefined : wholeRef(body) ? sourceOf(ctx, body) ?? body : firstLine(body, 40);
  if (title) return named(step, ctx, cut(title, 40), bodyLine);
  return named(step, ctx, firstLine(body, 40), sourceOf(ctx, body));
};

const clipboard: Summarizer = (step, ctx) => {
  if (value(step, 'action') !== 'write') return named(step, ctx, t(ctx, 'flow.summary.clipboard.read'), outputPart(ctx, step));
  const text = value(step, 'text');
  if (!text) {
    return flagged(named(step, ctx, t(ctx, 'flow.summary.clipboard.writeEmpty')), 'warning', t(ctx, 'flow.summary.clipboard.clears'));
  }
  return named(step, ctx, t(ctx, 'flow.summary.clipboard.write', { text: firstLine(text, 32) }), sourceOf(ctx, text));
};

const EXPIRES = new Set(['5min', '10min', '1hour', '1day', '1week', '1month', '1year', 'never']);

/** The format as the form names it; a zipped one reads "PDF（已壓縮）", as the run result says. */
function formatName(ctx: StepSummaryContext, raw: string, zip: boolean): string {
  const zipped = zip || raw.startsWith('zip');
  const base = raw.replace(/^zip/, '') || 'pdf';
  const name = base === 'png' || base === 'webp' || base === 'pdf' ? base.toUpperCase() : base;
  return zipped ? t(ctx, 'flow.summary.share.zipped', { format: name }) : name;
}

function heading(content: string): string | null {
  const line = lines(content).find((item) => /^#{1,6}\s+/.test(item));
  return line ? cut(line.replace(/^#{1,6}\s+/, ''), 32) : null;
}

const share: Summarizer = (step, ctx) => {
  const format = value(step, 'format');
  const content = value(step, 'content');
  const link = isShareLinkFormat(format);
  const label = link ? t(ctx, 'flow.summary.share.link') : formatName(ctx, format, step.config.zip === 'true');
  if (!content) return unset(ctx, 'share', ['content'], label);
  if (link) {
    const expire = EXPIRES.has(value(step, 'expire')) ? value(step, 'expire') : 'default';
    return named(step, ctx, `${label} · ${t(ctx, `flow.summary.share.expire.${expire}`)}`, parts(
      step.config.burnAfterReading === 'true' ? t(ctx, 'flow.summary.share.burn') : undefined, outputPart(ctx, step),
    ));
  }
  const title = value(step, 'title') || heading(content) || sourceOf(ctx, content) || firstLine(content, 32);
  const filename = value(step, 'filename');
  return named(step, ctx, t(ctx, 'flow.summary.share.file', { format: label, title }), filename || outputPart(ctx, step));
};

export const SEND_SUMMARIES = { bot, email_send: emailSend, notify, clipboard, share } as const;
