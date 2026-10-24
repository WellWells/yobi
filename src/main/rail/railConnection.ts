/**
 * Builds the live, in-process Taiwan rail MCP connection. The service — and with it the shared
 * cache and the TDX allowance it has seen — outlives a connection, so switching the connector off
 * and on, or a reconnect, neither refetches timetables nor forgets how much of today is spent.
 * Loaded lazily by the registry.
 */
import { app } from 'electron';
import * as path from 'node:path';
import { DATA_KEY_TDX_ID, DATA_KEY_TDX_SECRET } from '../../shared/types';
import { getDataKey } from '../dataKeyStore';
import { connectInProcess, type InProcessConnection } from '../mcp/inProcessServer';
import { RAIL_CACHE_DIR_NAME } from './railCache';
import { createRailMcpServer } from './railMcpServer';
import { createRailService, type RailService } from './railService';
import { METRO_CATALOG } from '../metro/metroCatalog';
import { saveMapPicture } from '../metro/metroMapPicture';
import { createMetroMemo } from '../metro/metroMemo';
import { createMetroService, type MetroService } from '../metro/metroService';

let shared: RailService | null = null;

export function railCacheDir(): string {
  return path.join(app.getPath('userData'), RAIL_CACHE_DIR_NAME);
}

function railService(): RailService {
  if (shared) return shared;
  shared = createRailService({
    fetchFn: (input, init) => fetch(input, init),
    cacheDir: railCacheDir(),
    credentials: () => {
      const clientId = getDataKey(DATA_KEY_TDX_ID);
      const clientSecret = getDataKey(DATA_KEY_TDX_SECRET);
      return clientId && clientSecret ? { clientId, clientSecret } : null;
    },
    now: () => new Date(),
  });
  return shared;
}

let sharedMetro: MetroService | null = null;

/** The metro tools' service: one cache for every question, kept across reconnects like the rail one. */
function metroService(): MetroService {
  if (sharedMetro) return sharedMetro;
  sharedMetro = createMetroService({
    fetchFn: (input, init) => fetch(input, init),
    memo: createMetroMemo(),
    now: () => new Date(),
    catalog: METRO_CATALOG,
    mapPicture: saveMapPicture,
  });
  return sharedMetro;
}

export async function connectRailMcp(clientName: string, clientVersion: string): Promise<InProcessConnection> {
  return connectInProcess(createRailMcpServer(railService(), metroService()), clientName, clientVersion);
}
