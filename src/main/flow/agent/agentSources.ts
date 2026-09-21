import { AGENT_ASK_TOOL } from '../../../shared/types';
import { AGENT_HELP_TOOL } from './agentTools';
import type { AgentTurnRecord } from '../../../shared/types';

/**
 * Where a finished run actually got its material, read back off its own turns.
 *
 * In the app the queue popover shows the live step trail, so the user can always see which tool
 * answered. A bot reply is one message with none of that: a run that answered from the web when the
 * user meant their own LINE messages looks exactly like a run that read them. This is the bot's
 * equivalent — one line, derived rather than declared, so it cannot drift from what really ran.
 */
export interface AgentSources {
  /** Connector handles called, in first-use order. */
  connectors: string[];
  /** A tool that reads the public web ran. */
  web: boolean;
  /** A tool that reads this computer's files ran. */
  files: boolean;
  /** Every other skill that ran, in first-use order — their names already say what they are. */
  tools: string[];
}

/** `planCall` labels an MCP turn `mcp:<tool>` and keeps the server handle in `config.server`. */
const MCP_PREFIX = 'mcp:';

const WEB_TOOLS = new Set(['search', 'research', 'browser', 'gmap_reviews', 'youtube']);
const FILE_TOOLS = new Set(['file_read', 'file_list', 'file_write']);

/**
 * Bookkeeping turns, not sources: `ask_user` produces no observation at all and `tool_help` returns
 * the catalog's own text, so naming either would answer "where did this come from" with "itself".
 */
const NOT_A_SOURCE = new Set<string>([AGENT_ASK_TOOL, AGENT_HELP_TOOL]);

export function agentSourcesUsed(turns: readonly AgentTurnRecord[]): AgentSources {
  const connectors: string[] = [];
  const tools: string[] = [];
  let web = false;
  let files = false;

  for (const turn of turns) {
    // Only a call that came back counts. A failed or repeat-guarded turn contributed nothing to the
    // answer, and a line that lists it would claim a source the answer was not built on.
    if (turn.status !== 'ok') continue;
    if (turn.tool.startsWith(MCP_PREFIX)) {
      const handle = (turn.config.server ?? '').trim();
      if (handle && !connectors.includes(handle)) connectors.push(handle);
      continue;
    }
    if (NOT_A_SOURCE.has(turn.tool)) continue;
    if (WEB_TOOLS.has(turn.tool)) {
      web = true;
      continue;
    }
    if (FILE_TOOLS.has(turn.tool)) {
      files = true;
      continue;
    }
    if (!tools.includes(turn.tool)) tools.push(turn.tool);
  }

  return { connectors, web, files, tools };
}

export function hasAnySource(sources: AgentSources): boolean {
  return sources.connectors.length > 0 || sources.web || sources.files || sources.tools.length > 0;
}
