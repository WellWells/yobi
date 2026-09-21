import type { McpTool } from '../../mcp/mcpTypes';
import { BUILTIN_THUNDERBIRD_SERVER_ID } from '../../../shared/builtinConnectors';
import { genericContract } from './toolContracts';
import type { LedgerView, ToolContract } from './toolContracts';
import { THUNDERBIRD_CONTRACTS, THUNDERBIRD_NOTES } from './connectors/thunderbirdContract';
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
};

export function resolveToolContract(serverId: string, tool: McpTool): ToolContract {
  return CONNECTORS[serverId]?.tools[tool.name] ?? genericContract(tool);
}

export function connectorNotes(serverIds: readonly string[]): string[] {
  return [...new Set(serverIds)].map((id) => CONNECTORS[id]?.notes ?? '').filter(Boolean);
}

/** Facts about the user's own configuration the model should not have to guess, capped for the prompt. */
export function renderRuntimeContext(ledger: LedgerView, maxChars: number): string {
  const text = renderIdentityContext(ledger);
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}
