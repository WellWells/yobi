/**
 * Each metro operator's latest announcements, read from its own list. The status banners lag:
 * on 2026-10-22 every banner said 正常營運 while every operator had already posted typhoon
 * 薔琵's 10/23 service changes, so the status tool shows recent notices beside the banner — and,
 * for one operator, the start of each notice's text: the title alone said "營運模式" and the model
 * answered "依颱風動態滾動式調整" instead of 直達車 cancelled (live eval 2026-10-23).
 * Which list per operator and how it reads: `metroNoticeParse.ts`. Operators' sites only (no TDX).
 */
import { addDays } from '../rail/railTime';
import { browserHeaders, railJson, railText } from '../rail/railHttp';
import type { MetroDeps, MetroOperator } from './metroTypes';
import type { MetroNotice, TmrtNoticeList } from './metroNoticeParse';
import {
  TMRT_SITE, newestFirst, parseKrtcNotices, parseNoticeBody, parseNtmetroNotices, parseTmrtNotices, parseTrtcNotices, parseTymcNotices,
} from './metroNoticeParse';

export type { MetroNotice, TmrtNoticeList } from './metroNoticeParse';
export {
  noticeDate, noticeText, parseKrtcNotices, parseNoticeBody, parseNtmetroNotices, parseTmrtNotices, parseTrtcNotices, parseTymcNotices,
} from './metroNoticeParse';

export const MAX_NOTICES = 10;
const NOTICES_TTL_MS = 10 * 60_000;

export const TRTC_NEWS_URL = 'https://www.metro.taipei/News.aspx?n=30CCEFD2A45592BF&sms=72544237BBE4C5F6';
export const TYMC_NEWS_URL = 'https://www.tymetro.com.tw/tymetro-new/tw/_pages/news/11';
export const NTMETRO_NEWS_URL = 'https://www.ntmetro.com.tw/basic/?node=10003';
export const KRTC_NOTICE_URL = 'https://www.krtc.com.tw/Information/notice';
export const KRTC_NEWS_URL = 'https://www.krtc.com.tw/Information/news';

export function tmrtNoticeApi(list: TmrtNoticeList): string {
  return `${TMRT_SITE}api/public/Article/${list === 'news' ? 'News' : 'Draft'}?culture=tw&page=1&limit=${MAX_NOTICES}`;
}

/** The pages a rider can open to read each operator's list. */
export const NOTICE_LIST_PAGES: Record<MetroOperator, readonly string[]> = {
  trtc: [TRTC_NEWS_URL],
  tymc: [TYMC_NEWS_URL],
  ntmetro: [NTMETRO_NEWS_URL],
  tmrt: [`${TMRT_SITE}announcement/draft-news`, `${TMRT_SITE}announcement/latest-news`],
  krtc: [KRTC_NOTICE_URL, KRTC_NEWS_URL],
};

async function page(url: string, deps: MetroDeps): Promise<string> {
  return railText(deps.fetchFn, url, { headers: browserHeaders(url) }, deps.signal);
}

async function tmrtList(list: TmrtNoticeList, deps: MetroDeps): Promise<MetroNotice[]> {
  const url = tmrtNoticeApi(list);
  return parseTmrtNotices(await railJson(deps.fetchFn, url, { headers: browserHeaders(url, { Accept: 'application/json' }) }, deps.signal), list);
}

/** Every list the operator's notices come from, most rider-relevant first (it wins same-day ties). */
async function readLists(operator: MetroOperator, deps: MetroDeps): Promise<MetroNotice[][]> {
  switch (operator) {
    case 'trtc':
      return [parseTrtcNotices(await page(TRTC_NEWS_URL, deps), TRTC_NEWS_URL)];
    case 'tymc':
      return [parseTymcNotices(await page(TYMC_NEWS_URL, deps), TYMC_NEWS_URL)];
    case 'ntmetro':
      return [parseNtmetroNotices(await page(NTMETRO_NEWS_URL, deps), NTMETRO_NEWS_URL)];
    case 'tmrt':
      // 新聞稿 carries the service changes (typhoon headway), 最新消息 the station notices.
      return Promise.all([tmrtList('draft', deps), tmrtList('news', deps)]);
    case 'krtc': {
      // 重要公告 is only what is in force today (often nothing); 新聞稿 fills in the recent past.
      const [notice, news] = await Promise.all([page(KRTC_NOTICE_URL, deps), page(KRTC_NEWS_URL, deps)]);
      return [parseKrtcNotices(notice, KRTC_NOTICE_URL, true), parseKrtcNotices(news, KRTC_NEWS_URL)];
    }
  }
}

/** Lists joined newest first, a notice on two lists once, at most `MAX_NOTICES`. */
export function mergeNotices(lists: readonly (readonly MetroNotice[])[]): MetroNotice[] {
  const seen = new Set<string>();
  const joined = lists.flat().filter((notice) => {
    const key = `${notice.url}\n${notice.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return newestFirst(joined).slice(0, MAX_NOTICES);
}

/** The operator's latest announcements, newest first, ≤ 10; throws when a list cannot be read. */
export async function fetchNotices(operator: MetroOperator, deps: MetroDeps): Promise<MetroNotice[]> {
  return deps.memo(`notices-${operator}`, NOTICES_TTL_MS, async () => mergeNotices(await readLists(operator, deps)));
}

/** Enough for 2026-10-22's typhoon notices to say what changes (TYMC's 直達車 line is in its first 60). */
export const NOTICE_EXCERPT_MAX = 400;
const NOTICE_BODY_TTL_MS = 30 * 60_000;

/** The body without the title many pages repeat as its first line, cut at `NOTICE_EXCERPT_MAX`. */
export function noticeExcerpt(body: string, title: string): string {
  const text = body.startsWith(title) ? body.slice(title.length).trim() : body;
  return text.length > NOTICE_EXCERPT_MAX ? `${text.slice(0, NOTICE_EXCERPT_MAX - 1)}…` : text;
}

/** The start of one notice's text: Taichung's from its list, the others' from the notice's own page. */
export async function fetchNoticeExcerpt(notice: MetroNotice, deps: MetroDeps): Promise<string> {
  // A link that fell back to the list page has no body of its own to read.
  if (Object.values(NOTICE_LIST_PAGES).some((pages) => pages.includes(notice.url))) throw new Error('the notice has no page of its own');
  const body = notice.body ?? await deps.memo(`notice-body-${notice.url}`, NOTICE_BODY_TTL_MS,
    async () => parseNoticeBody(notice.operator, await page(notice.url, deps)));
  return noticeExcerpt(body, notice.title);
}

/** Notices dated today, the `days - 1` days before it, or later (a notice dated ahead). */
export function recentNotices(list: readonly MetroNotice[], today: string, days = 3): MetroNotice[] {
  const from = addDays(today, 1 - days);
  return list.filter((notice) => notice.date >= from);
}
