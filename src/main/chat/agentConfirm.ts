import type { BrowserWindow } from 'electron';
import { config } from '../config';
import { isWriteAutoApproved } from '../flow/agent/mcpTools';
import { sendLog } from '../helpers';
import { t } from '../i18n';
import type { AgentConfirmRequest, McpConfirmRequest } from '../flow/agent/agentEngine';
import type { FlowWriteConfirmRequest } from '../flow/agent/agentBuiltins';
import { askRenderer } from './agentConfirmBridge';
import type { CommandOrigin } from './commandOrigin';

type Strings = Record<string, string>;
type GetWin = () => BrowserWindow | null;

/** Long argument blobs are trimmed here so the renderer never has to decide what to drop. */
const ARGS_PREVIEW_LIMIT = 800;

async function confirmMcpWrite(
  req: McpConfirmRequest,
  getMainWin: GetWin,
  strings: Strings,
  origin: CommandOrigin,
): Promise<boolean> {
  if (isWriteAutoApproved(config.mcpServers, req.serverId)) {
    sendLog(`🔓 [Agent] ${req.serverName}: ${req.toolName} — ${t(strings, 'agent.mcp.confirm.autoApproved')}`);
    return true;
  }
  // Nobody is at the machine to answer a dialog, and the queue has no hard timeout, so a
  // prompt here would stall every task behind it. Deny instead and let the agent adapt.
  if (origin === 'bot') {
    sendLog(`🔒 [Agent] ${req.serverName}: ${req.toolName} — ${t(strings, 'agent.mcp.confirm.botDenied')}`);
    return false;
  }

  const argsPreview = JSON.stringify(req.args, null, 2);
  const choice = await askRenderer(getMainWin(), {
    kind: 'mcp',
    serverName: req.serverName,
    toolName: req.toolName,
    argsPreview: argsPreview.length > ARGS_PREVIEW_LIMIT ? `${argsPreview.slice(0, ARGS_PREVIEW_LIMIT)}…` : argsPreview,
  });

  if (choice === 'approveAlways') {
    const { getMcpRegistry } = await import('../mcp');
    getMcpRegistry()?.setAutoApproveWrites(req.serverId, true);
  }
  return choice !== 'deny';
}

/**
 * Approves saving a flow the agent just built. Deliberately offers no "always allow": the agent's
 * observations come from web pages, so a standing permission to write flows is a standing
 * invitation for a poisoned page to leave a scheduled shell step behind. The dialog lists the
 * step types for the same reason — "a flow that reads a feed" and "a flow that runs a command
 * every morning" read identically until someone spells out the steps.
 */
async function confirmFlowWrite(
  req: FlowWriteConfirmRequest,
  getMainWin: GetWin,
  strings: Strings,
  origin: CommandOrigin,
): Promise<boolean> {
  if (origin === 'bot') {
    sendLog(`🔒 [Agent] ${req.flowName} — ${t(strings, 'agent.flow.confirm.botDenied')}`);
    return false;
  }

  const choice = await askRenderer(getMainWin(), {
    kind: 'flow',
    flowName: req.flowName,
    stepTypes: req.stepTypes,
    sensitiveTypes: req.sensitiveTypes,
  });
  return choice !== 'deny';
}

/**
 * Decides whether an agent may take an action that leaves state behind. From the app this asks
 * the user through an in-app dialog; from a bot it cannot, so MCP falls back to what the user has
 * already approved standing and a flow write is refused outright.
 */
export function buildAgentConfirm(
  getMainWin: GetWin,
  strings: Strings,
  origin: CommandOrigin,
): (req: AgentConfirmRequest) => Promise<boolean> {
  return async (req) => (req.kind === 'flow'
    ? confirmFlowWrite(req, getMainWin, strings, origin)
    : confirmMcpWrite(req, getMainWin, strings, origin));
}
