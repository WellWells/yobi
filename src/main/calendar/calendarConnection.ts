/**
 * Builds the live, in-process Calendar MCP connection. Loaded lazily by the registry; nothing
 * connects to a calendar server until a tool is called.
 */
import { randomUUID } from 'node:crypto';
import { connectInProcess, type InProcessConnection } from '../mcp/inProcessServer';
import { davClientFor } from './calDavAccounts';
import { readCalendarEvents } from './calendarEvents';
import { calendarFreshness } from './calendarFreshness';
import { createCalendarMcpServer } from './calendarMcpServer';
import { createCalendarService } from './calendarService';
import { findCalendar } from './calendarStore';

export async function connectCalendarMcp(clientName: string, clientVersion: string): Promise<InProcessConnection> {
  const service = createCalendarService({
    find: findCalendar,
    read: (calendar, window, signal) => readCalendarEvents(calendar, window, signal),
    dav: (accountId) => davClientFor(accountId),
    freshen: () => calendarFreshness().freshen(),
    now: () => new Date(),
    newUid: () => randomUUID().toUpperCase(),
  });
  return connectInProcess(createCalendarMcpServer(service), clientName, clientVersion);
}
