import { storedMcpAccess } from '../../../../../shared/mcpFlowStep';
import { splitSymbols } from '../../../../../shared/flowListTerms';
import { cut, flagged, isHttpUrl, list, middle, num, parts, shortUrl, someOf, t, unset, value, wholeRef } from './core';
import { looksLikeId } from './feeds';
import { named } from './web';
import type { StepSummaryContext, Summarizer } from './types';

const GMAP_SORTS = new Set(['mixed', 'relevant', 'newest', 'highest', 'lowest']);

/** A place by its name when the URL carries one (`/place/<name>/`), else the address. */
function placeName(raw: string): string {
  if (wholeRef(raw)) return raw;
  const name = /\/place\/([^/@?]+)/.exec(raw)?.[1];
  if (name) {
    try {
      return decodeURIComponent(name.replace(/\+/g, ' '));
    } catch {
      return name;
    }
  }
  return shortUrl(raw);
}

const gmapReviews: Summarizer = (step, ctx) => {
  const url = value(step, 'url');
  if (!url) return unset(ctx, 'gmap_reviews', ['url']);
  const sort = GMAP_SORTS.has(value(step, 'sort')) ? value(step, 'sort') : 'mixed';
  const summary = named(step, ctx, placeName(url), parts(
    t(ctx, `flow.summary.gmap.sort.${sort}`),
    t(ctx, 'flow.summary.gmap.count', { count: num(ctx, Number(value(step, 'count') || '100')) }),
  ));
  return !url.includes('{{') && !isHttpUrl(url) ? flagged(summary, 'error', t(ctx, 'flow.summary.gmap.badUrl')) : summary;
};

/** A history window in words: `6mo` → 近 6 個月, `ytd` → 今年以來, `A..B` → A–B. */
export function periodName(ctx: StepSummaryContext, raw: string): string {
  if (!raw) return '';
  if (wholeRef(raw)) return raw;
  if (raw === 'ytd') return t(ctx, 'flow.summary.period.ytd');
  const relative = /^(\d+)(d|wk|mo|y)$/.exec(raw);
  if (relative) return t(ctx, `flow.summary.period.${relative[2]}`, { count: relative[1] });
  const span = /^(.+?)\.\.(.+)$/.exec(raw);
  if (span) return t(ctx, 'flow.summary.dateSpan', { from: span[1], to: span[2] });
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return t(ctx, 'flow.summary.period.since', { date: raw });
  return raw;
}

const stock: Summarizer = (step, ctx) => {
  const raw = value(step, 'symbol');
  if (!raw) return unset(ctx, 'stock', ['symbol']);
  const symbols = splitSymbols(raw);
  const period = periodName(ctx, value(step, 'period'));
  const date = value(step, 'date');
  const shown = symbols.length > 3 ? someOf(ctx, symbols, 'symbols', 3) : list(ctx, symbols);
  const second = parts(
    symbols.length > 1 ? t(ctx, 'flow.summary.stock.count', { count: symbols.length }) : undefined,
    date ? t(ctx, 'flow.summary.onDate', { date }) : undefined,
    symbols.length === 1 && !period && !date ? t(ctx, 'flow.summary.stock.live') : undefined,
  );
  return named(step, ctx, parts(shown, period) ?? shown, second);
};

const CURRENCY = /^[A-Za-z]{3}$/;

const forex: Summarizer = (step, ctx) => {
  const base = value(step, 'base') || 'USD';
  const target = value(step, 'target');
  if (!target) return unset(ctx, 'forex', ['target'], `${base.toUpperCase()} → ?`);
  const amount = Number(value(step, 'amount'));
  const pair = `${base.toUpperCase()} → ${target.toUpperCase()}`;
  const what = value(step, 'amount') && Number.isFinite(amount) ? `${num(ctx, amount, 4)} ${pair}` : pair;
  const period = periodName(ctx, value(step, 'period'));
  const date = value(step, 'date');
  const summary = named(step, ctx, parts(what, period) ?? what, parts(
    date ? t(ctx, 'flow.summary.onDate', { date }) : !period ? t(ctx, 'flow.summary.forex.live') : undefined,
    t(ctx, 'flow.summary.forex.precision', { count: value(step, 'precision') || '4' }),
  ));
  const bad = [base, target].some((code) => !wholeRef(code) && !CURRENCY.test(code));
  return bad ? flagged(summary, 'error', t(ctx, 'flow.summary.forex.badCode')) : summary;
};

function monthDay(date: string): string {
  const match = /^\d{4}-(\d{2})-(\d{2})$/.exec(date);
  return match ? `${Number(match[1])}/${Number(match[2])}` : date;
}

/** When a weather step looks: 現在, 明天, 3 天後, 10/31–11/1, with its hour window. */
function weatherWhen(ctx: StepSummaryContext, date: string, hours: string): { text: string; readable: boolean } {
  const withHours = (day: string): string => (hours ? t(ctx, 'flow.summary.weather.hours', { day, hours }) : day);
  if (!date) return { text: hours ? withHours(t(ctx, 'flow.summary.today')) : t(ctx, 'flow.summary.weather.now'), readable: true };
  if (wholeRef(date)) return { text: withHours(date), readable: true };
  if (date === 'tomorrow') return { text: withHours(t(ctx, 'flow.summary.tomorrow')), readable: true };
  const plus = /^\+(\d+)$/.exec(date);
  if (plus) return { text: withHours(t(ctx, 'flow.summary.daysLater', { count: plus[1] })), readable: true };
  const span = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(date);
  if (span) return { text: withHours(`${monthDay(span[1])}–${monthDay(span[2])}`), readable: true };
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return { text: withHours(monthDay(date)), readable: true };
  return { text: date, readable: false };
}

const weather: Summarizer = (step, ctx) => {
  const location = value(step, 'location');
  if (!location) return unset(ctx, 'weather', ['location']);
  const date = value(step, 'date');
  const hours = value(step, 'hours');
  const when = weatherWhen(ctx, date, hours);
  const shape = hours ? 'hourly' : date ? 'daily' : 'current';
  const summary = named(step, ctx, `${location} · ${when.text}`, parts(
    t(ctx, `flow.summary.weather.${shape}`),
    step.config.units === 'imperial' ? t(ctx, 'flow.summary.weather.imperial') : undefined,
  ));
  return when.readable ? summary : flagged(summary, 'error', t(ctx, 'flow.summary.weather.badDate', { date }));
};

const AIR_SOURCES = new Set(['auto', 'taiwan', 'global']);

const airQuality: Summarizer = (step, ctx) => {
  const location = value(step, 'location');
  if (!location) return unset(ctx, 'air_quality', ['location']);
  const source = AIR_SOURCES.has(value(step, 'source')) ? value(step, 'source') : 'auto';
  return named(step, ctx, location, t(ctx, `flow.summary.air.${source}`));
};

const almanac: Summarizer = (step, ctx) => {
  const date = value(step, 'date');
  const time = value(step, 'time');
  const activity = value(step, 'activity');
  const days = Number(value(step, 'days') || '1');
  const lunar = step.config.lunar === 'true';
  const day = !date ? t(ctx, 'flow.summary.today') : date === 'tomorrow' ? t(ctx, 'flow.summary.tomorrow') : date;
  const when = lunar && date ? t(ctx, 'flow.summary.almanac.lunar', { date }) : day;
  const span = days > 1 ? t(ctx, 'flow.summary.almanac.days', { from: when, count: days }) : when;
  const primary = activity
    ? t(ctx, 'flow.summary.almanac.pick', { activity, when: span })
    : time ? `${when} ${time}` : span;
  const zodiac = value(step, 'zodiac');
  const second = activity
    ? parts(zodiac ? t(ctx, 'flow.summary.almanac.avoid', { signs: zodiac }) : undefined, step.config.weekends === 'true' ? t(ctx, 'flow.summary.almanac.weekends') : undefined)
    : t(ctx, time ? 'flow.summary.almanac.hour' : days > 1 ? 'flow.summary.almanac.list' : 'flow.summary.almanac.day');
  const summary = named(step, ctx, primary, second);
  return time && !/^\d{1,2}:\d{2}$/.test(time) ? flagged(summary, 'error', t(ctx, 'flow.summary.almanac.badTime')) : summary;
};

/** An invoice period in words: `115-07` → 115 年 7–8 月. */
function invoicePeriod(ctx: StepSummaryContext, raw: string): string {
  if (!raw || raw === 'latest') return t(ctx, 'flow.summary.invoice.latest');
  if (raw === 'all') return t(ctx, 'flow.summary.invoice.all');
  const roc = /^(\d{3})-?(\d{2})$/.exec(raw);
  if (roc) {
    const month = Number(roc[2]);
    const start = month % 2 === 0 ? month - 1 : month;
    return t(ctx, 'flow.summary.invoice.period', { year: roc[1], from: start, to: start + 1 });
  }
  return raw;
}

/** Counted, never shown: receipt numbers are long, many, and the user's own business. */
const twInvoice: Summarizer = (step, ctx) => {
  const numbers = value(step, 'numbers');
  const period = value(step, 'period');
  if (!numbers) return named(step, ctx, t(ctx, 'flow.summary.invoice.winning', { period: invoicePeriod(ctx, period) }));
  if (wholeRef(numbers)) return named(step, ctx, t(ctx, 'flow.summary.invoice.checkRef', { ref: numbers }), period ? invoicePeriod(ctx, period) : undefined);
  const tokens = numbers.split(/[\s,，、]+/).filter(Boolean);
  const summary = named(step, ctx, t(ctx, 'flow.summary.invoice.check', { count: tokens.length }), period ? invoicePeriod(ctx, period) : t(ctx, 'flow.summary.invoice.claimable'));
  const bad = tokens.findIndex((token) => !/^([A-Za-z]{2}-?)?\d{8}$/.test(token) && !/^\d{3}$/.test(token));
  return bad >= 0 ? flagged(summary, 'error', t(ctx, 'flow.summary.invoice.badNumber', { number: bad + 1 })) : summary;
};

const calendar: Summarizer = (step, ctx) => {
  const id = value(step, 'calendar');
  const range = value(step, 'range') || 'today';
  const when = range === 'tomorrow'
    ? t(ctx, 'flow.summary.tomorrow')
    : range === 'days' ? t(ctx, 'flow.summary.calendar.days', { count: value(step, 'days') || '7' }) : t(ctx, 'flow.summary.today');
  const name = id ? ctx.lookup?.calendarName?.(id) : undefined;
  // A stored id is a hash: shown only through the name it stands for.
  const shown = !id ? t(ctx, 'flow.summary.calendar.all') : name ?? (looksLikeId(id) ? t(ctx, 'flow.summary.calendar.one') : id);
  const summary = named(step, ctx, `${shown} · ${when}`, t(ctx, 'flow.summary.calendar.max', { count: value(step, 'maxEvents') || '20' }));
  if (id && ctx.lookup?.calendarName && !name) {
    return flagged(summary, 'error', looksLikeId(id) ? t(ctx, 'flow.summary.calendar.goneUnnamed') : t(ctx, 'flow.summary.calendar.gone', { name: id }));
  }
  return summary;
};

const mailFetch: Summarizer = (step, ctx) => {
  const split = (raw: string): string[] => raw.split(/[,，]/).map((part) => part.trim()).filter(Boolean);
  const from = split(value(step, 'from'));
  const keywords = split(value(step, 'keywords'));
  const onlyNew = step.config.onlyNew !== 'false';
  const what = parts(
    from.length > 0 ? t(ctx, 'flow.summary.mail.from', { senders: someOf(ctx, from, 'senders') }) : undefined,
    keywords.length > 0 ? t(ctx, 'flow.summary.contains', { text: list(ctx, keywords) }) : undefined,
  ) ?? t(ctx, onlyNew ? 'flow.summary.mail.allNew' : 'flow.summary.mail.all');
  const summary = named(step, ctx, what, parts(
    onlyNew ? undefined : t(ctx, 'flow.summary.mail.everyTime'),
    value(step, 'account') || t(ctx, 'flow.summary.mail.allBoxes'),
    t(ctx, 'flow.summary.mail.days', { count: value(step, 'days') || '1' }),
    step.config.unreadOnly === 'true' ? t(ctx, 'flow.summary.mail.unread') : undefined,
    step.config.attachmentsOnly === 'true' ? t(ctx, 'flow.summary.mail.attachments') : undefined,
  ));
  const groups = Math.max(1, from.length) * Math.max(1, keywords.length);
  return groups > 12 ? flagged(summary, 'error', t(ctx, 'flow.summary.mail.tooMany')) : summary;
};

/** The first argument that reads another step (`query={{item.title}}`); a literal one may be a token. */
function keyArgument(raw: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    for (const [key, arg] of Object.entries(parsed)) {
      if (typeof arg === 'string' && wholeRef(arg)) return `${key}=${cut(arg, 32)}`;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function argumentsBroken(raw: string): boolean {
  if (!raw) return false;
  // `{{count}}` standing alone is filled in before the JSON is read.
  const filled = raw.replace(/\{\{[^{}]+\}\}/g, '0');
  try {
    const parsed: unknown = JSON.parse(filled);
    return !parsed || typeof parsed !== 'object' || Array.isArray(parsed);
  } catch {
    return true;
  }
}

const mcp: Summarizer = (step, ctx) => {
  const server = value(step, 'server');
  const tool = value(step, 'tool');
  if (!server) return unset(ctx, 'mcp', ['server']);
  const serverName = ctx.lookup?.mcpServerName?.(server) ?? server;
  if (!tool) return unset(ctx, 'mcp', ['tool'], serverName);
  const toolName = ctx.lookup?.mcpToolTitle?.(server, tool) ?? tool;
  const access = storedMcpAccess(step.config.access);
  const summary = named(step, ctx, `${serverName} · ${middle(toolName, 32)}`, parts(
    access ? t(ctx, `flow.summary.mcp.${access}`) : undefined,
    keyArgument(value(step, 'arguments')),
  ));
  return argumentsBroken(value(step, 'arguments')) ? flagged(summary, 'error', t(ctx, 'flow.summary.mcp.badArguments')) : summary;
};

export const LOOKUP_SUMMARIES = {
  gmap_reviews: gmapReviews, stock, forex, weather, air_quality: airQuality, almanac, tw_invoice: twInvoice,
  calendar, mail_fetch: mailFetch, mcp,
} as const;
