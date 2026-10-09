import { findCatalogEntry, MCP_CATALOG, normalizeMcpUrl } from '../../../../../../shared/mcpCatalog';
import type { McpCatalogCategory, McpCatalogEntry } from '../../../../../../shared/mcpCatalog';
import { findBuiltinConnector } from '../../../../../../shared/builtinConnectors';
import type { McpServerView } from '../../../../../../shared/types';

export interface ConnectorTile {
  key: string;
  entry?: McpCatalogEntry;
  server?: McpServerView;
  name: string;
  description: string;
  category?: McpCatalogCategory;
  haystack: string;
}

/**
 * The line under a connector's name. A failure reason replaces the description, except for a
 * server that only needs signing in again: its badge already says so.
 */
export function connectorCardDetail(server: McpServerView | undefined, description: string): string {
  if (!server?.error || server.status === 'connected' || server.status === 'needs_auth') return description;
  return server.error;
}

export function buildTiles(servers: readonly McpServerView[], t: (key: string) => string): ConnectorTile[] {
  const byUrl = new Map(servers.map((server) => [normalizeMcpUrl(server.url), server]));
  const tiles: ConnectorTile[] = [];

  for (const entry of MCP_CATALOG) {
    const server = byUrl.get(normalizeMcpUrl(entry.url));
    const name = server?.name ?? entry.name;
    const description = t(`settings.mcp.catalog.${entry.id}.desc`);
    tiles.push({
      key: entry.id,
      entry,
      ...(server ? { server } : {}),
      name,
      description,
      category: entry.category,
      haystack: `${name} ${entry.name} ${description} ${entry.url}`.toLowerCase(),
    });
  }

  for (const server of servers) {
    if (findBuiltinConnector(server.id)) continue; // rendered by its own built-in card
    if (findCatalogEntry(server.url)) continue;
    tiles.push({
      key: server.id,
      server,
      name: server.name,
      description: server.url,
      haystack: `${server.name} ${server.url}`.toLowerCase(),
    });
  }

  return tiles;
}

/**
 * A built-in card goes through the same search and chips as the catalog: it has no catalog
 * category and no open-access entry, so only "All" and "Connected" can keep it.
 */
export function builtinTile(
  id: string,
  servers: readonly McpServerView[],
  name: string,
  description: string,
): ConnectorTile {
  const server = servers.find((s) => s.id === id);
  return {
    key: id,
    ...(server ? { server } : {}),
    name,
    description,
    haystack: `${name} ${description}`.toLowerCase(),
  };
}

export function matchesFilter(tile: ConnectorTile, filter: string): boolean {
  if (filter === 'all') return true;
  if (filter === 'connected') return tile.server?.status === 'connected';
  if (filter === 'open') return tile.entry?.auth === 'open';
  return tile.category === filter;
}

export function matchesQuery(tile: ConnectorTile, query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;
  return trimmed.split(/\s+/).every((word) => tile.haystack.includes(word));
}
