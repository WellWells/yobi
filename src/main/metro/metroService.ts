/**
 * What the three metro tools answer. "Now" is decided here (Taipei time when the question gives
 * none) and echoed as `query_time`; station names are resolved here, so a typo or an unknown
 * place comes back as the closest names for the model to ask about, never as a guess.
 */
import { ToolResultWithPictures } from '../mcp/inProcessServer';
import { clockMinutes, dateArg, daysBetween, formatQueryTime, isIsoDate, taipeiClock, timeArg } from '../rail/railTime';
import type { FetchFn } from '../rail/railHttp';
import { fareNotes, formatOption, officialLinks, systemLabel } from './metroFormat';
import { fetchMetroMap, isMapSystem, mapSpec, METRO_MAP_SYSTEMS } from './metroMaps';
import type { FoundMap } from './metroMaps';
import { NETWORK_INFO, networkName } from './metroNetworks';
import type { TransferLink } from './metroNetworks';
import { planMetroTrip } from './metroPlanner';
import { stationBoard } from './metroStationBoard';
import { findFutureLines, futureLineView } from './metroFuture';
import { recentNotices } from './metroNotices';
import { ticketRulesView } from './metroTicketRules';
import type { MetroNotice } from './metroNotices';
import { buildMetroIndex, isResolvedStations, resolveMetroStation } from './metroResolve';
import type { MetroAlias } from './metroResolve';
import type { LineStatus, MetroDeps, MetroMemo, MetroNetwork, MetroOperator, MetroStation, NetworkSource, QuoteWhen, StatusSource } from './metroTypes';

export interface MetroCatalog {
  stations: readonly MetroStation[];
  aliases: readonly MetroAlias[];
  sources: Readonly<Record<MetroNetwork, NetworkSource>>;
  statusSources: readonly StatusSource[];
  transfers: readonly TransferLink[];
  /** Each operator's recent announcements (typhoon schedules, works), newest first. */
  notices?: (operator: MetroOperator, deps: MetroDeps) => Promise<MetroNotice[]>;
  /** The start of one notice's text; read only when one operator is asked about. */
  noticeExcerpt?: (notice: MetroNotice, deps: MetroDeps) => Promise<string>;
}

export interface MetroServiceDeps {
  fetchFn: FetchFn;
  memo: MetroMemo;
  now: () => Date;
  catalog: MetroCatalog;
  /**
   * Turns a downloaded map into the picture file the answer carries (Electron decodes and shrinks
   * it). Absent — or failing — the answer still gives the official links.
   */
  mapPicture?: (map: FoundMap) => Promise<string>;
}

export interface MetroTripArgs {
  from: string;
  to: string;
  date?: string;
  time?: string;
}

export interface MetroStationArgs {
  station: string;
  date?: string;
  time?: string;
}

/** The systems a status question names, by the words the tool takes. */
const STATUS_SYSTEMS: Readonly<Record<string, readonly MetroOperator[]>> = {
  all: ['trtc', 'tymc', 'ntmetro', 'tmrt', 'krtc'],
  taipei: ['trtc'],
  airport: ['tymc'],
  new_taipei: ['ntmetro'],
  taichung: ['tmrt'],
  kaohsiung: ['krtc'],
};
export const STATUS_SYSTEM_NAMES = Object.keys(STATUS_SYSTEMS);
/** Ticket rules are one operator's at a time: all five at once would pass a browser provider's limit. */
export const TICKET_SYSTEM_NAMES = STATUS_SYSTEM_NAMES.filter((name) => name !== 'all');

const OPERATOR_NAMES: Readonly<Record<MetroOperator, string>> = {
  trtc: '台北捷運',
  tymc: '桃園捷運',
  ntmetro: '新北捷運',
  tmrt: '台中捷運',
  krtc: '高雄捷運',
};

const STATUS_PAGES: Readonly<Record<MetroOperator, string>> = {
  trtc: 'https://www.metro.taipei/',
  tymc: 'https://www.tymetro.com.tw/tymetro-new/',
  ntmetro: 'https://www.ntmetro.com.tw/',
  tmrt: 'https://www.tmrt.com.tw/',
  krtc: 'https://www.krtc.com.tw/',
};

/** How far ahead a date may be: the operators publish timetables weeks, not months, ahead. */
const MAX_DAYS_AHEAD = 60;
const MAP_PICTURE_TTL_MS = 24 * 60 * 60_000;
/** Recent notices shown per operator: the newest few of the last three days. */
const NOTICES_PER_OPERATOR = 3;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * "2026-10-24 (Sat) 07:00": the weekday is given, not left to the model — live eval 2026-10-22,
 * a model called Saturday 10/24 a Friday.
 */
function askedFor(date: string, time?: string): string {
  const weekday = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  return `${date} (${weekday})${time ? ` ${time}` : ''}`;
}

function whenFor(args: { date?: string; time?: string }, now: Date): QuoteWhen {
  const clock = taipeiClock(now);
  const date = dateArg(args.date, clock.date);
  if (!isIsoDate(date)) throw new Error(`date must be YYYY-MM-DD, got "${args.date}"`);
  const ahead = daysBetween(clock.date, date);
  if (ahead < 0) throw new Error(`${date} is in the past (today is ${clock.date} in Taipei)`);
  if (ahead > MAX_DAYS_AHEAD) throw new Error(`${date} is more than ${MAX_DAYS_AHEAD} days ahead; timetables are not published that far`);
  const time = timeArg(args.time);
  if (time) {
    const minutes = clockMinutes(time);
    if (!Number.isFinite(minutes) || minutes >= 1_440) throw new Error(`time must be HH:MM, got "${time}"`);
    return { date, minutes, isNow: false };
  }
  return ahead === 0 ? { date, minutes: clock.minutes, isNow: true } : { date, minutes: 0, isNow: false };
}

export function createMetroService(deps: MetroServiceDeps) {
  const { catalog } = deps;
  const index = buildMetroIndex(catalog.stations, catalog.aliases);
  const byCode = new Map(catalog.stations.flatMap((station) => station.codes.map((code) => [`${station.network}:${code}`, station] as const)));

  function sourceDeps(signal?: AbortSignal): MetroDeps {
    return { fetchFn: deps.fetchFn, memo: deps.memo, ...(signal ? { signal } : {}) };
  }

  function resolve(text: string): { stations: MetroStation[]; correctedTo?: string } {
    const result = resolveMetroStation(index, String(text ?? ''), networkName);
    if (isResolvedStations(result) && !result.correctedTo) return result;
    // A line not open yet (八德, 桃園綠線G07, LB13, 新竹捷運) is its official status, never the
    // nearest-looking running station (G07 alone is Taipei's 公館) and never a guessed fare.
    // A city's own railway station (台南車站, 台南火車站) is that place for the table.
    const asked = String(text ?? '').trim();
    const place = asked.replace(/(?:火車站|車站)$/u, '');
    const named = findFutureLines(asked);
    const future = named.length > 0 || place === asked ? named : findFutureLines(place);
    if (future.length > 0) {
      throw new Error(`not_open: "${text}" is not a metro station in service. ${JSON.stringify(future.slice(0, 2).map(futureLineView))}`);
    }
    if (isResolvedStations(result)) return result;
    const close = result.suggestions.length > 0 ? ` Close names: ${result.suggestions.join('、')}.` : '';
    throw new Error(`No metro station matches "${result.query}".${close} Ask the user which one they mean; for a landmark, pass the station nearest to it.`);
  }

  async function trip(args: MetroTripArgs, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const now = deps.now();
    const when = whenFor(args, now);
    const from = resolve(args.from);
    const to = resolve(args.to);
    const options = await planMetroTrip(from.stations, to.stations, when, {
      ...sourceDeps(signal),
      sources: catalog.sources,
      transfers: catalog.transfers,
      stationByCode: (network, code) => byCode.get(`${network}:${code}`),
    });
    const used = (side: 'from' | 'to'): string[] => [...new Set(options.map((o) => systemLabel(side === 'from' ? o.legs[0].from : o.legs[o.legs.length - 1].to)))];
    const notes = fareNotes(options);
    return {
      query_time: formatQueryTime(now),
      ...(when.isNow ? {} : { asked_for: askedFor(when.date, timeArg(args.time)) }),
      from: { asked: args.from, station: used('from'), ...(from.correctedTo ? { read_as: from.correctedTo } : {}) },
      to: { asked: args.to, station: used('to'), ...(to.correctedTo ? { read_as: to.correctedTo } : {}) },
      options: options.map((option, i) => formatOption(option, i === 0)),
      ...(notes.length > 0 ? { fare_notes: notes } : {}),
      official_links: officialLinks(options),
    };
  }

  async function station(args: MetroStationArgs, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const now = deps.now();
    const when = whenFor(args, now);
    const found = resolve(args.station);
    const { boards, sources } = await stationBoard(found.stations, when, {
      ...sourceDeps(signal),
      sources: catalog.sources,
      transfers: catalog.transfers,
      stationByCode: (network, code) => byCode.get(`${network}:${code}`),
    });
    // 台北車站 is one place on two systems (a transfer station: both boards are the answer);
    // 市政府 is two places in two cities (ask which one, unless the user said).
    const regions = new Set(found.stations.map((s) => NETWORK_INFO[s.network].region));
    const systems = new Set(found.stations.map((s) => s.network)).size;
    const sameName = regions.size > 1
      ? { same_name_in_different_cities: 'These are different stations; if the user did not say which city, ask.' }
      : systems > 1 ? { one_place_on: `${systems} systems (a transfer station): answer for the one the user means, or both` } : {};
    return {
      query_time: formatQueryTime(now),
      ...(when.isNow ? {} : { asked_for: askedFor(when.date, timeArg(args.time)) }),
      ...(found.correctedTo ? { read_as: found.correctedTo } : {}),
      ...sameName,
      stations: boards,
      official_links: sources,
    };
  }

  async function map(args: { system: string }, signal?: AbortSignal): Promise<ToolResultWithPictures> {
    const system = String(args.system ?? '').trim().toLowerCase();
    if (!isMapSystem(system)) throw new Error(`system must be one of ${METRO_MAP_SYSTEMS.join(', ')}, got "${args.system}"`);
    const spec = mapSpec(system);
    const found = await deps.memo<FoundMap>(`map-image-${system}`, MAP_PICTURE_TTL_MS, () => fetchMetroMap(system, sourceDeps(signal)));
    let picture: string | undefined;
    let pictureNote = 'The map picture is attached under the answer automatically; do not paste the image link as a picture.';
    try {
      picture = deps.mapPicture ? await deps.mapPicture(found) : undefined;
      if (!picture) pictureNote = 'No picture can be attached here; give the official links.';
    } catch (err) {
      pictureNote = `The picture could not be prepared (${err instanceof Error ? err.message : String(err)}); give the official links.`;
    }
    const value = {
      system: spec.zh,
      operator: spec.operator,
      official_page: found.page,
      image: found.image,
      ...(found.pdf ? { full_map_pdf: found.pdf } : {}),
      ...(found.updated ? { image_last_modified: found.updated } : {}),
      picture: pictureNote,
    };
    return new ToolResultWithPictures(value, picture ? [picture] : []);
  }

  async function status(args: { system?: string }, signal?: AbortSignal): Promise<Record<string, unknown>> {
    const key = String(args.system ?? 'all').trim().toLowerCase() || 'all';
    const operators = STATUS_SYSTEMS[key];
    if (!operators) throw new Error(`system must be one of ${STATUS_SYSTEM_NAMES.join(', ')}, got "${args.system}"`);
    const sources = catalog.statusSources.filter((source) => operators.includes(source.operator));
    // The banner says how service is now; a change announced for tomorrow (a typhoon) is only in
    // the notices — on 2026-10-22 every banner read 正常營運 under four operators' 10/23 notices.
    const noticesOf = catalog.notices;
    const [settled, noticed] = await Promise.all([
      Promise.allSettled(sources.map((source) => source.status(sourceDeps(signal)))),
      noticesOf ? Promise.allSettled(operators.map((op) => noticesOf(op, sourceDeps(signal)))) : Promise.resolve([]),
    ]);
    const today = taipeiClock(deps.now()).date;
    // All five operators' notices with their links would pass a browser provider's ~3,500 characters.
    const perOperator = operators.length > 1 ? NOTICES_PER_OPERATOR - 1 : NOTICES_PER_OPERATOR;
    const notices = noticed.flatMap((result) => (result.status === 'fulfilled' ? recentNotices(result.value, today).slice(0, perOperator) : []));
    // Only for one operator: five operators' excerpts would not fit that budget either. A notice
    // whose page cannot be read keeps its title and link.
    const excerptOf = catalog.noticeExcerpt;
    const excerpts = operators.length === 1 && excerptOf
      ? await Promise.allSettled(notices.map((notice) => excerptOf(notice, sourceDeps(signal))))
      : [];
    const lines: LineStatus[] = [];
    const unavailable: string[] = [];
    settled.forEach((result, i) => {
      if (result.status === 'fulfilled') lines.push(...result.value);
      else unavailable.push(`${sources[i].operator}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
    });
    if (lines.length === 0 && unavailable.length > 0) throw new Error(`No operator's status page answered: ${unavailable.join('; ')}`);
    return {
      query_time: formatQueryTime(deps.now()),
      // Two operators report 環狀線, and KRTC's lines are just 捷運 and 輕軌: the operator goes with each.
      lines: lines.map((line) => ({ operator: OPERATOR_NAMES[line.operator], line: line.line, normal: line.normal, says: line.text })),
      ...(notices.length > 0
        ? {
          recent_notices: notices.map((n, i) => {
            const excerpt = excerpts[i];
            return {
              operator: OPERATOR_NAMES[n.operator], date: n.date, title: n.title,
              ...(excerpt?.status === 'fulfilled' && excerpt.value ? { excerpt: excerpt.value } : {}),
              url: n.url,
            };
          }),
        }
        : {}),
      ...(unavailable.length > 0 ? { unavailable } : {}),
      official_links: [...new Set(sources.map((source) => STATUS_PAGES[source.operator]))],
    };
  }

  /** One operator's ticket rules: who pays what, passes, and the official pages they came from. */
  function tickets(args: { system: string }): Record<string, unknown> {
    const key = String(args.system ?? '').trim().toLowerCase();
    const operators = STATUS_SYSTEMS[key];
    if (!operators || operators.length !== 1) {
      throw new Error(`system must be one of ${TICKET_SYSTEM_NAMES.join(', ')}, got "${args.system}"`);
    }
    return { ...ticketRulesView(operators[0]) };
  }

  return { trip, station, map, status, tickets };
}

export type MetroService = ReturnType<typeof createMetroService>;
