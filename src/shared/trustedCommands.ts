/**
 * A program the user let `/agent` run without asking, for one action: "officecli" + "view". The
 * program is the absolute path the command resolved to when the user said yes, so another program
 * that happens to share the name is not covered. `verb` is the first argument when it is a word
 * ("view", "add"), or '' for a program called without one (`ipconfig /all`).
 *
 * `options` are the option names (`--json`, `-o`, `/body`) the user has seen with that action. A
 * command using any other option is asked again: an option can turn a harmless action into one that
 * starts another program (`--pre=…`, `--exec`, `--filter`), and the user only vouched for the ones
 * they saw.
 */
export interface TrustedCommand {
  program: string;
  verb: string;
  options: string[];
  /** ISO time it was granted, shown in Settings. */
  addedAt: string;
}

/** Enough for every action of a few tools; a list longer than this is not being read by anyone. */
export const TRUSTED_COMMANDS_MAX = 200;
/** Options one action may collect; past this, a new one is simply asked every time. */
export const TRUSTED_OPTIONS_MAX = 64;

const VERB = /^[a-z][a-z0-9-]{0,31}$/;
/** `-x`, `--name`, `--` and, on Windows, a `/switch`; the value after `=` or `:` is not part of it. */
export const OPTION_NAME = /^(?:--?[A-Za-z0-9?][A-Za-z0-9._+-]{0,63}|--|\/[A-Za-z?][A-Za-z0-9_-]{0,63})$/;

/** Windows paths compare without case: `C:\Tools\officecli.exe` and `c:\tools\OfficeCli.EXE` are one file. */
export function sameTrustedProgram(a: string, b: string, platform: string): boolean {
  return platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** The same grant: one program and one action. Options are what the grant covers, not who it is. */
export function sameTrustedCommand(
  a: Pick<TrustedCommand, 'program' | 'verb'>,
  b: Pick<TrustedCommand, 'program' | 'verb'>,
  platform: string,
): boolean {
  return a.verb === b.verb && sameTrustedProgram(a.program, b.program, platform);
}

/** The grant covers the call: same program and action, and every option already seen with it. */
export function trustedCommandCovers(
  entry: Pick<TrustedCommand, 'program' | 'verb' | 'options'>,
  key: Pick<TrustedCommand, 'program' | 'verb' | 'options'>,
  platform: string,
): boolean {
  return sameTrustedCommand(entry, key, platform) && key.options.every((option) => entry.options.includes(option));
}

/** The options of both, the grant's first, each once. */
export function mergedOptions(a: readonly string[], b: readonly string[]): string[] {
  return [...new Set([...a, ...b])].slice(0, TRUSTED_OPTIONS_MAX);
}

/** The program as a person names it: the file name without `.exe`. */
export function trustedProgramName(program: string): string {
  const base = program.split(/[\\/]/).pop() ?? program;
  return base.replace(/\.(exe|com)$/i, '');
}

/** "officecli view --json", or "officecli" for the program called without an action or options. */
export function trustedCommandLabel(entry: Pick<TrustedCommand, 'program' | 'verb' | 'options'>): string {
  return [trustedProgramName(entry.program), entry.verb, ...entry.options].filter(Boolean).join(' ');
}

/** What the stored list may hold: absolute programs, word verbs, option names, no duplicates, capped. */
export function normalizeTrustedCommands(raw: unknown, platform: string): TrustedCommand[] {
  if (!Array.isArray(raw)) return [];
  const out: TrustedCommand[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { program, verb, options, addedAt } = item as Record<string, unknown>;
    if (typeof program !== 'string' || !isAbsoluteProgram(program, platform)) continue;
    if (typeof verb !== 'string' || (verb !== '' && !VERB.test(verb))) continue;
    const entry: TrustedCommand = {
      program,
      verb,
      options: normalizeOptions(options, platform),
      addedAt: typeof addedAt === 'string' ? addedAt : '',
    };
    if (out.some((existing) => sameTrustedCommand(existing, entry, platform))) continue;
    out.push(entry);
    if (out.length >= TRUSTED_COMMANDS_MAX) break;
  }
  return out;
}

/** A grant written before options were recorded covers none: its next option is asked once. */
function normalizeOptions(raw: unknown, platform: string): string[] {
  if (!Array.isArray(raw)) return [];
  const valid = raw.filter((option): option is string => typeof option === 'string'
    && OPTION_NAME.test(option)
    && (platform === 'win32' || !option.startsWith('/')));
  return mergedOptions(valid, []);
}

function isAbsoluteProgram(program: string, platform: string): boolean {
  if (program.length > 1_024 || /[\0\r\n]/.test(program)) return false;
  return platform === 'win32' ? /^[A-Za-z]:\\/.test(program) : program.startsWith('/');
}
