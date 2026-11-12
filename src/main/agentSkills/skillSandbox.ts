import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

/*
 * Runs a skill's JavaScript with no confirmation, so the sandbox is what keeps it harmless: Yobi's
 * own runtime as Node (no install needed), Node's permission model (no writes, no child processes,
 * no workers, reads only the skill's folder), a preload that takes the network away (the
 * permission model in Node 24 does not cover it), no inherited environment, a timeout and capped
 * output. It computes and prints; that is all it can do.
 */

export const SANDBOX_TIMEOUT_MS = 10_000;
export const SANDBOX_OUTPUT_MAX = 65_536;
const SANDBOX_HEAP_MB = 256;

const SCRIPT_EXT = /\.(mjs|js|cjs)$/i;

/** Network and process modules the preload refuses, by import, require and getBuiltinModule alike. */
const BLOCKED_MODULES = [
  'net', 'http', 'https', 'http2', 'tls', 'dgram', 'dns', 'dns/promises',
  'child_process', 'worker_threads', 'cluster', 'inspector', 'inspector/promises',
] as const;

/*
 * The doors Node's permission model leaves open, each found by a probe script on Electron 44 / Node
 * 24.21 and closed here:
 * - signals and priorities reach the user's other processes: `process.kill` could end Yobi itself;
 * - a module hook of the script's own, answering first (`shortCircuit`), loaded `node:net` past
 *   ours, and an overridden `Module._resolveFilename` can make another name resolve to it — so the
 *   resolved URL is checked too, and no script registers a hook;
 * - Electron's own bindings (`process._linkedBinding`) hold shell.openPath (starts a program),
 *   writeShortcutLink (writes a file) and a URL loader; `_debugProcess` turns on another process's
 *   debugger.
 */
const PRELOAD = [
  "import os from 'node:os';",
  "import Module, { registerHooks, syncBuiltinESMExports } from 'node:module';",
  `const blocked = new Set(${JSON.stringify(BLOCKED_MODULES)});`,
  "const bare = (id) => String(id).replace(/^node:/, '');",
  "const refuse = (id) => { throw new Error(`${id} is not available in the skill sandbox (no network, no processes)`); };",
  'registerHooks({ resolve(specifier, context, next) { if (blocked.has(bare(specifier))) refuse(specifier); const result = next(specifier, context); if (result && blocked.has(bare(result.url))) refuse(specifier); return result; } });',
  "Module.registerHooks = () => refuse('module.registerHooks');",
  "Module.register = () => refuse('module.register');",
  'const getBuiltin = process.getBuiltinModule;',
  'process.getBuiltinModule = (id) => { if (blocked.has(bare(id))) refuse(id); return getBuiltin.call(process, id); };',
  "for (const name of ['fetch', 'WebSocket', 'EventSource']) delete globalThis[name];",
  "for (const name of ['kill', '_kill', '_linkedBinding', '_debugProcess', '_debugEnd']) process[name] = () => refuse(`process.${name}`);",
  "os.setPriority = () => refuse('os.setPriority');",
  'syncBuiltinESMExports();',
].join('\n');

const PRELOAD_URL = `data:text/javascript,${encodeURIComponent(PRELOAD)}`;

export function isSandboxScript(rel: string): boolean {
  return SCRIPT_EXT.test(rel);
}

export interface SandboxRun {
  skillDir: string;
  /** A path inside the skill folder, as the skill writes it (scripts/x.mjs). */
  script: string;
  args?: readonly string[];
  stdin?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface SandboxResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  /** Not run: outside the skill folder, not JavaScript, or not there. */
  refused?: 'path' | 'type' | 'missing';
}

function refused(reason: NonNullable<SandboxResult['refused']>): SandboxResult {
  return { exitCode: null, stdout: '', stderr: '', timedOut: false, truncated: false, refused: reason };
}

/** The script's absolute path, or why it may not run. */
async function resolveScript(skillDir: string, script: string): Promise<string | SandboxResult> {
  const root = path.resolve(skillDir);
  const rel = script.trim().replace(/\\/g, '/');
  if (!rel || path.isAbsolute(rel) || /^[a-z]:/i.test(rel) || rel.split('/').includes('..')) return refused('path');
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(`${root}${path.sep}`)) return refused('path');
  if (!isSandboxScript(abs)) return refused('type');
  const stat = await fs.stat(abs).catch(() => null);
  return stat?.isFile() ? abs : refused('missing');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Output with the skill folder written as SKILL_DIR and the home folder as ~: both hold the
 * account name, and a script's output goes into prompts (a stack trace, "cannot find package").
 */
export function scrubPaths(text: string, skillDir: string): string {
  if (!text) return text;
  let out = text;
  const flags = process.platform === 'win32' ? 'gi' : 'g';
  for (const [dir, label] of [[path.resolve(skillDir), 'SKILL_DIR'], [homedir(), '~']] as const) {
    if (!dir || dir === path.parse(dir).root) continue;
    for (const form of [pathToFileURL(dir).href, dir, dir.replace(/\\/g, '/')]) {
      out = out.replace(new RegExp(escapeRegExp(form), flags), label);
    }
  }
  return out;
}

/** Only what Node needs to start: the user's environment may hold keys. */
function sandboxEnv(): NodeJS.ProcessEnv {
  return {
    ELECTRON_RUN_AS_NODE: '1',
    ...(process.platform === 'win32' && process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
  };
}

/**
 * The folder where it really is. Node checks every link on the way to the script, so a folder
 * reached through one (macOS's /var is /private/var) is refused at the link itself.
 */
async function realFolder(dir: string): Promise<string> {
  const given = path.resolve(dir);
  return fs.realpath(given).catch(() => given);
}

export async function runSandboxedScript(run: SandboxRun): Promise<SandboxResult> {
  const root = await realFolder(run.skillDir);
  const resolved = await resolveScript(root, run.script);
  if (typeof resolved !== 'string') return resolved;
  const child = spawn(process.execPath, [
    '--permission',
    `--allow-fs-read=${root}`,
    `--max-old-space-size=${SANDBOX_HEAP_MB}`,
    '--no-warnings',
    '--import', PRELOAD_URL,
    resolved,
    ...(run.args ?? []),
  ], { cwd: root, env: sandboxEnv(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });

  let stdout = '';
  let stderr = '';
  let truncated = false;
  const take = (current: string, chunk: Buffer): string => {
    if (current.length >= SANDBOX_OUTPUT_MAX) {
      truncated = true;
      return current;
    }
    const next = current + chunk.toString('utf8');
    if (next.length <= SANDBOX_OUTPUT_MAX) return next;
    truncated = true;
    return next.slice(0, SANDBOX_OUTPUT_MAX);
  };
  child.stdout.on('data', (chunk: Buffer) => { stdout = take(stdout, chunk); });
  child.stderr.on('data', (chunk: Buffer) => { stderr = take(stderr, chunk); });
  // A script that never reads stdin closes it early; writing then must not throw.
  child.stdin.on('error', () => undefined);
  child.stdin.end(run.stdin ?? '');

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, run.timeoutMs ?? SANDBOX_TIMEOUT_MS);
  const onAbort = (): void => { child.kill(); };
  run.signal?.addEventListener('abort', onAbort, { once: true });
  if (run.signal?.aborted) child.kill();

  const exitCode = await new Promise<number | null>((resolve) => {
    child.on('error', () => resolve(null));
    child.on('close', (code) => resolve(code));
  });
  clearTimeout(timer);
  run.signal?.removeEventListener('abort', onAbort);
  const scrub = (text: string): string => scrubPaths(scrubPaths(text, root), run.skillDir);
  return { exitCode, stdout: scrub(stdout), stderr: scrub(stderr), timedOut, truncated };
}
