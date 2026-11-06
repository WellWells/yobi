/**
 * In-process MCP server for the user's calendars (.ics subscriptions read only, CalDAV accounts
 * read and write), backed by `calendarService.ts`, which it takes as a parameter.
 */
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { createToolServer } from '../mcp/inProcessServer';
import { EVENTS_LIMIT_DEFAULT, EVENTS_LIMIT_MAX } from './calendarService';
import type { CalendarService, EventArgs } from './calendarService';
import { CalendarArgumentError } from './eventTime';

export const CALENDAR_SERVER_NAME = 'calendar';

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const WRITES = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

const WHEN = 'YYYY-MM-DD for a whole day, or YYYY-MM-DDTHH:MM in the user\'s local time';
const CALENDAR = { type: 'string', description: 'A calendar by name or id from calendar_list' } as const;
const EVENT_ID = { type: 'string', description: 'An event_id from calendar_events' } as const;

const EVENT_FIELDS = {
  title: { type: 'string', description: 'What the event is, in the user\'s words' },
  start: { type: 'string', description: `Start: ${WHEN}` },
  end: { type: 'string', description: 'End, same form; for a whole-day event its last day. Leave out for one hour (one day when all_day)' },
  all_day: { type: 'boolean', description: 'A whole-day event; implied when start is a date' },
  location: { type: 'string', description: 'Where, only when the user said' },
  description: { type: 'string', description: 'Notes, only when the user gave any' },
} as const;

export const CALENDAR_TOOLS: Tool[] = [
  {
    name: 'calendar_list',
    description: "The user's calendars: name, id, account and whether events can be added there. Subscribed .ics calendars are read only.",
    inputSchema: { type: 'object', properties: {} },
    annotations: { title: 'List calendars', ...READ_ONLY },
  },
  {
    name: 'calendar_events',
    description: `Events in a date range, from every calendar unless one is named; earliest first. from/to: ${WHEN}; to as a date includes that whole day. Leave both out for the next 7 days. Returns event_id (needed to change or delete), title, start, end, location; "repeating" and "meeting" events cannot be changed here.`,
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string' },
        to: { type: 'string' },
        calendar: CALENDAR,
        query: { type: 'string', description: 'Words to find in title, location or notes' },
        limit: { type: 'number', description: `Default ${EVENTS_LIMIT_DEFAULT}, at most ${EVENTS_LIMIT_MAX}` },
      },
    },
    annotations: { title: 'Read events', ...READ_ONLY },
  },
  {
    name: 'calendar_create_event',
    description: 'Add one event (not repeating, no invitees) to a writable calendar; with several writable calendars, name one.',
    inputSchema: { type: 'object', properties: { calendar: CALENDAR, ...EVENT_FIELDS }, required: ['title', 'start'] },
    annotations: { title: 'Add event', ...WRITES },
  },
  {
    name: 'calendar_update_event',
    description: 'Change one event: give only what changes. A new start without an end keeps its length.',
    inputSchema: { type: 'object', properties: { event_id: EVENT_ID, ...EVENT_FIELDS }, required: ['event_id'] },
    annotations: { title: 'Change event', ...WRITES },
  },
  {
    name: 'calendar_delete_event',
    description: 'Delete one event.',
    inputSchema: { type: 'object', properties: { event_id: EVENT_ID }, required: ['event_id'] },
    annotations: { title: 'Delete event', ...WRITES, destructiveHint: true },
  },
];

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') throw new CalendarArgumentError(`${key} must be a string`);
  return value;
}

function optionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new CalendarArgumentError(`${key} must be true or false`);
}

/** A count models write as 5 or "5"; anything else is the default. */
function optionalCount(args: Record<string, unknown>, key: string): number | undefined {
  const raw = args[key];
  const value = typeof raw === 'string' ? (raw.trim() ? Number(raw) : undefined) : raw;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function eventArgs(args: Record<string, unknown>): EventArgs {
  return {
    title: optionalString(args, 'title'),
    start: optionalString(args, 'start') || undefined,
    end: optionalString(args, 'end') || undefined,
    all_day: optionalBoolean(args, 'all_day'),
    location: optionalString(args, 'location'),
    description: optionalString(args, 'description'),
  };
}

async function dispatch(service: CalendarService, name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
  switch (name) {
    case 'calendar_list': return service.list();
    case 'calendar_events':
      return service.events({
        from: optionalString(args, 'from') || undefined,
        to: optionalString(args, 'to') || undefined,
        calendar: optionalString(args, 'calendar'),
        query: optionalString(args, 'query'),
        limit: optionalCount(args, 'limit'),
      }, signal);
    case 'calendar_create_event': return service.create({ ...eventArgs(args), calendar: optionalString(args, 'calendar') }, signal);
    case 'calendar_update_event': return service.update({ ...eventArgs(args), event_id: optionalString(args, 'event_id') }, signal);
    case 'calendar_delete_event': return service.remove({ event_id: optionalString(args, 'event_id') }, signal);
    default: throw new CalendarArgumentError(`Unknown tool: ${name}`);
  }
}

export function createCalendarMcpServer(service: CalendarService): Server {
  return createToolServer({
    name: CALENDAR_SERVER_NAME,
    tools: CALENDAR_TOOLS,
    dispatch: (name, args, signal) => dispatch(service, name, args, signal),
  });
}
