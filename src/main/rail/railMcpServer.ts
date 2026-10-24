/**
 * In-process MCP server for Taiwan's railways (THSR + TRA) and metros, backed by `railService.ts`
 * and `metro/metroService.ts`, which it takes as parameters.
 */
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { createToolServer } from '../mcp/inProcessServer';
import type { RailService, TrainArgs, TripArgs } from './railService';
import { METRO_MAP_SYSTEMS } from '../metro/metroMaps';
import { STATUS_SYSTEM_NAMES, TICKET_SYSTEM_NAMES } from '../metro/metroService';
import type { MetroService } from '../metro/metroService';
import {
  FROM_NAMES, MAP_SYSTEM_ALIASES, MODES_ALIASES, OPERATOR_ALIASES, SORT_ALIASES, SYSTEM_NAMES, TIME_IS_ALIASES, TO_NAMES, TRAIN_MODE_ALIASES,
  alsoNamed, modeWord,
} from './railToolAliases';

export const RAIL_SERVER_NAME = 'taiwan-rail';

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

export const RAIL_TOOLS: Tool[] = [
  {
    name: 'rail_trip',
    description:
      "Plan a trip on Taiwan's High Speed Rail (THSR, 高鐵) and Taiwan Railway (TRA, 台鐵) from official timetables: direct trains and one-change plans (including THSR ↔ TRA at linked stations), sorted the way asked. Without a time it plans from now in Taipei and says so in query_time. For today it adds TRA delays, THSR seats and service notices; THSR legs carry fares and early-bird/student offers when THSR lists them. A TRA-only plan carries one TRA ticket for the whole trip at the highest class ridden; on a direct train the ticket has that train's own fare, its 騰雲座艙 (business) and 自由座 (unreserved) fares and TRA's discounts on it (大學生5折). tra_fares lists TRA's fare for every class between the plans' end stations; a TRA leg in a plan with THSR carries its own fare.",
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Station or city, Chinese or English (左營, 台北車站, Kaohsiung)', ...FROM_NAMES },
        to: { type: 'string', description: 'Station or city, Chinese or English', ...TO_NAMES },
        date: { type: 'string', description: 'YYYY-MM-DD, only when the user named a day; leave out for today' },
        time: { type: 'string', description: 'HH:MM, only when the user named a time; leave out for now (the tool knows Taipei time)' },
        time_is: { type: 'string', enum: ['depart', 'arrive'], description: 'depart = leave at or after time (default); arrive = arrive by time', ...alsoNamed('time_type', 'time_mode'), ...TIME_IS_ALIASES },
        sort: { type: 'string', enum: ['earliest_arrival', 'shortest', 'earliest_departure'], description: 'earliest_arrival (default, 最快到), shortest (車程最短), earliest_departure (下一班)', ...alsoNamed('sort_by', 'order', 'order_by'), ...SORT_ALIASES },
        modes: { type: 'string', enum: ['any', 'thsr', 'tra'], description: 'any (default) compares both; thsr = 高鐵 only; tra = 台鐵 / 火車 only', ...alsoNamed('mode', 'type', 'train_type'), ...MODES_ALIASES },
        limit: { type: 'number', description: 'Plans to return, 1-8; default 5' },
      },
      required: ['from', 'to'],
    },
    annotations: { title: 'Plan a Taiwan rail trip', ...READ_ONLY },
  },
  {
    name: 'rail_train',
    description:
      "One THSR or TRA train by number on a date: type, stops and times. For a TRA train today it adds where the train is now and how late, from TRA's own train-status page; for today it adds service notices.",
    inputSchema: {
      type: 'object',
      properties: {
        train: { type: 'string', description: 'Train number (1006, 0803)', ...alsoNamed('train_no', 'train_number', 'number', 'train_id') },
        date: { type: 'string', description: 'YYYY-MM-DD, only when the user named a day; leave out for today' },
        mode: { type: 'string', enum: ['auto', 'thsr', 'tra'], description: 'auto (default) looks in both', ...alsoNamed('modes', 'type'), ...TRAIN_MODE_ALIASES },
      },
      required: ['train'],
    },
    annotations: { title: 'Look up a Taiwan train', ...READ_ONLY },
  },
  {
    name: 'metro_trip',
    description:
      "Fare, ride time and next trains between two stations on Taiwan's metros (Taipei, airport, 淡海/安坑/三鶯, Taichung, Kaohsiung). Works across operators in one city (Taipei Metro → airport MRT): it picks the changes, quotes each leg from that operator's own site and adds the fares up, taking off New Taipei's card transfer discount where it applies. Names may be Chinese, English or codes (A13, BL12), with typos; an unknown name returns the closest stations to ask about.",
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Station name or code (台北車站, 機場第二航廈, A13, Zhongshan); for a landmark, the station nearest it', ...FROM_NAMES },
        to: { type: 'string', description: 'Station name or code', ...TO_NAMES },
        date: { type: 'string', description: 'YYYY-MM-DD, only when the user named a day; leave out for today' },
        time: { type: 'string', description: 'HH:MM to leave at, only when the user named a time; leave out for now (the tool knows Taipei time)' },
      },
      required: ['from', 'to'],
    },
    annotations: { title: 'Plan a Taiwan metro trip', ...READ_ONLY },
  },
  {
    name: 'metro_station',
    description:
      "Next trains, first and last train each way from one Taiwan metro station, from its operator's own site: for questions that name one station and no destination (下一班, 末班, 首班). A name on two systems (十四張, 市政府) returns both.",
    inputSchema: {
      type: 'object',
      properties: {
        station: { type: 'string', description: 'Station name or code (十四張, 崁頂, Y08); for a landmark, the station nearest it', ...alsoNamed('name', 'station_name', 'stop') },
        date: { type: 'string', description: 'YYYY-MM-DD, only when the user named a day; leave out for today' },
        time: { type: 'string', description: 'HH:MM, only when the user named a time; leave out for now (the tool knows Taipei time)' },
      },
      required: ['station'],
    },
    annotations: { title: 'Look up a Taiwan metro station', ...READ_ONLY },
  },
  {
    name: 'metro_map',
    description:
      "The official route map of one Taiwan metro system, found on its operator's site and attached to the answer as a picture, with the page and full-size links.",
    inputSchema: {
      type: 'object',
      properties: {
        system: {
          type: 'string',
          enum: [...METRO_MAP_SYSTEMS],
          description: 'taipei 台北捷運 (incl. 環狀線), airport 機場捷運, danhai 淡海輕軌, ankeng 安坑輕軌, circular 環狀線, sanying 三鶯線, taichung 台中捷運, kaohsiung 高雄捷運+輕軌',
          ...SYSTEM_NAMES,
          ...MAP_SYSTEM_ALIASES,
        },
      },
      required: ['system'],
    },
    annotations: { title: 'Show a Taiwan metro map', ...READ_ONLY },
  },
  {
    name: 'metro_tickets',
    description:
      "One Taiwan metro operator's ticket rules from its own pages: who rides free or at a discount (敬老, 愛心, 兒童, 學生, under 6), on which card or ticket, and its passes (一日票, TPASS…).",
    inputSchema: {
      type: 'object',
      properties: {
        system: {
          type: 'string',
          enum: TICKET_SYSTEM_NAMES,
          description: 'taipei 台北捷運, airport 機場捷運, new_taipei 淡海/安坑/三鶯, taichung 台中捷運, kaohsiung 高雄捷運+輕軌',
          ...SYSTEM_NAMES,
          ...OPERATOR_ALIASES,
        },
      },
      required: ['system'],
    },
    annotations: { title: 'Look up Taiwan metro ticket rules', ...READ_ONLY },
  },
  {
    name: 'metro_status',
    description: "Whether Taiwan's metros run normally right now, in each operator's own words from its site.",
    inputSchema: {
      type: 'object',
      properties: {
        system: {
          type: 'string',
          enum: STATUS_SYSTEM_NAMES,
          description: 'all (default), taipei, airport, new_taipei (淡海/安坑/三鶯/環狀線), taichung, kaohsiung',
          ...SYSTEM_NAMES,
          ...OPERATOR_ALIASES,
        },
      },
    },
    annotations: { title: 'Check Taiwan metro service', ...READ_ONLY },
  },
];

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error(`${key} must be a string`);
  return value;
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = optionalString(args, key);
  if (!value?.trim()) throw new Error(`${key} is required`);
  return value;
}

/** `modes` is one word, but models also send a list in capitals (["THSR", "TRA"]); both read the same. */
export function modesArg(args: Record<string, unknown>): TripArgs['modes'] {
  const raw = args.modes;
  if (raw === undefined || raw === null || raw === '') return undefined;
  const words = new Set((Array.isArray(raw) ? raw : [raw]).map((word) => modeWord(String(word))).filter(Boolean));
  if (words.has('any') || (words.has('thsr') && words.has('tra'))) return 'any';
  if (words.size === 1 && (words.has('thsr') || words.has('tra'))) return [...words][0] as 'thsr' | 'tra';
  throw new Error(`modes must be "any", "thsr" or "tra", got ${JSON.stringify(raw)}`);
}

async function dispatch(service: RailService, metro: MetroService, name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  if (name === 'rail_trip') {
    const trip: TripArgs = {
      from: requiredString(args, 'from'),
      to: requiredString(args, 'to'),
      date: optionalString(args, 'date'),
      time: optionalString(args, 'time'),
      time_is: optionalString(args, 'time_is') as TripArgs['time_is'],
      sort: optionalString(args, 'sort') as TripArgs['sort'],
      modes: modesArg(args),
      limit: typeof args.limit === 'number' ? args.limit : undefined,
    };
    return service.planTrip(trip, signal);
  }
  if (name === 'rail_train') {
    const raw = args.train;
    const train: TrainArgs = {
      train: typeof raw === 'number' ? String(raw) : requiredString(args, 'train'),
      date: optionalString(args, 'date'),
      mode: optionalString(args, 'mode') as TrainArgs['mode'],
    };
    return service.trainInfo(train, signal);
  }
  if (name === 'metro_trip') {
    return metro.trip({
      from: requiredString(args, 'from'),
      to: requiredString(args, 'to'),
      date: optionalString(args, 'date'),
      time: optionalString(args, 'time'),
    }, signal);
  }
  if (name === 'metro_station') {
    return metro.station({ station: requiredString(args, 'station'), date: optionalString(args, 'date'), time: optionalString(args, 'time') }, signal);
  }
  if (name === 'metro_map') return metro.map({ system: requiredString(args, 'system') }, signal);
  if (name === 'metro_status') return metro.status({ system: optionalString(args, 'system') }, signal);
  if (name === 'metro_tickets') return metro.tickets({ system: requiredString(args, 'system') });
  throw new Error(`Unknown tool: ${name}`);
}

export function createRailMcpServer(service: RailService, metro: MetroService): Server {
  return createToolServer({
    name: RAIL_SERVER_NAME,
    tools: RAIL_TOOLS,
    dispatch: (name, args, signal) => dispatch(service, metro, name, args, signal),
  });
}
