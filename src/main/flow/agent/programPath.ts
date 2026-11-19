import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/*
 * Finding a program by its bare name the way a shell does (PATH, and PATHEXT on Windows). No other
 * Yobi module is imported here: the shell trust check and the managed-tools lookup both use it.
 */

/** A program named the way a person types it: a bare name, never a path. */
const PROGRAM_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;

const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC';
/** What can be started without a shell: a .bat or .cmd only runs inside cmd. */
const STARTS_DIRECTLY = new Set(['.exe', '.com']);

/** `process.env` reads case-insensitively on Windows; a copied env object does not. */
export function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
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
