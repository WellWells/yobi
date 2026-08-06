import { isByokTargetUrl } from '../../../shared/types';
import { detectProvider, PROVIDER_PROMPT_POLICIES } from '../../providers';
import { INSTRUCTION_EST, readPlanFields } from './agentPrompts';
import type { Validation } from './structuredLlm';
import type { McpTool, McpToolResult } from '../../mcp/mcpTypes';
import type { ConnectedServerTools } from '../../mcp/mcpRegistry';

export interface McpServerHandle {
  handle: string;
  serverId: string;
  serverName: string;
  tools: McpTool[];
}

export interface McpRuntimeIndex {
  handles: McpServerHandle[];
  byHandle: Map<string, McpServerHandle>;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'server';
}

export function buildMcpIndex(connected: ConnectedServerTools[]): McpRuntimeIndex {
  const handles: McpServerHandle[] = [];
  const used = new Set<string>();
  for (const server of connected) {
    if (server.tools.length === 0) continue;
    const base = slugify(server.serverName);
    let candidate = base;
    let n = 2;
    while (used.has(candidate)) candidate = `${base}-${n++}`;
    used.add(candidate);
    handles.push({ handle: candidate, serverId: server.serverId, serverName: server.serverName, tools: server.tools });
  }
  return { handles, byHandle: new Map(handles.map((h) => [h.handle, h])) };
}

export function hasMcpTools(index: McpRuntimeIndex): boolean {
  return index.handles.length > 0;
}

export function filterAgentServers(
  connected: readonly ConnectedServerTools[],
  servers: readonly { id: string; agentEnabled?: boolean }[],
): ConnectedServerTools[] {
  const allowed = new Set(servers.filter((s) => s.agentEnabled !== false).map((s) => s.id));
  return connected.filter((entry) => allowed.has(entry.serverId));
}

export function isWriteAutoApproved(
  servers: readonly { id: string; autoApproveWrites?: boolean }[],
  serverId: string,
): boolean {
  return servers.some((s) => s.id === serverId && s.autoApproveWrites === true);
}

const WRITE_VERBS = new Set([
  'create', 'update', 'patch', 'delete', 'del', 'write', 'insert', 'append', 'remove',
  'move', 'archive', 'send', 'modify', 'edit', 'upload', 'duplicate', 'merge', 'comment',
  'revoke', 'cancel', 'set', 'make', 'rename', 'clear', 'drop', 'add',
]);
const READ_VERBS = new Set([
  'get', 'list', 'search', 'retrieve', 'query', 'read', 'fetch', 'find', 'view',
  'describe', 'export', 'download', 'show', 'lookup', 'count',
]);

function nameTokens(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function classifyMcpTool(tool: McpTool): 'read' | 'write' {
  const tokens = nameTokens(tool.name);
  if (tokens.some((token) => WRITE_VERBS.has(token))) return 'write';
  const hint = tool.annotations?.readOnlyHint;
  if (hint === true) return 'read';
  if (hint === false) return 'write';
  if (tokens.some((token) => READ_VERBS.has(token))) return 'read';
  return 'write';
}

const SCRATCH_OVERHEAD = 380;
const SAFETY_MARGIN = 1_200;
const MCP_MIN_BUDGET = 1_000;
const BYOK_CATALOG_BUDGET = 40_000;

export function mcpCatalogBudgetChars(
  providerUrl: string,
  builtinCatalogLen: number,
  goalLen: number,
  scratchSlots: number,
  observationLimit: number,
  historyLen = 0,
): number {
  if (isByokTargetUrl(providerUrl)) return BYOK_CATALOG_BUDGET;
  const policy = PROVIDER_PROMPT_POLICIES[detectProvider(providerUrl)];
  const cap = policy.maxCharsPlusBreaks ?? policy.maxBytes ?? 0;
  const scratchCost = scratchSlots * (observationLimit + SCRATCH_OVERHEAD);
  const budget = cap - INSTRUCTION_EST - builtinCatalogLen - goalLen - historyLen - scratchCost - SAFETY_MARGIN;
  return budget < MCP_MIN_BUDGET ? 0 : budget;
}

function firstSentence(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  const dot = trimmed.indexOf('. ');
  const sentence = dot > 0 ? trimmed.slice(0, dot + 1) : trimmed;
  return sentence.length > 130 ? `${sentence.slice(0, 129)}…` : sentence;
}

const MAX_ARGS_SHOWN = 12;

function argSummary(schema: McpTool['inputSchema']): string {
  const props = schema?.properties;
  if (!props || typeof props !== 'object') return 'none';
  const required = new Set(Array.isArray(schema?.required) ? schema.required : []);
  const keys = Object.keys(props);
  if (keys.length === 0) return 'none';
  const shown = keys.slice(0, MAX_ARGS_SHOWN).map((k) => (required.has(k) ? `${k}*` : k));
  if (keys.length > MAX_ARGS_SHOWN) shown.push('…');
  return shown.join(', ');
}

function renderToolLine(tool: McpTool): string {
  const rw = classifyMcpTool(tool);
  const desc = firstSentence(tool.description ?? '');
  return `- ${tool.name} (${rw}): ${desc} args: ${argSummary(tool.inputSchema)}`;
}

export function buildMcpCatalog(index: McpRuntimeIndex, budgetChars: number): { text: string; includedCount: number; omitted: number } {
  const lines: string[] = [];
  let used = 0;
  let includedCount = 0;
  let omitted = 0;

  for (const server of index.handles) {
    const header = `[${server.handle}] ${server.serverName}:`;
    if (used + header.length + 1 > budgetChars) {
      omitted += server.tools.length;
      continue;
    }
    lines.push(header);
    used += header.length + 1;
    for (const tool of server.tools) {
      const line = renderToolLine(tool);
      if (used + line.length + 1 <= budgetChars) {
        lines.push(line);
        used += line.length + 1;
        includedCount++;
      } else {
        omitted++;
      }
    }
  }
  if (omitted > 0) lines.push(`(+${omitted} more tool(s) not shown due to length limits.)`);
  return { text: lines.join('\n'), includedCount, omitted };
}

export function schemaHint(tool: McpTool): string {
  if (!tool.inputSchema) return '';
  return `\nInput schema for ${tool.name}: ${JSON.stringify(tool.inputSchema).slice(0, 1_200)}`;
}

export function validateMcpArguments(tool: McpTool, args: Record<string, unknown>): { ok: boolean; error?: string } {
  const required = tool.inputSchema?.required;
  if (!Array.isArray(required)) return { ok: true };
  const missing = required.filter((key) => {
    const value = (args ?? {})[key];
    return value === undefined || value === null || value === '';
  });
  if (missing.length > 0) return { ok: false, error: `Missing required argument(s): ${missing.join(', ')}` };
  return { ok: true };
}

export function formatMcpObservation(result: McpToolResult): string {
  const text = result.text || '(empty result)';
  return result.isError ? `ERROR: ${text}` : text;
}

export interface McpAction {
  thought: string;
  action: 'call_mcp';
  server: string;
  name: string;
  arguments: Record<string, unknown>;
  /** Plan bookkeeping, read the same way as on a built-in action — a run that reaches for an
   * MCP tool must not lose its checklist for the turn. */
  plan?: string[];
  planDone?: number[];
}

export function validateMcpAction(obj: Record<string, unknown>, index: McpRuntimeIndex): Validation<McpAction> {
  const thought = typeof obj.thought === 'string' ? obj.thought : '';
  const server = typeof obj.server === 'string' ? obj.server.trim() : '';
  const name = typeof obj.name === 'string' ? obj.name.trim() : '';

  const handle = index.byHandle.get(server);
  if (!handle) {
    return { ok: false, error: `"server" must be one of: ${index.handles.map((h) => `"${h.handle}"`).join(', ')}. Got "${server}".` };
  }
  if (!handle.tools.some((tool) => tool.name === name)) {
    return { ok: false, error: `"name" must be a tool on server "${server}". Got "${name}".` };
  }
  const rawArgs = obj.arguments;
  const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? (rawArgs as Record<string, unknown>) : {};
  return {
    ok: true,
    value: { thought, action: 'call_mcp', server, name, arguments: args, ...readPlanFields(obj) },
  };
}

export function resolveMcpTool(index: McpRuntimeIndex, server: string, name: string): { serverId: string; tool: McpTool } | undefined {
  const handle = index.byHandle.get(server);
  const tool = handle?.tools.find((t) => t.name === name);
  return handle && tool ? { serverId: handle.serverId, tool } : undefined;
}
