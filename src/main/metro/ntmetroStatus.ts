/**
 * New Taipei Metro's status banner: every ntmetro.com.tw page's header carries a "營運狀況" menu
 * with the whole-network words ("全線正常營運", class text-success) and one item per line (淡海輕軌,
 * 安坑輕軌, 環狀線, 三鶯線), each a coloured dot and words ("全線正常運作", dot #41c183). Read from the
 * home page, 2026-10-22; nothing but "normal" has been seen, so other words count as not normal and
 * a dot that disagrees with the words leaves it undecided.
 */
import { load } from 'cheerio';
import type { LineStatus, MetroDeps, StatusSource } from './metroTypes';
import { browserHeaders, railText } from '../rail/railHttp';

export const NTMETRO_HOME = 'https://www.ntmetro.com.tw/';
const NORMAL_DOT = '#41c183';
const STATUS_TTL_MS = 60_000;

function clean(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

function saysNormal(text: string): boolean {
  return /正常/u.test(text) && !/(異常|不正常|非正常)/u.test(text);
}

function judge(text: string, dotNormal: boolean | null): boolean | null {
  if (!text) return null;
  const words = saysNormal(text);
  if (dotNormal === null || dotNormal === words) return words;
  return null;
}

export function parseNtmetroStatus(html: string, source = NTMETRO_HOME): LineStatus[] {
  const $ = load(html);
  const menu = $('#banner-menu > li').filter((_, li) => $(li).children('a').attr('title') === '營運狀況').first();
  if (menu.length === 0) throw new Error('New Taipei Metro page has no 營運狀況 menu');
  const overall = menu.children('a').find('span').first();
  const overallText = clean(overall.text());
  const out: LineStatus[] = [{
    operator: 'ntmetro',
    line: '新北捷運',
    normal: judge(overallText, overall.length ? overall.hasClass('text-success') : null),
    text: overallText,
    source,
  }];
  menu.find('.mega-menu-content a.menu-link').each((_, el) => {
    const link = $(el);
    const line = clean(link.attr('title') ?? '');
    if (!line) return;
    // The words follow the <hr>; before it are the names (淡海輕軌 / Danhai LRT).
    const parts = (link.html() ?? '').split(/<hr\b[^>]*>/iu);
    const text = parts.length > 1 ? clean(load(`<div>${parts[parts.length - 1]}</div>`)('div').text()) : '';
    const colour = /color:\s*(#[0-9a-f]{3,6})/iu.exec(link.find('i').attr('style') ?? '')?.[1]?.toLowerCase();
    out.push({ operator: 'ntmetro', line, normal: judge(text, colour ? colour === NORMAL_DOT : null), text, source });
  });
  if (out.length === 1) throw new Error('New Taipei Metro status menu lists no lines');
  return out;
}

export const ntmetroStatus: StatusSource = {
  operator: 'ntmetro',
  status: (deps: MetroDeps) => deps.memo('ntmetro:status', STATUS_TTL_MS, async () => {
    const html = await railText(deps.fetchFn, NTMETRO_HOME, { headers: browserHeaders(NTMETRO_HOME) }, deps.signal);
    return parseNtmetroStatus(html);
  }),
};
