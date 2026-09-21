import { BOT_COMMAND_RE } from './types';
import type { McpServerConfig } from './types';
import { findCatalogEntry } from './mcpCatalog';

/**
 * Synthetic ChatCommand id for a per-server MCP command. Real flows never own an id of this
 * shape, so the chat dispatcher can branch on the prefix instead of consulting the flow store.
 */
export const MCP_COMMAND_ID_PREFIX = '__mcp:';

export function mcpCommandFlowId(serverId: string): string {
  return `${MCP_COMMAND_ID_PREFIX}${serverId}__`;
}

export function parseMcpCommandFlowId(flowId: string): string | null {
  if (!flowId.startsWith(MCP_COMMAND_ID_PREFIX) || !flowId.endsWith('__')) return null;
  const id = flowId.slice(MCP_COMMAND_ID_PREFIX.length, -2);
  return id.length > 0 ? id : null;
}

/**
 * The slash menu only opens while the whole input matches /^\/([a-zA-Z0-9_]*)$/, so a command
 * carrying a hyphen or a dot can be typed but never suggested. Everything here is folded into
 * [a-z0-9_] for that reason, not for cosmetics.
 */
export function slugifyCommandName(raw: string): string {
  const folded = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!folded) return '';
  const led = /^[a-z]/.test(folded) ? folded : `s_${folded}`;
  return led.slice(0, 32);
}

/**
 * The default command for a server. A catalog entry wins because its id is a stable per-brand
 * slug (`notion`, `github`) that survives the user renaming the connector; anything else falls
 * back to the display name.
 */
export function defaultMcpCommandName(server: Pick<McpServerConfig, 'name' | 'url'>): string {
  const entry = findCatalogEntry(server.url);
  return slugifyCommandName(entry ? entry.id : server.name) || 'mcp';
}

export function isValidCommandName(name: string): boolean {
  return BOT_COMMAND_RE.test(name);
}

export function resolveMcpCommandName(server: Pick<McpServerConfig, 'name' | 'url' | 'commandName'>): string {
  const explicit = (server.commandName ?? '').trim();
  if (explicit && isValidCommandName(explicit)) return explicit;
  return defaultMcpCommandName(server);
}

/**
 * Resolve one command per server, dropping any that collides with a name already spoken for.
 * `reserved` is mutated so successive calls keep agreeing with each other; first server wins,
 * which matches how flow chat commands settle their own clashes.
 */
export function assignMcpCommandNames<T extends Pick<McpServerConfig, 'id' | 'name' | 'url' | 'commandName'>>(
  servers: readonly T[],
  reserved: Set<string>,
): { server: T; command: string }[] {
  const assigned: { server: T; command: string }[] = [];
  for (const server of servers) {
    const command = resolveMcpCommandName(server);
    if (!isValidCommandName(command) || reserved.has(command)) continue;
    reserved.add(command);
    assigned.push({ server, command });
  }
  return assigned;
}
