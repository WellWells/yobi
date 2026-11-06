import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { jsonrepair } from 'jsonrepair';

/*
 * The shell a chat `!` command runs in: the one the user's own terminal opens. On Windows that is
 * Windows Terminal's default profile, when it is a shell Yobi can drive (PowerShell 7, Windows
 * PowerShell, cmd); a profile that is not one (WSL, ssh, Git Bash, a program) and a machine
 * without Windows Terminal fall back to PowerShell 7 → Windows PowerShell → cmd. On macOS and
 * Linux it is the login shell. Read on every run, so a changed default applies without a restart.
 */

export type ShellKind = 'pwsh' | 'powershell' | 'cmd' | 'posix' | 'fish';

export interface ResolvedShell {
  kind: ShellKind;
  /** The executable: an absolute path, or a bare name the process search path finds. */
  path: string;
  /** What the chat shows: pwsh, Windows PowerShell, cmd, zsh. */
  label: string;
}

export interface ShellEnvironment {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  readText: (file: string) => Promise<string | null>;
  exists: (file: string) => Promise<boolean>;
  /** The account's login shell (`os.userInfo().shell`), or null. */
  loginShell: () => string | null;
}

const WINDOWS_POWERSHELL_PROFILE = '{61c54bbd-c2c6-5271-96e7-009a87ff44bf}';
const COMMAND_PROMPT_PROFILE = '{0caa0dad-35be-5f56-a8ff-afceeeaa6101}';
const POWERSHELL_CORE_SOURCE = 'windows.terminal.powershellcore';

const POSIX_SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'mksh', 'ash']);

const LABELS: Record<Exclude<ShellKind, 'posix' | 'fish'>, string> = {
  pwsh: 'pwsh',
  powershell: 'Windows PowerShell',
  cmd: 'cmd',
};

export interface TerminalProfile {
  guid?: string;
  name?: string;
  commandline?: string;
  source?: string;
}

/** Windows Terminal's settings files, packaged (stable, preview) and unpackaged, in that order. */
export function terminalSettingsFiles(env: NodeJS.ProcessEnv): string[] {
  const local = envValue(env, 'LOCALAPPDATA');
  if (!local) return [];
  const packaged = (name: string): string => path.win32.join(local, 'Packages', name, 'LocalState', 'settings.json');
  return [
    packaged('Microsoft.WindowsTerminal_8wekyb3d8bbwe'),
    packaged('Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe'),
    path.win32.join(local, 'Microsoft', 'Windows Terminal', 'settings.json'),
  ];
}

/** The profile Windows Terminal opens by default, from its settings text (comments allowed). */
export function defaultTerminalProfile(settingsText: string): TerminalProfile | null {
  let settings: unknown;
  try {
    settings = JSON.parse(jsonrepair(settingsText));
  } catch {
    return null;
  }
  if (!settings || typeof settings !== 'object') return null;
  const { defaultProfile, profiles } = settings as { defaultProfile?: unknown; profiles?: unknown };
  const listed: unknown = Array.isArray(profiles) ? profiles : (profiles as { list?: unknown } | undefined)?.list;
  const list = (Array.isArray(listed) ? listed : []).filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object',
  );
  const wanted = typeof defaultProfile === 'string' ? defaultProfile.trim().toLowerCase() : '';
  // Without a default, Windows Terminal opens the first profile.
  const chosen = wanted
    ? list.find((entry) => [entry.guid, entry.name].some((id) => typeof id === 'string' && id.trim().toLowerCase() === wanted))
    : list[0];
  if (!chosen) {
    // A built-in profile that the file never lists still has a known shell.
    return wanted === WINDOWS_POWERSHELL_PROFILE || wanted === COMMAND_PROMPT_PROFILE ? { guid: wanted } : null;
  }
  const text = (key: string): string | undefined => (typeof chosen[key] === 'string' ? (chosen[key] as string) : undefined);
  return { guid: text('guid'), name: text('name'), commandline: text('commandline'), source: text('source') };
}

function envValue(env: NodeJS.ProcessEnv, name: string): string {
  const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name.toUpperCase());
  return key ? (env[key] ?? '') : '';
}

function expandWindowsVariables(text: string, env: NodeJS.ProcessEnv): string {
  return text.replace(/%([^%]+)%/g, (whole, name: string) => envValue(env, name) || whole);
}

/**
 * The program a command line starts, with `%VAR%` expanded: the quoted first token, else up to the
 * first `.exe` (an unquoted `C:\Program Files\…\pwsh.exe`), else the first word.
 */
export function commandLineProgram(commandline: string, env: NodeJS.ProcessEnv): string {
  const expanded = expandWindowsVariables(commandline.trim(), env);
  const quoted = /^"([^"]*)"/.exec(expanded);
  if (quoted) return quoted[1];
  const exe = /^(.+?\.exe)(?=\s|$)/i.exec(expanded);
  return exe ? exe[1] : expanded.split(/\s+/)[0] ?? '';
}

function windowsKindOf(program: string): Exclude<ShellKind, 'posix' | 'fish'> | null {
  const name = path.win32.basename(program).toLowerCase().replace(/\.exe$/, '');
  if (name === 'pwsh') return 'pwsh';
  if (name === 'powershell') return 'powershell';
  if (name === 'cmd') return 'cmd';
  return null;
}

async function findOnPath(executable: string, shellEnv: ShellEnvironment): Promise<string | null> {
  for (const dir of envValue(shellEnv.env, 'PATH').split(';').map((entry) => entry.trim()).filter(Boolean)) {
    const candidate = path.win32.join(dir, executable);
    if (await shellEnv.exists(candidate)) return candidate;
  }
  return null;
}

async function locatePwsh(shellEnv: ShellEnvironment): Promise<string | null> {
  const onPath = await findOnPath('pwsh.exe', shellEnv);
  if (onPath) return onPath;
  const programFiles = envValue(shellEnv.env, 'ProgramFiles');
  const local = envValue(shellEnv.env, 'LOCALAPPDATA');
  const candidates = [
    ...(programFiles ? [
      path.win32.join(programFiles, 'PowerShell', '7', 'pwsh.exe'),
      path.win32.join(programFiles, 'PowerShell', '7-preview', 'pwsh.exe'),
    ] : []),
    ...(local ? [path.win32.join(local, 'Microsoft', 'WindowsApps', 'pwsh.exe')] : []),
  ];
  for (const candidate of candidates) {
    if (await shellEnv.exists(candidate)) return candidate;
  }
  return null;
}

function windowsPowerShellPath(env: NodeJS.ProcessEnv): string {
  const root = envValue(env, 'SystemRoot') || 'C:\\Windows';
  return path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function commandPromptPath(env: NodeJS.ProcessEnv): string {
  return envValue(env, 'ComSpec') || path.win32.join(envValue(env, 'SystemRoot') || 'C:\\Windows', 'System32', 'cmd.exe');
}

async function shellOfKind(kind: Exclude<ShellKind, 'posix' | 'fish'>, shellEnv: ShellEnvironment, program?: string): Promise<ResolvedShell | null> {
  const resolved = (file: string): ResolvedShell => ({ kind, path: file, label: LABELS[kind] });
  if (program && path.win32.isAbsolute(program) && await shellEnv.exists(program)) return resolved(program);
  if (kind === 'pwsh') {
    const found = await locatePwsh(shellEnv);
    return found ? resolved(found) : null;
  }
  if (kind === 'powershell') {
    const file = windowsPowerShellPath(shellEnv.env);
    return await shellEnv.exists(file) ? resolved(file) : null;
  }
  return resolved(commandPromptPath(shellEnv.env));
}

async function terminalDefaultShell(shellEnv: ShellEnvironment): Promise<ResolvedShell | null> {
  for (const file of terminalSettingsFiles(shellEnv.env)) {
    const text = await shellEnv.readText(file);
    if (text === null) continue;
    const profile = defaultTerminalProfile(text);
    if (!profile) return null;
    if (profile.commandline) {
      const program = commandLineProgram(profile.commandline, shellEnv.env);
      const kind = windowsKindOf(program);
      return kind ? shellOfKind(kind, shellEnv, program) : null;
    }
    if (profile.source?.toLowerCase() === POWERSHELL_CORE_SOURCE) return shellOfKind('pwsh', shellEnv);
    const guid = profile.guid?.toLowerCase();
    if (guid === WINDOWS_POWERSHELL_PROFILE) return shellOfKind('powershell', shellEnv);
    if (guid === COMMAND_PROMPT_PROFILE) return shellOfKind('cmd', shellEnv);
    return null;
  }
  return null;
}

async function windowsShell(shellEnv: ShellEnvironment): Promise<ResolvedShell> {
  const fromTerminal = await terminalDefaultShell(shellEnv);
  if (fromTerminal) return fromTerminal;
  return await shellOfKind('pwsh', shellEnv)
    ?? await shellOfKind('powershell', shellEnv)
    ?? { kind: 'cmd', path: commandPromptPath(shellEnv.env), label: LABELS.cmd };
}

function unixKindOf(file: string): 'posix' | 'fish' | null {
  const name = path.posix.basename(file);
  if (name === 'fish') return 'fish';
  return POSIX_SHELLS.has(name) ? 'posix' : null;
}

async function unixShell(shellEnv: ShellEnvironment): Promise<ResolvedShell> {
  const fallback = shellEnv.platform === 'darwin' ? '/bin/zsh' : '/bin/bash';
  const candidates = [shellEnv.loginShell(), shellEnv.env.SHELL, fallback];
  for (const candidate of candidates) {
    const file = (candidate ?? '').trim();
    const kind = file.startsWith('/') ? unixKindOf(file) : null;
    if (kind && await shellEnv.exists(file)) return { kind, path: file, label: path.posix.basename(file) };
  }
  return { kind: 'posix', path: '/bin/sh', label: 'sh' };
}

export function resolveDefaultShell(shellEnv: ShellEnvironment = systemShellEnvironment()): Promise<ResolvedShell> {
  return shellEnv.platform === 'win32' ? windowsShell(shellEnv) : unixShell(shellEnv);
}

export function systemShellEnvironment(): ShellEnvironment {
  return {
    platform: process.platform,
    env: process.env,
    readText: (file) => fs.readFile(file, 'utf-8').catch(() => null),
    exists: (file) => fs.access(file).then(() => true, () => false),
    loginShell: () => {
      try {
        return os.userInfo().shell;
      } catch {
        return null;
      }
    },
  };
}
