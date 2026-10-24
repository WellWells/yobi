/**
 * Readers for Taipei Metro's own pages and the JSON its pages fetch (captures 2026-10-22). Pure, so
 * the tests run them on fixtures; `trtcSource.ts` does the requests.
 */
import { load } from 'cheerio';
import { clockMinutes } from '../rail/railTime';
import type { LineStatus, MetroStation } from './metroTypes';
import { trtcLineOf } from './trtcStations';

/**
 * The concession columns as the route planner's fare table heads them. Its fare query page binds
 * both to `Discount40` (40% of the full fare); `Discount60` is in every answer but no Taipei Metro
 * page shows it, so it is not read.
 */
export const TRTC_TICKET_KINDS = { elderly: '敬老/愛心', child: '臺北市及新北市兒童' } as const;

/** The fare query page's footnote for a starred (`Promote`) fare. */
export const TRTC_PROMOTE_NOTE = '廣慈/奉天宮站通車票價優惠期間之優惠票價';

export interface TrtcFare {
  /** 全票: what a stored-value card pays (the page: 持儲值卡…以全票票價扣款). */
  fare: number;
  elderly: number;
  child: number;
  minutes?: number;
  promote: boolean;
}

export interface TrtcMenuStation extends MetroStation {
  subZh?: string;
  subEn?: string;
}

export interface TrtcRoutePlan {
  /** The codes of the route's first and last station (大坪林 asked as Y07 is planned from G04). */
  fromCode: string;
  toCode: string;
  fare?: number;
  elderly?: number;
  child?: number;
  firstTrain?: string;
  lastTrain?: string;
  /** From the 最小旅行時間 route: its minutes, the departure it planned for, arrival at the end. */
  minutes?: number;
  departure?: string;
  arrive?: string;
  toward?: string;
}

type Json = Record<string, unknown>;

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** "50", "50元" → 50; undefined for anything else. */
function amount(value: unknown): number | undefined {
  const match = /^(\d+)/u.exec(str(value));
  return match ? Number(match[1]) : undefined;
}

function hhmm(value: string): string | undefined {
  return Number.isFinite(clockMinutes(value)) ? value.trim().padStart(5, '0') : undefined;
}

function records(json: unknown): Json[] {
  return Array.isArray(json) ? json.filter((item): item is Json => typeof item === 'object' && item !== null) : [];
}

/**
 * The menu in both languages → one station per SID, in menu order. A transfer station appears once
 * per line with the same `StationLabelForRoadmap` ("BL12 R10"), which gives its codes.
 */
export function parseMenuline(tw: unknown, en: unknown): TrtcMenuStation[] {
  const english = new Map<string, Json>();
  for (const line of records(en)) for (const s of records(line.LineStations)) english.set(str(s.SID), s);
  const out = new Map<string, TrtcMenuStation>();
  for (const line of records(tw)) {
    for (const s of records(line.LineStations)) {
      const sid = str(s.SID);
      if (!sid || out.has(sid)) continue;
      const codes = (str(s.StationLabelForRoadmap) || str(s.StationLabel)).split(/\s+/u);
      const e = english.get(sid);
      const station: TrtcMenuStation = { network: 'trtc', codes, zh: str(s.StationName), en: str(e?.StationName), lines: codes.map(trtcLineOf), ref: sid };
      const subZh = str(s.StationSubName);
      const subEn = str(e?.StationSubName);
      out.set(sid, { ...station, ...(subZh ? { subZh } : {}), ...(subEn ? { subEn } : {}) });
    }
  }
  if (out.size === 0) throw new Error('Taipei Metro station menu came back empty');
  return [...out.values()];
}

/**
 * `ticketroutetimesinglestationinfo`: every destination from one origin with its fare and ride
 * time (134 rows from 台北車站 — a transfer station is listed once per line, same numbers).
 */
export function parseFareList(json: unknown): Map<string, TrtcFare> {
  const out = new Map<string, TrtcFare>();
  for (const row of records(json)) {
    const sid = str(row.EndSID);
    const fare = amount(row.DeductedFare);
    const concession = amount(row.Discount40);
    if (!sid || out.has(sid) || fare === undefined || concession === undefined) continue;
    const minutes = amount(row.TravelTime);
    out.set(sid, { fare, elderly: concession, child: concession, ...(minutes !== undefined ? { minutes } : {}), promote: row.Promote === true });
  }
  if (out.size === 0) throw new Error('Taipei Metro fare list came back empty');
  return out;
}

/** `routetimepathinfo`: {"TravelTime":"40","Path":"搭乘淡水信義線（往淡水）"}; null when it names no stations. */
export function parseRoutePath(json: unknown): { minutes?: number; route?: string } | null {
  const body = json as Json | null;
  if (!body || !str(body.StartStationName) || !str(body.EndStationName)) return null;
  const minutes = amount(body.TravelTime);
  const route = str(body.Path);
  return { ...(minutes !== undefined ? { minutes } : {}), ...(route ? { route } : {}) };
}

/**
 * The route planner's answer to its own postback (`__EVENTTARGET=query`, `__EVENTARGUMENT=R10-R28`).
 * The page plans from the server's clock: "41分鐘｜於 19:45 從 台北車站 發車經過 18 站", then a
 * table with the departure at the first station and the arrival at the last. Null when the page
 * is not an answer (no stations, or no fare).
 */
export function parseRoutePlan(html: string): TrtcRoutePlan | null {
  const $ = load(html);
  const heading = $('th').filter((_, el) => $(el).text().trim() === '最小旅行時間').first();
  const block = heading.closest('tr').next('tr');
  // The route's first and last station badges say which pair it planned. The hidden fields echo the
  // asked codes only when the form was posted with its view state; a bare postback leaves them empty.
  const badges = block.find('td.stationlabel img').map((_, el) => str($(el).attr('alt'))).get().filter(Boolean);
  const fromCode = badges[0] ?? str($('#HiddenFieldDeparture').attr('value'));
  const toCode = (badges.length > 1 ? badges.at(-1) : undefined) ?? str($('#HiddenFieldArrival').attr('value'));
  const fare = amount($('#lbMoney').text());
  if (!fromCode || !toCode || fare === undefined) return null;
  const plan: TrtcRoutePlan = { fromCode, toCode, fare };
  const elderly = amount($('#lbDiscountMoney').text());
  const child = amount($('#lbChildrenMoney').text());
  const first = hhmm($('#lbFirstTrainTime').text());
  const last = hhmm($('#lbLastTrainTime').text());
  if (elderly !== undefined) plan.elderly = elderly;
  if (child !== undefined) plan.child = child;
  if (first) plan.firstTrain = first;
  if (last) plan.lastTrain = last;
  const summary = block.find('p').first().text().trim();
  const minutes = amount(/^(\d+)\s*分鐘/u.exec(summary)?.[1]);
  if (minutes !== undefined) plan.minutes = minutes;
  const times = block.find('td.traintime').map((_, el) => $(el).text().trim()).get().map(hhmm);
  const departure = times[0] ?? hhmm(/於\s*(\d{1,2}:\d{2})/u.exec(summary)?.[1] ?? '');
  if (departure) plan.departure = departure;
  const arrive = times.length > 1 ? times.at(-1) : undefined;
  if (arrive) plan.arrive = arrive;
  const toward = block.find('.destname').first().text().trim().replace(/^往/u, '');
  if (toward) plan.toward = toward;
  return plan;
}

/** Which state the line's icon file names: normal, delay, abnormal, close (all four exist on the site). */
function iconState(src: string): boolean | null {
  const state = /realstatus-([a-z]+)\.svg/u.exec(src)?.[1];
  if (state === 'normal') return true;
  if (state === 'delay' || state === 'abnormal' || state === 'close') return false;
  return null;
}

/**
 * WebAbnormal: one item per line (環狀線 included) with an icon whose alt is the status in words
 * ("目前正常營運"), and one description under them for the whole network (`<li>` items when there
 * is something to say). A line not in normal service gets that description after its own words.
 */
export function parseAbnormal(html: string, source: string): LineStatus[] {
  const $ = load(html);
  // `<li>` inside the `<p class="realstatus__text">` is parsed out of the <p> (an <li> closes an
  // open <p>), so the items are looked for in the whole description block.
  const desc = $('.realstatus__desc').first();
  const items = desc.find('li').map((_, el) => $(el).text().trim()).get().filter(Boolean);
  const description = (items.length > 0 ? items.join('\n') : desc.find('.realstatus__text').text()).replace(/[ \t]+/gu, ' ').trim();
  const out: LineStatus[] = [];
  $('.realstatusdetail__item').each((_, el) => {
    const line = $(el).find('.realstatusdetail__line').text().trim();
    const icon = $(el).find('.realstatus__img img').first();
    if (!line) return;
    const normal = iconState(icon.attr('src') ?? '');
    const words = (icon.attr('alt') ?? icon.attr('title') ?? '').trim();
    const text = normal !== true && description && description !== words ? [words, description].filter(Boolean).join('\n') : words;
    out.push({ operator: 'trtc', line, normal, text, source });
  });
  if (out.length === 0) throw new Error('Taipei Metro status page listed no lines');
  return out;
}
