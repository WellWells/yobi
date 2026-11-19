import { execFile } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveProgram } from '../flow/agent/programPath';

/*
 * Finds a program the way a newly opened terminal would. Yobi's own PATH is the one it started
 * with: install a program afterwards and its folder is in the registry (Windows) but not in
 * `process.env.PATH` until Yobi restarts. A Mac app started from the Dock gets a short PATH
 * without Homebrew's folders. Both are added here; nothing is run through cmd or a shell.
 */

const REG_TIMEOUT_MS = 5_000;
const WINDOWS_ENV_KEYS = [
  'HKCU\\Environment',
  'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment',
] as const;
/** Where macOS and Linux package managers and user installs put programs. */
const POSIX_EXTRA_DIRS = ['/opt/homebrew/bin', '/usr/local/bin'];

/** The value of `Path` in `reg query <key> /v Path` output; '' when it has none. */
export function parseRegPath(stdout: string): string {
  return /^\s+Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/im.exec(stdout)?.[1]?.trim() ?? '';
}

/** `%LOCALAPPDATA%\x` → its value; an unknown variable stays as written (and finds nothing). */
export function expandWindowsVars(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/%([^%]+)%/g, (whole, name: string) => {
    const key = Object.keys(env).find((k) => k.toUpperCase() === name.toUpperCase());
    return key && env[key] !== undefined ? String(env[key]) : whole;
  });
}

function regQueryPath(key: string): Promise<string> {
  return new Promise((resolve) => {
    execFile('reg', ['query', key, '/v', 'Path'], { windowsHide: true, timeout: REG_TIMEOUT_MS }, (err, stdout) => {
      resolve(err ? '' : parseRegPath(String(stdout)));
    });
  });
}

function envPath(env: NodeJS.ProcessEnv): string {
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH');
  return key ? env[key] ?? '' : '';
}

/** Folders in order, each once (compared without case on Windows). */
export function mergeSearchDirs(lists: readonly string[], platform: string): string[] {
  const sep = platform === 'win32' ? ';' : ':';
  const seen = new Set<string>();
  const dirs: string[] = [];
  for (const list of lists) {
    for (const raw of list.split(sep)) {
      const dir = raw.trim().replace(/^"(.*)"$/, '$1');
      const key = platform === 'win32' ? dir.toLowerCase() : dir;
      if (!dir || seen.has(key)) continue;
      seen.add(key);
      dirs.push(dir);
    }
  }
  return dirs;
}

export async function systemSearchDirs(platform: string = process.platform, env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  if (platform === 'win32') {
    const registry = await Promise.all(WINDOWS_ENV_KEYS.map(regQueryPath));
    // The machine's folders come before the user's, as Windows builds a new process's PATH.
    return mergeSearchDirs([envPath(env), ...registry.reverse().map((value) => expandWindowsVars(value, env))], platform);
  }
  return mergeSearchDirs([envPath(env), [...POSIX_EXTRA_DIRS, path.posix.join(os.homedir(), '.local', 'bin')].join(':')], platform);
}

/**
 * The executable `command` names on this computer's search path, or null. `cwd` is a folder of
 * Yobi's own: a same-named file there would win in a shell, so `resolveProgram` refuses it.
 */
export async function findOnSystemPath(
  command: string,
  cwd: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const dirs = await systemSearchDirs(platform, env);
  const searchEnv: NodeJS.ProcessEnv = { PATH: dirs.join(platform === 'win32' ? ';' : ':') };
  const pathext = Object.keys(env).find((k) => k.toUpperCase() === 'PATHEXT');
  if (pathext) searchEnv.PATHEXT = env[pathext];
  return resolveProgram(command, cwd, platform, searchEnv);
}
