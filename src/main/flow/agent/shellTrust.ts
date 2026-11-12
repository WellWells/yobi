import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  OPTION_NAME, TRUSTED_OPTIONS_MAX, mergedOptions, sameTrustedCommand, trustedCommandCovers, trustedProgramName,
} from '../../../shared/trustedCommands';
import type { TrustedCommand } from '../../../shared/trustedCommands';
import { isWithinRoots, isWithinRootsReal } from './agentSandbox';

/*
 * "Always allow" for a shell command, the way Claude Code and Codex grant it: per program and
 * action ("officecli" + "view"), never for the rest of a run. A run reads untrusted pages into the
 * same prompt that writes its next command, so a blanket grant could be spent by that page; a grant
 * for one action of one installed tool can only be spent on that action.
 *
 * And only with the options the user saw. A prefix rule alone ("officecli view *") is wider than it
 * looks: many tools have an option that starts another program (`rg --pre`, `tar
 * --checkpoint-action=exec`, `zip -TT`, `pandoc --filter`), so a page could spend a grant for a
 * harmless action on one. A new option is asked again, and an argument naming a program this module
 * never trusts (`--pre=bash`, `--filter python`) is asked every time.
 *
 * It holds only for a PLAIN command — words, quotes and `&&`, nothing a shell would expand — whose
 * every part is an installed program the user can be trusted to know (not an interpreter, a
 * launcher, a network tool or one of the operating system's own), with no web address and no
 * absolute path outside the folders the agent may read. Anything else is asked, as before.
 *
 * A trusted command does not go back through the shell: each part is started directly, as the
 * resolved program with the parsed words (`execTrustedCalls`). cmd looks in the working directory
 * before PATH, and the working directory is the output folder `file_write` writes to without asking,
 * so through cmd an `officecli.bat` written there would run in place of the trusted officecli.
 */

export type TrustKey = Pick<TrustedCommand, 'program' | 'verb' | 'options'>;

/** One part of a trusted command: the program's absolute path and the words after its name. */
export interface TrustedCall {
  file: string;
  args: string[];
}

export interface ShellTrust {
  calls: TrustedCall[];
  /** What "always allow" records: one key per distinct program and action, with every option it used. */
  keys: TrustKey[];
}

export interface TrustContext {
  /** The command's working directory. */
  cwd: string;
  /** An absolute path in an argument must lie inside these (the folders the agent may read). */
  readRoots: readonly string[];
  /** A program inside these may be this run's own work (the output folder). */
  writeRoots: readonly string[];
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}

/** Expansion and escapes: never plain, quoted or not. */
const CMD_NEVER = /[%!^\r\n]/;
const CMD_OPERATORS = new Set(['&', '|', '<', '>', '(', ')']);
const SH_NEVER = /[$`\\\r\n]/;
const SH_OPERATORS = new Set([';', '&', '|', '<', '>', '(', ')', '{', '}', '*', '?', '[', ']', '~', '#', '!', '^']);

/**
 * The words of each `&&` part, as the shell would hand them to the program, or null when the
 * command is not plain. On Windows a quote after a backslash, and two quotes inside a word, are
 * read one way by cmd and another by the program, so they are not plain either.
 */
export function splitPlainCommand(command: string, platform: NodeJS.Platform): string[][] | null {
  const windows = platform === 'win32';
  if ((windows ? CMD_NEVER : SH_NEVER).test(command)) return null;
  if (windows && (/\\"/.test(command) || /\S""|""\S/.test(command))) return null;
  const operators = windows ? CMD_OPERATORS : SH_OPERATORS;
  const segments: string[][] = [];
  let words: string[] = [];
  let word = '';
  let inWord = false;
  let quote: string | null = null;
  const endWord = (): void => {
    if (inWord) words.push(word);
    word = '';
    inWord = false;
  };
  const endSegment = (): boolean => {
    endWord();
    if (words.length === 0) return false;
    segments.push(words);
    words = [];
    return true;
  };
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) quote = null;
      else word += ch;
      continue;
    }
    if (ch === '"' || (!windows && ch === "'")) {
      quote = ch;
      inWord = true;
      continue;
    }
    if (ch === ' ' || ch === '\t') {
      endWord();
      continue;
    }
    if (ch === '&' && command[i + 1] === '&') {
      if (!endSegment()) return null;
      i += 1;
      continue;
    }
    if (operators.has(ch)) return null;
    // zsh expands a word that starts with `=` to a program's path.
    if (!windows && ch === '=' && !inWord) return null;
    word += ch;
    inWord = true;
  }
  if (quote) return null;
  return endSegment() ? segments : null;
}

/** A program named the way a person types it: a bare name, never a path. */
const PROGRAM_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const VERB = /^[a-z][a-z0-9-]{0,31}$/i;

/** The action a call performs: its first word when that is a word ("view"), else ''. */
export function verbOf(args: readonly string[]): string {
  const first = args[0] ?? '';
  return VERB.test(first) ? first.toLowerCase() : '';
}

/** On Windows `/body` and `/x:value` are switches; `/body/p[1]` is a value (officecli's paths). */
const WINDOWS_SWITCH = /^\/[A-Za-z?][A-Za-z0-9_-]*(?:[:=]|$)/;

/**
 * The option names a call uses, in order, each once (`--json`, `-o`, `/body`), without the value
 * after `=` or `:`. A negative number is a value. Null when an option's name cannot be read cleanly:
 * that command is asked every time.
 */
export function optionsOf(args: readonly string[], windows: boolean): string[] | null {
  const names: string[] = [];
  for (const arg of args) {
    let name: string | undefined;
    if (arg.startsWith('-') && arg !== '-' && !/^-\d/.test(arg)) name = arg.split('=')[0];
    else if (windows && WINDOWS_SWITCH.test(arg)) name = arg.split(/[:=]/)[0];
    if (name === undefined) continue;
    if (!OPTION_NAME.test(name)) return null;
    if (!names.includes(name)) names.push(name);
  }
  return names.length > TRUSTED_OPTIONS_MAX ? null : names;
}

/** A script or program by its name: what an option like `--filter` would run. */
const RUNNABLE_FILE = /\.(?:exe|com|bat|cmd|ps1|psm1|vbs|vbe|js|jse|mjs|cjs|wsf|wsh|hta|msi|scr|cpl|lnk|py|pyw|rb|pl|php|sh|bash|zsh|lua|jar|tcl)$/i;

/**
 * Some word of an argument other than the action names something to run: a program this module
 * never trusts (`--pre=bash`, `--filter python`, `--shell=C:\x\pwsh.exe`) or a script or program
 * file — the working folder is where `file_write` writes unasked, so `--filter=walk.py` there would
 * be the model's own code. Benign text rarely is one bare word.
 */
function namesRunnable(args: readonly string[]): boolean {
  return args.slice(verbOf(args) ? 1 : 0).some((arg) => arg.split(/[=:,]/).some((raw) => {
    const piece = raw.trim();
    return RUNNABLE_FILE.test(piece) || NEVER_TRUSTED.has(trustedProgramName(piece).toLowerCase());
  }));
}

/*
 * Programs whose one action can be anything: shells, interpreters, package managers and build
 * tools (they run whatever a manifest says), launchers, network transfer, version control, and
 * coding agents. Compared by file name without extension, both as found and after symlinks.
 */
const NEVER_TRUSTED: ReadonlySet<string> = new Set([
  'cmd', 'command', 'powershell', 'powershell_ise', 'pwsh', 'bash', 'sh', 'zsh', 'fish', 'dash', 'ksh', 'csh', 'tcsh',
  'nu', 'wsl', 'wt', 'conhost', 'busybox',
  'python', 'python3', 'pythonw', 'py', 'pyw', 'node', 'nodejs', 'deno', 'bun', 'bunx', 'ruby', 'irb', 'perl', 'php',
  'lua', 'luajit', 'java', 'javaw', 'jshell', 'dotnet', 'rscript', 'julia', 'tclsh', 'wish', 'osascript', 'wscript',
  'cscript', 'mshta', 'awk', 'gawk', 'sed',
  'npm', 'npx', 'pnpm', 'pnpx', 'yarn', 'pip', 'pip3', 'pipx', 'uv', 'uvx', 'gem', 'cargo', 'go', 'make', 'cmake',
  'gradle', 'mvn', 'conda', 'mamba', 'winget', 'choco', 'scoop', 'brew', 'apt', 'apt-get', 'dnf', 'yum',
  'start', 'open', 'xdg-open', 'explorer', 'runas', 'sudo', 'doas', 'su', 'env', 'xargs', 'nohup', 'timeout', 'nice',
  'watch', 'time', 'rundll32', 'regsvr32', 'msiexec', 'schtasks', 'at', 'crontab', 'launchctl', 'systemctl', 'sc',
  'reg', 'wmic', 'forfiles', 'find', 'code', 'cursor', 'electron', 'docker', 'podman', 'kubectl', 'ssh', 'git', 'gh',
  'curl', 'wget', 'scp', 'sftp', 'rsync', 'ftp', 'tftp', 'telnet', 'nc', 'ncat', 'netcat', 'socat', 'certutil',
  'bitsadmin',
  'claude', 'codex', 'gemini', 'aider', 'yobi',
  // Searchers, archivers, editors and debuggers that start another program from an option.
  'rg', 'fd', 'fdfind', 'tar', 'bsdtar', 'zip', 'vim', 'vi', 'nvim', 'gvim', 'emacs', 'nano', 'less', 'sqlite3',
  'psql', 'mysql', 'gdb', 'lldb', 'strace', 'ltrace', 'parallel', 'expect', 'tmux', 'screen', 'msbuild', 'ninja',
  'bazel',
]);

/** The operating system's own programs on macOS and Linux; Windows uses %SystemRoot%. */
const POSIX_SYSTEM_DIRS = ['/bin', '/sbin', '/usr/bin', '/usr/sbin', '/usr/libexec', '/usr/lib', '/System'];

const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC';
/** What can be started without a shell: a .bat or .cmd only runs inside cmd. */
const STARTS_DIRECTLY = new Set(['.exe', '.com']);

/** `process.env` reads case-insensitively on Windows; a copied env object does not. */
function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  if (env[name] !== undefined) return env[name];
  const key = Object.keys(env).find((entry) => entry.toUpperCase() === name);
  return key ? env[key] : undefined;
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}

async function isExecutableFile(file: string): Promise<boolean> {
  if (!(await isFile(file))) return false;
  try {
    await fs.access(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The file the shell would start for `name`, found the way it finds it, or null when that is not a
 * program that starts on its own (a .bat, a script) or when a file by that name sits in the working
 * directory — what the shell would pick there may have been written by this very run.
 */
export async function resolveProgram(
  name: string,
  cwd: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  if (!PROGRAM_NAME.test(name)) return null;
  const windows = platform === 'win32';
  const entries = (envValue(env, 'PATH') ?? '').split(windows ? ';' : ':').map((dir) => dir.trim().replace(/^"(.*)"$/, '$1'));
  const absolute = (dir: string): boolean => (windows ? /^[A-Za-z]:[\\/]/.test(dir) : dir.startsWith('/'));
  if (!windows) {
    if (entries.some((dir) => !absolute(dir)) && await isFile(path.posix.join(cwd, name))) return null;
    for (const dir of entries.filter(absolute)) {
      const candidate = path.posix.join(dir, name);
      if (await isExecutableFile(candidate)) return candidate;
    }
    return null;
  }
  const exts = (envValue(env, 'PATHEXT') ?? DEFAULT_PATHEXT).split(';').map((ext) => ext.trim().toLowerCase()).filter((ext) => ext.startsWith('.'));
  const own = path.win32.extname(name).toLowerCase();
  const names = own && exts.includes(own) ? [name] : exts.map((ext) => `${name}${ext}`);
  for (const candidate of names) {
    if (await isFile(path.win32.join(cwd, candidate))) return null;
  }
  for (const dir of entries.filter(absolute)) {
    for (const candidate of names) {
      const full = path.win32.join(dir, candidate);
      if (!(await isFile(full))) continue;
      return STARTS_DIRECTLY.has(path.win32.extname(full).toLowerCase()) ? full : null;
    }
  }
  return null;
}

async function isRefusedProgram(file: string, ctx: TrustContext, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): Promise<boolean> {
  const real = await fs.realpath(file).catch(() => file);
  const systemDirs = platform === 'win32'
    ? [envValue(env, 'SYSTEMROOT') ?? envValue(env, 'WINDIR') ?? 'C:\\Windows']
    : POSIX_SYSTEM_DIRS;
  return [file, real].some((candidate) => NEVER_TRUSTED.has(trustedProgramName(candidate).toLowerCase())
    || isWithinRoots(candidate, systemDirs)
    || isWithinRoots(candidate, [...ctx.writeRoots]));
}

const DRIVE_PATH = /[A-Za-z]:[\\/]/g;

/**
 * The absolute paths an argument names, whole or after `=` (`--input=C:\x.json`), or null when it
 * names a place that cannot be checked: a network path, a drive-relative path, a home directory.
 */
function absolutePathsIn(arg: string, cwd: string, windows: boolean): string[] | null {
  const values = arg.includes('=') ? [arg, arg.slice(arg.indexOf('=') + 1)] : [arg];
  const found: string[] = [];
  for (const value of values) {
    if (windows) {
      if (/^[\\/]{2}/.test(value) || /^[A-Za-z]:(?![\\/])/.test(value)) return null;
      // `\x` is the root of the current drive; `/a/b` reads as a path, `/all` as a switch.
      if (/^\\/.test(value) || /^\/[^/\\]*[\\/]/.test(value)) found.push(path.win32.resolve(cwd, value));
    } else {
      if (value.startsWith('~')) return null;
      if (value.startsWith('/')) found.push(value);
    }
  }
  if (windows) {
    for (const match of arg.matchAll(DRIVE_PATH)) found.push(arg.slice(match.index));
  } else {
    for (let i = 1; i < arg.length; i += 1) {
      if (arg[i] === '/' && ':,'.includes(arg[i - 1])) found.push(arg.slice(i));
    }
  }
  return found;
}

/** No web address, no `..`, and every absolute path inside the folders the agent may read. */
async function argsConfined(args: readonly string[], ctx: TrustContext, windows: boolean): Promise<boolean> {
  for (const arg of args) {
    if (arg.includes('://')) return false;
    if (/(^|[\\/=:,;])\.\.([\\/]|$)/.test(arg)) return false;
    const paths = absolutePathsIn(arg, ctx.cwd, windows);
    if (!paths) return false;
    for (const target of paths) {
      if (!(await isWithinRootsReal(target, ctx.readRoots))) return false;
    }
  }
  return true;
}

/**
 * What this command would run and the keys that cover it, or null when it cannot be trusted at all
 * (and so is asked every time, without an "always allow"). PowerShell is never plain.
 */
export async function shellTrustFor(command: string, interpreter: string, ctx: TrustContext): Promise<ShellTrust | null> {
  const platform = ctx.platform ?? process.platform;
  const env = ctx.env ?? process.env;
  if (platform === 'win32' && !/^cmd(\.exe)?$/i.test(interpreter)) return null;
  const segments = splitPlainCommand(command, platform);
  if (!segments) return null;
  const calls: TrustedCall[] = [];
  const keys: TrustKey[] = [];
  for (const [program, ...args] of segments) {
    const file = await resolveProgram(program, ctx.cwd, platform, env);
    if (!file || await isRefusedProgram(file, ctx, platform, env)) return null;
    const options = optionsOf(args, platform === 'win32');
    if (!options || namesRunnable(args)) return null;
    if (!(await argsConfined(args, ctx, platform === 'win32'))) return null;
    calls.push({ file, args });
    const key: TrustKey = { program: file, verb: verbOf(args), options };
    const same = keys.find((existing) => sameTrustedCommand(existing, key, platform));
    if (same) same.options = mergedOptions(same.options, options);
    else keys.push(key);
  }
  return { calls, keys };
}

/** Every program and action the command runs is on the user's list, with every option it uses. */
export function isTrustedBy(trust: ShellTrust, list: readonly TrustKey[], platform: NodeJS.Platform = process.platform): boolean {
  return trust.keys.every((key) => list.some((entry) => trustedCommandCovers(entry, key, platform)));
}

/** A file name an argument carries (`report.docx`, `--input=items.json`), shown without its folder. */
const FILE_NAME = /\.[A-Za-z][A-Za-z0-9]{0,7}$/;
const FILES_SHOWN = 5;

export interface PlainCommandFacts {
  programs: string[];
  verbs: string[];
  files: string[];
}

/**
 * What a person can read off a plain command without reading the command: the programs, their
 * actions, the files named. Read by the program, not written by the model.
 */
export function plainCommandFacts(segments: readonly (readonly string[])[]): PlainCommandFacts {
  const programs: string[] = [];
  const verbs: string[] = [];
  const files: string[] = [];
  const add = (list: string[], value: string): void => {
    if (value && !list.includes(value)) list.push(value);
  };
  for (const [program, ...args] of segments) {
    add(programs, trustedProgramName(program ?? ''));
    add(verbs, verbOf(args));
    for (const arg of args) {
      const value = arg.startsWith('-') && arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : arg;
      if (value.startsWith('-') || value.length > 260 || value.includes('://') || !FILE_NAME.test(value)) continue;
      add(files, value.split(/[\\/]/).pop() ?? value);
    }
  }
  return { programs, verbs, files: files.length > FILES_SHOWN ? [...files.slice(0, FILES_SHOWN), '…'] : files };
}
