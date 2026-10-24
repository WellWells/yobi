import type { BrowserWindow } from 'electron';
import { config } from '../config';
import { findBuiltinConnector } from '../../shared/builtinConnectors';
import { isWriteAutoApproved } from '../flow/agent/mcpTools';
import { sendLog } from '../helpers';
import { t } from '../i18n';
import { getMcpRegistry } from '../mcp';
import type { AgentConfirmRequest, McpConfirmRequest, ShellConfirmRequest } from '../flow/agent/agentEngine';
import { SHELL_COMMAND_MAX, fencedCommand, writeOutUnseen } from '../flow/agent/shellApproval';
import { expandableQuote } from '../../shared/expandableQuote';
import type { ShellApprovalText } from '../flow/agent/shellApproval';
import type { FlowWriteConfirmRequest } from '../flow/agent/agentBuiltins';
import { toolDisplayName } from '../flow/agent/actionOutcome';
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
  const choice = await askRenderer(getMainWin(), {
    kind: 'mcp',
    serverName: req.serverName,
    toolName: req.toolName,
    argsPreview: readableArgs(req.args),
    ...(req.summary ? { summary: req.summary } : {}),
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

/**
 * The shell as a user knows it. A path is shown whole: on macOS/Linux it is the program that will
 * be started, and `/tmp/x/bash` is not the user's bash.
 */
function interpreterLabel(interpreter: string): string {
  if (/^powershell(\.exe)?$/i.test(interpreter)) return 'PowerShell';
  if (/^cmd(\.exe)?$/i.test(interpreter)) return 'cmd';
  return interpreter;
}

/**
 * The chat question that stands in for the shell dialog on a bot run: the whole command in a code
 * block whose fence outlasts any backtick run inside it, so no command can close the block early
 * and dress its tail up as prose.
 */
export function shellApprovalText(req: ShellConfirmRequest, strings: Strings): ShellApprovalText {
  const lead = t(strings, 'agent.shell.approve.question', { shell: interpreterLabel(req.interpreter) });
  return {
    question: `${lead}\n\n${fencedCommand(req.command)}`,
    choices: [t(strings, 'agent.shell.approve.run'), t(strings, 'agent.shell.approve.cancel')],
  };
}

/**
 * One `name: value` line. Both parts are written out (`writeOutUnseen`): a break in either becomes
 * `\n`, a direction override its code, and a name cannot open with `>` — the mark a fold starts with.
 */
function argLine(key: string, value: string): string {
  return `${writeOutUnseen(key).replace(/^>/, '\\>')}: ${writeOutUnseen(value)}`;
}

function flattenArg(value: unknown, key: string, out: string[]): void {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) out.push(argLine(key, '{}'));
    for (const [inner, innerValue] of entries) flattenArg(innerValue, key ? `${key}.${inner}` : inner, out);
    return;
  }
  if (Array.isArray(value)) {
    const plain = value.every((item) => item === null || typeof item !== 'object');
    out.push(argLine(key, plain ? value.map(String).join(', ') : JSON.stringify(value)));
    return;
  }
  out.push(argLine(key, String(value)));
}

/**
 * A call's arguments as a person reads them: one `name: value` line each, nested ones dotted
 * (`transition.id: 31`), instead of a JSON block. Every argument is there — it is what runs —
 * clipped at the dialog's length.
 */
export function readableArgs(args: Record<string, unknown>): string {
  const lines: string[] = [];
  flattenArg(args, '', lines);
  const text = lines.join('\n');
  return text.length > ARGS_PREVIEW_LIMIT ? `${text.slice(0, ARGS_PREVIEW_LIMIT)}…` : text;
}

/**
 * A contract row's value as the chat shows it. It comes from the call's arguments or from what a
 * connector read (a mail's subject), so it is written out like an argument: it cannot draw a line
 * of its own or read differently from what runs. An `items` row is a list, one item per line.
 */
function rowValue(key: string, value: string): string {
  return key === 'items' ? value.split('\n').map(writeOutUnseen).join('\n') : writeOutUnseen(value);
}

/**
 * The chat question that stands in for the change dialog on the owner's bot chat (2026-10-19, user:
 * 「指令一般使用者看不懂…按鈕寫的應該是允許或是取消」). It opens with the model's own sentence saying
 * what will change, by name — only the model knows that transition "31" is "Done" — and under it
 * what the program read off the call itself (connector, operation, the contract's rows, a warning
 * when it sends or deletes), so a sentence that does not match is visible. Every argument follows,
 * folded when there is something readable above it; what it shows is what is stored to run.
 */
export function connectorApprovalText(req: McpConfirmRequest, strings: Strings): ShellApprovalText {
  const translate = (key: string, vars: Record<string, string>) => t(strings, key, vars);
  const action = toolDisplayName({ serverId: req.serverId, tool: req.toolName, title: req.toolTitle }, translate);
  const rows = (req.rows ?? []).map((row) => `${t(strings, `agent.mcp.confirm.row.${row.key}`)}: ${row.valueKey ? t(strings, row.valueKey, row.vars) : rowValue(row.key, row.value)}`);
  const danger = req.risk === 'external' || req.risk === 'destructive';
  const args = readableArgs(req.args);
  const readable = Boolean(req.summary) || rows.length > 0;
  const blocks = [
    t(strings, 'agent.mcp.approve.question', { server: req.serverName }),
    ...(req.summary ? [req.summary] : []),
    [t(strings, 'agent.mcp.approve.operation', { action }), ...rows].join('\n'),
    ...(danger ? [t(strings, 'agent.mcp.approve.danger')] : []),
    ...(args ? [readable ? expandableQuote(`${t(strings, 'agent.mcp.approve.details')}\n${args}`) : args] : []),
  ];
  return {
    question: blocks.join('\n\n'),
    choices: [t(strings, 'agent.mcp.approve.run'), t(strings, 'agent.mcp.approve.cancel')],
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
