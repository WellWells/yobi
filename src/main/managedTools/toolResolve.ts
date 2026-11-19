import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ManagedToolCopy, ManagedToolId, ManagedToolSource } from '../../shared/managedTools';
import { errorText } from '../../shared/errorText';
import { sendLog } from '../helpers';
import { compareVersions } from './paths';
import type { ToolResult } from './processTree';
import { spawnTool, toolEnv } from './processTree';
import type { ManagedToolSpec } from './specs';
import { toolSpec } from './specs';
import { findOnSystemPath } from './systemPath';
import { managedExecutable, readToolState, setActiveCopy, toolRoot } from './toolStore';

/*
 * Which copy of a program Yobi runs, in order: the path the user chose, the one Yobi downloaded,
 * one already on this computer (PATH, then the program's usual install folder). A copy counts only
 * when it starts and reports at least the spec's minimum version.
 */

/** The first start of a freshly downloaded build can wait on an antivirus scan. */
export const SELF_TEST_TIMEOUT_MS = 120_000;
/** A lookup is reused this long; the settings card and an explicit "look again" skip it. */
const LOOKUP_REUSE_MS = 60_000;

export interface ToolRunner {
  run: (cmd: string, args: readonly string[], options: { env: Record<string, string>; timeoutMs: number }) => Promise<ToolResult>;
  findOnPath: (command: string, cwd: string) => Promise<string | null>;
  log: (line: string) => void;
}

function defaultRunner(): ToolRunner {
  return {
    run: (cmd, args, options) => spawnTool(cmd, args, { env: options.env, timeoutMs: options.timeoutMs, maxOutputBytes: 64_000 }),
    findOnPath: (command, cwd) => findOnSystemPath(command, cwd),
    log: sendLog,
  };
}

let runner: ToolRunner = defaultRunner();

/** Swaps the process and PATH dependencies for tests; `null` restores the real ones. */
export function setToolRunner(partial: Partial<ToolRunner> | null): void {
  runner = partial ? { ...defaultRunner(), ...partial } : defaultRunner();
  versions.clear();
  lookups.clear();
}

export function toolRunner(): ToolRunner {
  return runner;
}

/**
 * The environment a copy runs with: the shared whitelist, the spec's extra names, and for Yobi's
 * own copy the variables that keep its self-updater off. A copy installed some other way updates
 * itself as its owner set it up; Yobi never turns that off.
 */
export function toolRunEnv(spec: ManagedToolSpec, source: ManagedToolSource, sourceEnv: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const extra: Record<string, string> = {};
  for (const name of spec.passEnv) {
    const key = Object.keys(sourceEnv).find((k) => k.toUpperCase() === name);
    const value = key ? sourceEnv[key] : undefined;
    if (key && value !== undefined) extra[key] = value;
  }
  return toolEnv({ ...extra, ...(source === 'managed' ? spec.managedEnv : {}) }, sourceEnv);
}

/** Starts `exe` with the spec's version arguments; its version, or throws saying why not. */
export async function testCopy(spec: ManagedToolSpec, exe: string, source: ManagedToolSource): Promise<string> {
  let result: ToolResult;
  try {
    result = await runner.run(exe, spec.versionArgs, { env: toolRunEnv(spec, source), timeoutMs: SELF_TEST_TIMEOUT_MS });
  } catch (err) {
    throw new Error(`${spec.name} did not start: ${errorText(err)}`);
  }
  if (result.code !== 0) {
    const tail = (result.stderr || result.stdout).trim().slice(-300);
    throw new Error(`${spec.name} self-test failed (${result.timedOut ? 'timed out' : `exit ${result.code}: ${tail}`})`);
  }
  const version = spec.parseVersion(result.stdout);
  if (!version) throw new Error(`${spec.name} self-test printed no version`);
  if (compareVersions(version, spec.minVersion) < 0) throw new Error(`${spec.name} ${version} is older than ${spec.minVersion}`);
  return version;
}

interface VersionMemo {
  stamp: string;
  version: string | null;
  at: number;
}

/**
 * A copy that would not start is tried again after this long: its first start may have been held
 * up (an antivirus scan), and the lookup runs often enough that retrying every time would stall it.
 */
const FAILED_COPY_RETRY_MS = 10 * 60_000;

/** Versions of copies found on this computer, by path, until the file changes. */
const versions = new Map<string, VersionMemo>();
const lookups = new Map<ManagedToolId, { at: number; copy: ManagedToolCopy | undefined }>();

async function stampOf(file: string): Promise<string | null> {
  try {
    const stat = await fs.stat(file);
    return stat.isFile() ? `${stat.size}:${stat.mtimeMs}` : null;
  } catch {
    return null;
  }
}

/** A copy's version once per file state; null when it does not start or is too old. */
async function versionOf(spec: ManagedToolSpec, exe: string, source: ManagedToolSource): Promise<string | null> {
  const stamp = await stampOf(exe);
  if (!stamp) return null;
  const memo = versions.get(exe);
  if (memo?.stamp === stamp && (memo.version !== null || Date.now() - memo.at < FAILED_COPY_RETRY_MS)) return memo.version;
  let version: string | null = null;
  try {
    version = await testCopy(spec, exe, source);
  } catch (err) {
    runner.log(`[Tools] ${spec.name} at ${source} location not used: ${errorText(err)}`);
  }
  versions.set(exe, { stamp, version, at: Date.now() });
  return version;
}

async function systemCandidates(spec: ManagedToolSpec): Promise<string[]> {
  const onPath = await runner.findOnPath(spec.command, toolRoot(spec.id)).catch(() => null);
  const own = path.resolve(managedExecutable(spec.id));
  const all = [...(onPath ? [onPath] : []), ...spec.usualLocations(process.platform, process.env)];
  const seen = new Set<string>();
  return all.filter((file) => {
    const key = process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
    if (seen.has(key) || path.resolve(file) === own) return false;
    seen.add(key);
    return true;
  });
}

async function lookUp(spec: ManagedToolSpec): Promise<ManagedToolCopy | undefined> {
  const state = readToolState(spec.id);
  if (state.customPath) {
    const version = await versionOf(spec, state.customPath, 'custom');
    // A chosen path that stopped working is not silently swapped for another copy.
    return version ? { source: 'custom', path: state.customPath, version } : undefined;
  }
  if (state.managedVersion) {
    const exe = managedExecutable(spec.id);
    if (await stampOf(exe)) return { source: 'managed', path: exe, version: state.managedVersion };
  }
  for (const exe of await systemCandidates(spec)) {
    const version = await versionOf(spec, exe, 'system');
    if (version) return { source: 'system', path: exe, version };
  }
  return undefined;
}

/** The copy to run, looked up again after `LOOKUP_REUSE_MS` or when `fresh`. */
export async function resolveTool(id: ManagedToolId, options: { fresh?: boolean } = {}): Promise<ManagedToolCopy | undefined> {
  const reused = lookups.get(id);
  if (!options.fresh && reused && Date.now() - reused.at < LOOKUP_REUSE_MS) return reused.copy;
  const copy = await lookUp(toolSpec(id));
  lookups.set(id, { at: Date.now(), copy });
  setActiveCopy(id, copy);
  return copy;
}

/** Drops the reused lookup, after an install, a removal or a new custom path. */
export function forgetLookup(id: ManagedToolId): void {
  lookups.delete(id);
}
