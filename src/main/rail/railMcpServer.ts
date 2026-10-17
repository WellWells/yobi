/**
 * In-process MCP server for Taiwan's railways (THSR + TRA), backed by `railService.ts`, which it
 * takes as a parameter.
 */
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { createToolServer } from '../mcp/inProcessServer';
import type { RailService, TrainArgs, TripArgs } from './railService';

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
        from: { type: 'string', description: 'Station or city, Chinese or English (左營, 台北車站, Kaohsiung)' },
        to: { type: 'string', description: 'Station or city, Chinese or English' },
        date: { type: 'string', description: 'YYYY-MM-DD in Taipei; default today' },
        time: { type: 'string', description: 'HH:MM; default now when the date is today' },
        time_is: { type: 'string', enum: ['depart', 'arrive'], description: 'depart = leave at or after time (default); arrive = arrive by time' },
        sort: { type: 'string', enum: ['earliest_arrival', 'shortest', 'earliest_departure'], description: 'earliest_arrival (default, 最快到), shortest (車程最短), earliest_departure (下一班)' },
        modes: { type: 'string', enum: ['any', 'thsr', 'tra'], description: 'any (default) compares both; thsr = 高鐵 only; tra = 台鐵 / 火車 only' },
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
        train: { type: 'string', description: 'Train number (1006, 0803)' },
        date: { type: 'string', description: 'YYYY-MM-DD in Taipei; default today' },
        mode: { type: 'string', enum: ['auto', 'thsr', 'tra'], description: 'auto (default) looks in both' },
      },
      required: ['train'],
    },
    annotations: { title: 'Look up a Taiwan train', ...READ_ONLY },
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
  const words = new Set((Array.isArray(raw) ? raw : [raw]).map((word) => String(word).trim().toLowerCase()).filter(Boolean));
  if (words.has('any') || (words.has('thsr') && words.has('tra'))) return 'any';
  if (words.size === 1 && (words.has('thsr') || words.has('tra'))) return [...words][0] as 'thsr' | 'tra';
  throw new Error(`modes must be "any", "thsr" or "tra", got ${JSON.stringify(raw)}`);
}

async function dispatch(service: RailService, name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
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
  throw new Error(`Unknown tool: ${name}`);
}

export function createRailMcpServer(service: RailService): Server {
  return createToolServer({
    name: RAIL_SERVER_NAME,
    tools: RAIL_TOOLS,
    dispatch: (name, args, signal) => dispatch(service, name, args, signal),
  });
}
