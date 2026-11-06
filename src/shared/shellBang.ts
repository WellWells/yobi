import type { TurnMeta, TurnShell } from './conversationDoc';

/*
 * A chat line starting with `!` runs as a command on this computer, in the user's default shell,
 * and the model is then asked to read the result (Claude Code's shell mode). The turn's prompt is
 * the record: the command line, then the output in a fence nothing inside it can close.
 */

const BANG = '!';

/** The command a `!` line asks to run ('' for a bare `!`), or null when the line is not one. */
export function shellBangCommand(text: string): string | null {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith(BANG)) return null;
  return trimmed.slice(BANG.length).trim();
}

/** Longer than any backtick run in `texts`, so none of them can close it. */
function fenceFor(...texts: string[]): string {
  const longest = Math.max(0, ...texts.flatMap((text) => (text.match(/`+/g) ?? []).map((run) => run.length)));
  return '`'.repeat(Math.max(3, longest + 1));
}

/** A shell turn as the conversation records it. */
export function shellTurnPrompt(command: string, output: string): string {
  const line = `${BANG} ${command.trim()}`;
  if (!output) return line;
  const fence = fenceFor(command, output);
  return `${line}\n\n${fence}\n${output}\n${fence}`;
}

/** The command and output back out of `shellTurnPrompt`'s text; null when it is not one. */
export function parseShellTurnPrompt(prompt: string): { command: string; output: string } | null {
  const text = prompt.replace(/\r\n/g, '\n').trim();
  if (!text.startsWith(BANG)) return null;
  const lines = text.split('\n');
  const fence = lines[lines.length - 1];
  const open = /^`{3,}$/.test(fence) ? lines.indexOf(fence) : -1;
  if (open > 0 && open < lines.length - 1) {
    return {
      command: lines.slice(0, open).join('\n').slice(BANG.length).trim(),
      output: lines.slice(open + 1, -1).join('\n'),
    };
  }
  return { command: text.slice(BANG.length).trim(), output: '' };
}

/** The turn's shell details, or null when the field is missing or not the expected shape. */
export function readTurnShell(meta: TurnMeta | undefined): TurnShell | null {
  const raw: unknown = meta?.sh;
  if (!raw || typeof raw !== 'object') return null;
  const { s, w, to, x, k } = raw as Record<string, unknown>;
  if (typeof s !== 'string' || !s.trim() || typeof w !== 'string') return null;
  return {
    s,
    w,
    ...(typeof to === 'string' && to ? { to } : {}),
    ...(typeof x === 'number' && Number.isInteger(x) ? { x } : {}),
    ...(k === 1 ? { k: 1 as const } : {}),
  };
}

/** Where the latest shell turn left the shell, or null when the conversation has none. */
export function lastShellFolder(turns: readonly { meta: TurnMeta }[]): string | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const shell = readTurnShell(turns[index].meta);
    if (shell) return shell.to ?? shell.w;
  }
  return null;
}
