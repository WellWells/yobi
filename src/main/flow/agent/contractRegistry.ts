import type { McpTool } from '../../mcp/mcpTypes';
import { BUILTIN_THUNDERBIRD_SERVER_ID, BUILTIN_X_SERVER_ID } from '../../../shared/builtinConnectors';
import { genericContract } from './toolContracts';
import type { LedgerView, ToolContract } from './toolContracts';
import { THUNDERBIRD_CONTRACTS, THUNDERBIRD_NOTES } from './connectors/thunderbirdContract';
import { X_NOTES } from './connectors/xContract';
import { NOTION_CONTRACTS, NOTION_NOTES } from './connectors/notionContract';
import { renderIdentityContext } from './connectors/thunderbirdFacts';

interface ConnectorContracts {
  tools: Readonly<Record<string, ToolContract>>;
  /** Traps the tool descriptions do not state, rendered once with that connector's catalog. */
  notes: string;
}

/**
 * Connectors Yobi knows well enough to describe precisely. Everything else falls back to
 * `genericContract`: MCP annotations, then the verb in the tool name, and an unknown tool is never
 * treated as a read.
 */
const CONNECTORS: Readonly<Record<string, ConnectorContracts>> = {
  [BUILTIN_THUNDERBIRD_SERVER_ID]: { tools: THUNDERBIRD_CONTRACTS, notes: THUNDERBIRD_NOTES },
  [BUILTIN_X_SERVER_ID]: { tools: {}, notes: X_NOTES },
};

/**
 * Remote servers the user adds themselves get a random id, so these are recognized by the names of
 * their tools instead. Only names no other server would plausibly use belong here.
 */
const KNOWN_TOOLSETS: readonly ConnectorContracts[] = [
  { tools: NOTION_CONTRACTS, notes: NOTION_NOTES },
];

function toolsetContract(name: string): ToolContract | undefined {
  for (const toolset of KNOWN_TOOLSETS) {
    if (Object.hasOwn(toolset.tools, name)) return toolset.tools[name];
  }
  return undefined;
}

export function resolveToolContract(serverId: string, tool: McpTool): ToolContract {
  return CONNECTORS[serverId]?.tools[tool.name] ?? toolsetContract(tool.name) ?? genericContract(tool);
}

/** Yobi's own translated name for a connector tool it describes, or undefined for anything else. */
export function toolTitleKey(serverId: string, toolName: string): string | undefined {
  return CONNECTORS[serverId]?.tools[toolName]?.titleKey;
}

export interface NotedServer {
  serverId: string;
  tools: readonly McpTool[];
}

export function connectorNotes(servers: readonly NotedServer[]): string[] {
  const notes = servers.map((server) => CONNECTORS[server.serverId]?.notes
    ?? KNOWN_TOOLSETS.find((toolset) => server.tools.some((tool) => Object.hasOwn(toolset.tools, tool.name)))?.notes
    ?? '');
  return [...new Set(notes)].filter(Boolean);
}

/** Facts about the user's own configuration the model should not have to guess, capped for the prompt. */
export function renderRuntimeContext(ledger: LedgerView, maxChars: number): string {
  const text = renderIdentityContext(ledger);
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}
