import { AGENT_ASK_TOOL } from '../../../shared/types';

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
 * Whether the answer approves the command. Strict on purpose: only the first choice, typed or
 * picked by number ("1" arrives here as "1. Run"). Anything else — "2", "no", "use PowerShell
 * instead" — is not a yes, and the model reads the answer to decide what to do next.
 */
export function isShellApproved(entry: AskRecord): boolean {
  const [run] = readChoices(entry.config);
  const answer = entry.observation.trim();
  if (!run || !answer) return false;
  return answer === run || answer === `1. ${run}` || answer === '1';
}

/** What the model reads in place of an answer that did not approve the command. */
export function declinedShellObservation(answer: string): string {
  const said = answer.trim() ? ` Their reply: "${answer.trim()}".` : '';
  return `The user did not approve running this command, so it did not run.${said} Do not send it again — follow their reply, take a different approach, or finish.`;
}

/** Said when the account lost the shell grant while the question was waiting. */
export const SHELL_NO_LONGER_ALLOWED = 'The command did not run: running commands is no longer allowed for this account. Do not try shell again — answer with what you have.';

/** Questions the model asked itself; a shell approval is the program's, and does not use one up. */
export function isModelQuestion(entry: AskRecord): boolean {
  return entry.tool === AGENT_ASK_TOOL && shellApprovalOf(entry) === null;
}
