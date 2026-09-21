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
