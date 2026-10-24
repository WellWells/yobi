import { AGENT_ASK_TOOL } from '../../../shared/types';
import { LINE_TEXT_MAX, TELEGRAM_MESSAGE_MAX } from '../../../shared/botMessageLimits';

/**
 * A shell command asked about in the chat instead of a desktop dialog (a Telegram / LINE run).
 *
 * The bot handles one update at a time and awaits the whole run, so a confirmation the run waited
 * for in place could never be answered: the button press would queue behind the run waiting for
 * it. The run therefore pauses, the same way `ask_user` does, with the exact command in the
 * question, and the answer resumes it. What runs is the command stored on that question, never one
 * the model writes after the answer, so "1" approves exactly the string the user read.
 */

/**
 * A command longer than this is REFUSED, not clipped — by the desktop dialog and by the chat
 * question alike, because both show the whole string and what is shown is what runs.
 */
export const SHELL_COMMAND_MAX = 8_000;

/**
 * The longest question a bot can show whole: one plain-text message on Telegram and on LINE alike.
 * The approval is sent verbatim (no Markdown, no HTML escaping), so characters count one for one.
 */
export const BOT_QUESTION_TEXT_MAX = Math.min(TELEGRAM_MESSAGE_MAX, LINE_TEXT_MAX);

/** Kept free under the question for the reply hint the bot appends (`bot.builtin.answerHint` + a blank line). */
export const BOT_QUESTION_HINT_RESERVE = 200;

/**
 * Format and direction controls render as nothing, or reorder what is around them, so the string a
 * user reads is not the string the shell gets: bidi embeddings, overrides and isolates (U+202A–E,
 * U+2066–9), marks (U+200E/F, U+061C), zero-width characters (U+200B–D, U+2060, U+FEFF) and the
 * rest of `\p{Cf}`; line and paragraph separators, which a chat breaks a line at and a shell does
 * not; and C0/C1 controls (escape sequences, backspace) other than tab, line feed and carriage return.
 */
const HIDDEN_CHARACTER = /[\p{Cf}\p{Zl}\p{Zp}\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;

/** Everything that does not show as itself in a chat line: the above plus tab, line feed and carriage return. */
const UNSEEN_CHARACTER = /[\p{Cf}\p{Zl}\p{Zp}\p{Cc}]/gu;

const WRITTEN_OUT: Record<string, string> = { '\n': '\\n', '\r': '\\r', '\t': '\\t' };

/**
 * One line a person reads as exactly what it holds: a break is written `\n`, every other unseen
 * character as its code (`‮`). An approval shows a connector call's arguments this way, so a
 * value cannot draw a line of its own or read differently from what runs.
 */
export function writeOutUnseen(text: string): string {
  return text.replace(UNSEEN_CHARACTER, (char) => WRITTEN_OUT[char]
    ?? `\\u${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`);
}

/** Prose with the unseen characters taken out and line breaks turned into spaces (the model's own sentence). */
export function withoutUnseen(text: string): string {
  return text.replace(UNSEEN_CHARACTER, (char) => (char === '\n' || char === '\r' || char === '\t' ? ' ' : ''));
}

/** The shells a model may name on macOS/Linux; anything else is a program, not a shell. */
const KNOWN_UNIX_SHELLS = new Set(['sh', 'bash', 'zsh', 'fish', 'pwsh', 'powershell', 'cmd']);

function codePointLabel(char: string): string {
  return `U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`;
}

/**
 * Why this shell call cannot be shown honestly, or null. Checked for every origin, the desktop
 * dialog included: a hidden character in the command (or the shell) means the approval covers a
 * string the user did not see. On macOS/Linux the `shell` field is handed to the system as the
 * program to start, so it must name a shell.
 */
export function shellTextDenyReason(config: Record<string, string>, platform: NodeJS.Platform): string | null {
  for (const [field, value] of [['command', config.command ?? ''], ['shell', config.shell ?? '']] as const) {
    const hidden = HIDDEN_CHARACTER.exec(value);
    if (hidden) {
      return `refused: the ${field} contains an invisible or text-direction control character (${codePointLabel(hidden[0])}), so what the user would approve is not what would run. Write it again with plain visible characters only.`;
    }
  }
  if (platform === 'win32') return null;
  const shell = (config.shell ?? '').trim();
  if (!shell || shell === 'auto') return null;
  const name = shell.split('/').pop() ?? '';
  if (KNOWN_UNIX_SHELLS.has(name)) return null;
  return `refused: "shell" must be one of ${[...KNOWN_UNIX_SHELLS].join(', ')} (a name or a path to one), or blank for the default. To run another program, call it inside the command.`;
}

/** The fence for a command: longer than any backtick run inside it, so the command cannot close it. */
export function fencedCommand(command: string): string {
  const longestRun = Math.max(0, ...(command.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `${fence}\n${command}\n${fence}`;
}

/**
 * A question as the chat shows it: the words, then the choices numbered — a bot user can only type,
 * and "2" is expanded back to the choice when the answer arrives.
 */
export function numberedQuestion(question: string, choices: readonly string[]): string {
  if (choices.length === 0) return question;
  return `${question}\n\n${choices.map((choice, index) => `${index + 1}. ${choice}`).join('\n')}`;
}

/**
 * Why this command cannot be put to a bot user, or null. The question is refused rather than
 * clipped when it would not fit one message whole, so "1" never approves a part nobody saw.
 */
export function chatQuestionRefusal(command: string, text: ShellApprovalText): string | null {
  const shown = numberedQuestion(text.question, text.choices).length + BOT_QUESTION_HINT_RESERVE;
  if (shown <= BOT_QUESTION_TEXT_MAX) return null;
  const room = Math.max(0, command.length - (shown - BOT_QUESTION_TEXT_MAX));
  return `refused: the command is too long to show in full in the chat message that asks the user to approve it. Keep it under ${room} characters, or split the work into shorter commands.`;
}

/** The keys the pending question keeps the command under, next to `question` and `choices`. */
export const SHELL_APPROVAL_COMMAND_KEY = 'shellCommand';
export const SHELL_APPROVAL_SHELL_KEY = 'shellName';

/** Words of the question and its two choices, written by the caller in the user's language. */
export interface ShellApprovalText {
  question: string;
  /** [run, cancel] — the first one, or its number, is the only approval. */
  choices: [string, string];
}

interface AskRecord {
  tool: string;
  config: Record<string, string>;
  observation: string;
}

export interface PendingShell {
  command: string;
  /** The `shell` field the model asked for ('' = the platform default). */
  shell: string;
}

/** The command a question in the scratch asked about, or null for an ordinary question. */
export function shellApprovalOf(entry: AskRecord): PendingShell | null {
  if (entry.tool !== AGENT_ASK_TOOL) return null;
  const command = entry.config[SHELL_APPROVAL_COMMAND_KEY];
  if (typeof command !== 'string' || !command) return null;
  return { command, shell: entry.config[SHELL_APPROVAL_SHELL_KEY] ?? '' };
}

/** The config of the pending question: what the user reads, and what will run if they say yes. */
export function shellApprovalConfig(text: ShellApprovalText, pending: PendingShell): Record<string, string> {
  return {
    question: text.question,
    choices: JSON.stringify(text.choices),
    [SHELL_APPROVAL_COMMAND_KEY]: pending.command,
    ...(pending.shell ? { [SHELL_APPROVAL_SHELL_KEY]: pending.shell } : {}),
  };
}

function readChoices(config: Record<string, string>): string[] {
  try {
    const parsed: unknown = JSON.parse(config.choices ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((choice): choice is string => typeof choice === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Whether the answer approves the command (or the connector change). Strict on purpose: only the
 * first choice — pressed, typed out, or picked by number where the choices were shown numbered
 * ("1" arrives here as "1. Run" only then, `applyAnswer`). A bare "1" never approves: under
 * buttons the user saw no numbers, so it may be anything. Anything else — "2", "no", "use
 * PowerShell instead" — is not a yes, and the model reads the answer to decide what to do next.
 */
export function isShellApproved(entry: AskRecord): boolean {
  const [run] = readChoices(entry.config);
  const answer = entry.observation.trim();
  if (!run || !answer) return false;
  return answer === run || answer === `1. ${run}`;
}

/** What the model reads in place of an answer that did not approve the command. */
export function declinedShellObservation(answer: string): string {
  const said = answer.trim() ? ` Their reply: "${answer.trim()}".` : '';
  return `The user did not approve running this command, so it did not run.${said} Do not send it again — follow their reply, take a different approach, or finish.`;
}

/** Said when the account lost the shell grant while the question was waiting. */
export const SHELL_NO_LONGER_ALLOWED = 'The command did not run: running commands is no longer allowed for this account. Do not try shell again — answer with what you have.';

/*
 * A connector change asked about in the chat, the same way and for the same reason as a shell
 * command: the run pauses, and the call stored on the question — server, tool and arguments as
 * the user read them — is the one that runs when the answer approves it. Only the owner's own
 * private chat is asked (`computeBotConnectorChanges`); anyone else's change is refused.
 */
export const CONNECTOR_APPROVAL_SERVER_KEY = 'mcpServerId';
export const CONNECTOR_APPROVAL_TOOL_KEY = 'mcpTool';
export const CONNECTOR_APPROVAL_ARGS_KEY = 'mcpArguments';

export interface PendingConnectorChange {
  /** The server's id, not the handle: handles are renumbered when the set of servers changes. */
  serverId: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** The change a question in the scratch asked about, or null for any other question. */
export function connectorApprovalOf(entry: AskRecord): PendingConnectorChange | null {
  if (entry.tool !== AGENT_ASK_TOOL) return null;
  const serverId = entry.config[CONNECTOR_APPROVAL_SERVER_KEY];
  const name = entry.config[CONNECTOR_APPROVAL_TOOL_KEY];
  if (!serverId || !name) return null;
  try {
    const parsed: unknown = JSON.parse(entry.config[CONNECTOR_APPROVAL_ARGS_KEY] ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return { serverId, name, arguments: parsed as Record<string, unknown> };
  } catch {
    return null;
  }
}

export function connectorApprovalConfig(text: ShellApprovalText, pending: PendingConnectorChange): Record<string, string> {
  return {
    question: text.question,
    choices: JSON.stringify(text.choices),
    [CONNECTOR_APPROVAL_SERVER_KEY]: pending.serverId,
    [CONNECTOR_APPROVAL_TOOL_KEY]: pending.name,
    [CONNECTOR_APPROVAL_ARGS_KEY]: JSON.stringify(pending.arguments),
  };
}

export function declinedConnectorObservation(answer: string): string {
  const said = answer.trim() ? ` Their reply: "${answer.trim()}".` : '';
  return `The user did not approve this change, so it was not made.${said} Do not propose it again — follow their reply, take a different approach, or finish.`;
}

/** Said when the connector is no longer in this run's reach (grant revoked, server removed). */
export const CONNECTOR_CHANGE_NO_LONGER_ALLOWED = 'The change was not made: this connector is no longer available to this run. Do not try it again — answer with what you have.';

/*
 * A flow an admin's bot run built or changed, asked about in the chat for the same reason. Unlike a
 * command, the flow itself is not stored on the question: the question's config is replayed into the
 * model's prompt, and a resolved flow holds the paired chat ids its bot steps send to. The question
 * carries only this marker; the flow waits on the run (`AgentRunState.pendingFlow`).
 */
export const FLOW_APPROVAL_KEY = 'flowApproval';

/** Whether a question in the scratch asked to save a held flow. */
export function isFlowApproval(entry: AskRecord): boolean {
  return entry.tool === AGENT_ASK_TOOL && entry.config[FLOW_APPROVAL_KEY] === '1';
}

export function flowApprovalConfig(text: ShellApprovalText): Record<string, string> {
  return { question: text.question, choices: JSON.stringify(text.choices), [FLOW_APPROVAL_KEY]: '1' };
}

export function declinedFlowObservation(answer: string): string {
  const said = answer.trim() ? ` Their reply: "${answer.trim()}".` : '';
  return `The user did not approve saving this flow, so nothing was saved.${said} Do not build it again unasked — follow their reply (change it with what they said, or finish).`;
}

/** Said when the account may no longer build flows from the chat, or the flow went missing. */
export const FLOW_SAVE_NO_LONGER_ALLOWED = 'Nothing was saved: this account may no longer save flows from the chat. Do not try again — tell the user to save it from the desktop.';

/** Questions the model asked itself; an approval is the program's, and does not use one up. */
export function isModelQuestion(entry: AskRecord): boolean {
  return entry.tool === AGENT_ASK_TOOL && shellApprovalOf(entry) === null && connectorApprovalOf(entry) === null && !isFlowApproval(entry);
}
