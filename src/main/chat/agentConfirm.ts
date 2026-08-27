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

export function buildAgentConfirm(
  getMainWin: GetWin,
  strings: Strings,
  origin: CommandOrigin,
): (req: AgentConfirmRequest) => Promise<boolean> {
  return async (req) => (req.kind === 'flow'
    ? confirmFlowWrite(req, getMainWin, strings, origin)
    : confirmMcpWrite(req, getMainWin, strings, origin));
}
