import type { BrowserWindow } from 'electron';
import { config } from '../config';
import { findBuiltinConnector } from '../../shared/builtinConnectors';
import { isWriteAutoApproved } from '../flow/agent/mcpTools';
import { sendLog } from '../helpers';
import { t } from '../i18n';
import { getMcpRegistry } from '../mcp';
import type { AgentConfirmRequest, McpConfirmRequest, ShellConfirmRequest } from '../flow/agent/agentEngine';
import { SHELL_COMMAND_MAX } from '../flow/agent/shellApproval';
import type { ShellApprovalText } from '../flow/agent/shellApproval';
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
  // A bot run has nobody at the desk to ask, so it can only refuse — before "always allow" is even
  // read. That grant was the desktop user skipping their own dialog; it was never a write permission
  // for whoever is paired with the bot.
  if (origin === 'bot') {
    sendLog(`🔒 [Agent] ${req.serverName}: ${req.toolName} — ${t(strings, 'agent.mcp.confirm.botDenied')}`);
    return false;
  }
  // Sending and deleting are asked every time. "Always allow" was granted for edits; it was never a
  // standing permission to mail other people or throw the user's things away.
  if (!req.forceAsk && isWriteAutoApproved(config.mcpServers, req.serverId)) {
    sendLog(`🔓 [Agent] ${req.serverName}: ${req.toolName} — ${t(strings, 'agent.mcp.confirm.autoApproved')}`);
    return true;
  }

  // A built-in connector is not in config.mcpServers, so "always allow" has nowhere to be saved: hide it.
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
    ...(req.edit ? { edit: req.edit } : {}),
    ...(req.recipients?.length ? { recipients: req.recipients } : {}),
  });
  return choice !== 'deny';
}

/**
 * A command longer than `SHELL_COMMAND_MAX` is refused, not clipped: the string the user approves
 * must be exactly the string that runs, or a harmless-looking prefix could hide an appended payload.
 */
/*
 * Every command is asked, every time; there is deliberately no "allow for the rest of this run".
 * The agent reads untrusted pages into the same prompt that picks the next command, so a blanket
 * approval could be abused by the very run that earned it. A stray `approveAlways` counts as a
 * one-time approve.
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
  if (req.command.length > SHELL_COMMAND_MAX) {
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

function interpreterLabel(interpreter: string): string {
  const name = interpreter.split(/[\\/]/).pop() ?? interpreter;
  if (/^powershell(\.exe)?$/i.test(name)) return 'PowerShell';
  if (/^cmd(\.exe)?$/i.test(name)) return 'cmd';
  return name;
}

/**
 * The chat question that stands in for the shell dialog on a bot run: the whole command in a code
 * block whose fence outlasts any backtick run inside it, so no command can close the block early
 * and dress its tail up as prose.
 */
export function shellApprovalText(req: ShellConfirmRequest, strings: Strings): ShellApprovalText {
  const longestRun = Math.max(0, ...(req.command.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  const lead = t(strings, 'agent.shell.approve.question', { shell: interpreterLabel(req.interpreter) });
  return {
    question: `${lead}\n\n${fence}\n${req.command}\n${fence}`,
    choices: [t(strings, 'agent.shell.approve.run'), t(strings, 'agent.shell.approve.cancel')],
  };
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
