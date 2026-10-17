import {
  BOT_COMMAND_RE,
  BUILTIN_AGENT_COMMAND,
  BUILTIN_CHAT_COMMAND,
  BUILTIN_MODEL_COMMAND,
  BUILTIN_NEW_ALIAS,
  BUILTIN_NEW_COMMAND,
  BUILTIN_RECAP_COMMAND,
} from './types';
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
 * The desktop chat's own commands. A connector never takes one of these, whatever it is named.
 * Shared by the chat (which lists them) and Settings (which says why a connector has no command).
 */
export const CHAT_BUILTIN_COMMAND_NAMES: ReadonlySet<string> = new Set([
  BUILTIN_NEW_COMMAND, BUILTIN_NEW_ALIAS,
  BUILTIN_MODEL_COMMAND,
  BUILTIN_RECAP_COMMAND,
  BUILTIN_CHAT_COMMAND,
  BUILTIN_AGENT_COMMAND,
]);

/** Who holds a command name that a connector also wanted. */
export type McpCommandOwner =
  | { kind: 'builtin' }
  | { kind: 'flow'; flowId: string; name: string }
  | { kind: 'connector'; serverId: string; name: string };

export interface McpCommandClash<T> {
  server: T;
  command: string;
  owner: McpCommandOwner;
}

export interface McpCommandAssignment<T> {
  assigned: { server: T; command: string }[];
  /** Servers left without a command because their name was already held, and by whom. */
  clashes: McpCommandClash<T>[];
}

/**
 * The names connectors cannot take: the chat's built-ins first, then each flow chat command. A
 * flow the user wrote wins its own name, matching how bot commands settle the same clash.
 */
export function reservedCommandOwners(
  flowCommands: readonly { flowId: string; command: string }[],
  flowName: (flowId: string) => string,
): Map<string, McpCommandOwner> {
  const owners = new Map<string, McpCommandOwner>();
  for (const name of CHAT_BUILTIN_COMMAND_NAMES) owners.set(name, { kind: 'builtin' });
  for (const { flowId, command } of flowCommands) {
    if (owners.has(command)) continue;
    owners.set(command, { kind: 'flow', flowId, name: flowName(flowId) });
  }
  return owners;
}

/**
 * Resolve one command per server. A server whose name is already held gets none — and is reported
 * in `clashes` with the holder, so Settings can say so instead of the command silently missing.
 * `reserved` is mutated so successive calls keep agreeing with each other; first server wins,
 * which matches how flow chat commands settle their own clashes.
 */
export function assignMcpCommandNames<T extends Pick<McpServerConfig, 'id' | 'name' | 'url' | 'commandName'>>(
  servers: readonly T[],
  reserved: Map<string, McpCommandOwner>,
): McpCommandAssignment<T> {
  const assigned: { server: T; command: string }[] = [];
  const clashes: McpCommandClash<T>[] = [];
  for (const server of servers) {
    const command = resolveMcpCommandName(server);
    if (!isValidCommandName(command)) continue;
    const owner = reserved.get(command);
    if (owner) {
      clashes.push({ server, command, owner });
      continue;
    }
    reserved.set(command, { kind: 'connector', serverId: server.id, name: server.name });
    assigned.push({ server, command });
  }
  return { assigned, clashes };
}
