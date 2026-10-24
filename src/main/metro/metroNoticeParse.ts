/**
 * Reading each metro operator's own announcement list. Pure functions over what the sites serve
 * (captures 2026-10-22, the evening every status banner still said 正常營運 while every list below
 * already carried typhoon 薔琵's service changes for 10/23):
 *
 * - Taipei Metro: 新聞稿 (`News.aspx?n=30CCEFD2A45592BF&sms=72544237BBE4C5F6`), the first tab of the
 *   home page's 最新消息 and where its 營運速報 go; a CCMS table, 20 rows a page, ROC dates
 *   ("115-10-22"), rows link `News_Content.aspx?…&s=<id>`.
 * - TYMC: 最新消息 (`_pages/news/11`), 10 `figure.listbox` a page with `.date` "2026/10/22" and
 *   `.subject`, linking `show-<id>-1.html` (a commented-out copy of each link sits beside it).
 *   Events have their own list (news/10).
 * - New Taipei Metro: 最新消息 (`/basic/?node=10003`), a card grid, 20 a page, date
 *   "2026-10-20" in `.entry-meta`, linking `?mode=detail&node=<id>`.
 * - Taichung MRT: two JSON lists behind its site, `Article/News` (最新消息: station and parking
 *   notices) and `Article/Draft` (新聞稿: the typhoon headway notice); rows `{ID, Title,
 *   CreateTime, Description}` (Description = the body as HTML); the site's list dates are
 *   `CreateTime` (2026-03-23 shown for one updated 03-24).
 * - KRTC: 重要公告 (`/Information/notice`) holds only notices still in force (two on 2026-10-22,
 *   the same two for any date range or page), so it can be empty; 新聞稿 (`/Information/news`)
 *   is the archive. Both are `.newsList li` with `<h3>` and "發布日期：2026-10-22".
 */
import { load } from 'cheerio';
import type { MetroOperator } from './metroTypes';

export interface MetroNotice {
  operator: MetroOperator;
  /** YYYY-MM-DD as the operator dates it (Taipei). */
  date: string;
  title: string;
  /** Absolute, on the operator's own host. */
  url: string;
  /** The text, when the list carries it (Taichung); the others' is on `url` (`parseNoticeBody`). */
  body?: string;
}

/**
 * Where each operator's notice page keeps the text (pages of 2026-10-22). A title says "營運模式"
 * and only the body says 直達車 cancelled and 普通車 every 15 minutes — what riders ask.
 */
const BODY_SELECTORS: Record<Exclude<MetroOperator, 'tmrt'>, string> = {
  trtc: '.area-essay .essay',
  tymc: '#print_area .editor',
  ntmetro: '#is-content',
  krtc: '#articleBox .pageWord',
};

/** HTML to one line of text, a space where a block or line break was. */
export function noticeText(html: string): string {
  const $ = load(html);
  $('script, style, img').remove();
  $('br, p, div, li, tr, h1, h2, h3, h4, h5, h6').before(' ').after(' ');
  return clean($.root().text());
}

/** The body text of one notice page; throws when the page has no body where the operator keeps it. */
export function parseNoticeBody(operator: MetroOperator, html: string): string {
  if (operator === 'tmrt') throw new Error('Taichung MRT notices carry their text in the list');
  const body = load(html)(BODY_SELECTORS[operator]).first();
  const text = body.length > 0 ? noticeText(body.html() ?? '') : '';
  if (!text) throw new Error(`${operator} notice page has no body at ${BODY_SELECTORS[operator]}`);
  return text;
}

export const TMRT_SITE = 'https://www.tmrt.com.tw/';

/** Which Taichung MRT list a row came from; each has its own public detail page. */
export type TmrtNoticeList = 'news' | 'draft';

const TMRT_DETAIL_PATH = { news: 'announcement/latest-news', draft: 'announcement/draft-news' } as const;

function clean(text: string | undefined): string {
  return (text ?? '').replace(/\s+/gu, ' ').trim();
}

/** "115-10-22", "2026/10/22", "2026-10-22T20:51", "發布日期：2026-10-22" → "2026-10-22"; undefined otherwise. */
export function noticeDate(text: string): string | undefined {
  const match = /(\d{2,4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})/u.exec(text);
  if (!match) return undefined;
  const raw = Number(match[1]);
  // ROC years are three digits (115 = 2026); AD years four.
  const year = raw < 1_911 ? raw + 1_911 : raw;
  const [month, day] = [Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The link made absolute; a link off the operator's host (a file server) points at the list instead. */
function ownUrl(href: string | undefined, listUrl: string): string {
  if (!href) return listUrl;
  try {
    const url = new URL(href, listUrl);
    if (url.hostname !== new URL(listUrl).hostname || !/^https?:$/u.test(url.protocol)) return listUrl;
    url.protocol = 'https:';
    url.hash = '';
    return url.toString();
  } catch {
    return listUrl;
  }
}

/** Newest first; same-day items keep the source's order (the list's own order is its newest first). */
export function newestFirst(list: readonly MetroNotice[]): MetroNotice[] {
  return list.map((notice, index) => ({ notice, index }))
    .sort((a, b) => (a.notice.date === b.notice.date ? a.index - b.index : a.notice.date < b.notice.date ? 1 : -1))
    .map(({ notice }) => notice);
}

interface RawItem {
  title: string;
  date: string;
  href?: string;
  body?: string;
}

function finish(operator: MetroOperator, items: readonly RawItem[], listUrl: string, what: string, mayBeEmpty = false): MetroNotice[] {
  const notices: MetroNotice[] = [];
  for (const item of items) {
    const date = noticeDate(item.date);
    // A row without a readable date or title is left out rather than dated by guess.
    if (!date || !item.title) continue;
    notices.push({ operator, date, title: item.title, url: ownUrl(item.href, listUrl), ...(item.body ? { body: item.body } : {}) });
  }
  if (notices.length === 0 && !mayBeEmpty) throw new Error(`${what} has no readable notices`);
  return newestFirst(notices);
}

export function parseTrtcNotices(html: string, listUrl: string): MetroNotice[] {
  const $ = load(html);
  const rows = $('.area-table table tbody tr');
  if (rows.length === 0) throw new Error('Taipei Metro news page has no list table');
  const items = rows.toArray().map((tr) => {
    const link = $(tr).find('td[data-title="標題"] a').first();
    return {
      title: clean(link.text()) || clean(link.attr('title')),
      date: clean($(tr).find('td[data-title="發布日期"]').text()),
      href: link.attr('href'),
    };
  });
  return finish('trtc', items, listUrl, 'Taipei Metro news list');
}

export function parseTymcNotices(html: string, listUrl: string): MetroNotice[] {
  const $ = load(html);
  const boxes = $('.newsbox figure.listbox');
  if (boxes.length === 0) throw new Error('TYMC news page has no news boxes');
  const items = boxes.toArray().map((box) => {
    const link = $(box).find('a[href]').first();
    return {
      title: clean($(box).find('.subject').first().text()) || clean(link.attr('title')),
      date: clean($(box).find('.date').first().text()),
      href: link.attr('href'),
    };
  });
  return finish('tymc', items, listUrl, 'TYMC news list');
}

export function parseNtmetroNotices(html: string, listUrl: string): MetroNotice[] {
  const $ = load(html);
  const entries = $('#posts .entry');
  if (entries.length === 0) throw new Error('New Taipei Metro news page has no entries');
  const items = entries.toArray().map((entry) => {
    const link = $(entry).find('.entry-title a').first();
    return {
      title: clean(link.text()) || clean(link.attr('title')),
      date: clean($(entry).find('.entry-meta li').first().text()),
      href: link.attr('href'),
    };
  });
  return finish('ntmetro', items, listUrl, 'New Taipei Metro news list');
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/** One page of `Article/News` or `Article/Draft`. */
export function parseTmrtNotices(json: unknown, list: TmrtNoticeList): MetroNotice[] {
  const rows = record(json).Rows;
  if (!Array.isArray(rows)) throw new Error(`Taichung MRT ${list} list has no rows`);
  const items = rows.map(record)
    .filter((row) => typeof row.ID === 'string' && typeof row.CreateTime === 'string')
    // CreateTime is the full timestamp: order by it before the day alone is kept.
    .sort((a, b) => String(b.CreateTime).localeCompare(String(a.CreateTime)))
    .map((row) => ({
      title: clean(typeof row.Title === 'string' ? row.Title : ''),
      date: String(row.CreateTime),
      href: `${TMRT_SITE}${TMRT_DETAIL_PATH[list]}/detail?id=${encodeURIComponent(String(row.ID))}`,
      body: typeof row.Description === 'string' ? noticeText(row.Description) : undefined,
    }));
  return finish('tmrt', items, `${TMRT_SITE}${TMRT_DETAIL_PATH[list]}`, `Taichung MRT ${list} list`);
}

/** KRTC 重要公告 (may be empty: it lists only notices in force) or 新聞稿. */
export function parseKrtcNotices(html: string, listUrl: string, mayBeEmpty = false): MetroNotice[] {
  const $ = load(html);
  const list = $('.newsList');
  if (list.length === 0) throw new Error('KRTC page has no news list');
  const items = list.find('li').toArray().map((li) => {
    const link = $(li).find('a[href]').first();
    return {
      title: clean($(li).find('h3').first().text()),
      date: clean($(li).find('.bot').first().text()),
      href: link.attr('href'),
    };
  });
  return finish('krtc', items, listUrl, 'KRTC list', mayBeEmpty);
}
