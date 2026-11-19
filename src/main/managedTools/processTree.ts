import { execFile, spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

/*
 * yt-dlp starts ffmpeg and Node children of its own, so stopping it means stopping the whole
 * tree: taskkill /T on Windows, and on macOS/Linux a process group of its own (detached) that a
 * negative pid signals at once.
 */

const KILL_GRACE_MS = 3_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000;

export function killProcessTree(pid: number, platform: NodeJS.Platform = process.platform): void {
  if (platform === 'win32') {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => undefined);
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    return;
  }
  const timer = setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }, KILL_GRACE_MS);
  timer.unref?.();
}

const ENV_WHITELIST = new Set([
  'PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
]);

/**
 * The environment a tool gets: a short whitelist of the app's variables (case-insensitive, keeping
 * each name's own spelling) plus `extra`. Never the full environment, which may hold bot tokens.
 */
export function toolEnv(extra: Record<string, string> = {}, source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || !ENV_WHITELIST.has(key.toUpperCase())) continue;
    env[key] = value;
  }
  return { ...env, ...extra };
}

export interface SpawnToolOptions {
  env?: Record<string, string>;
  cwd?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Per stream; the TAIL is kept. */
  maxOutputBytes?: number;
  /** Every complete line, from either stream, as it arrives. */
  onLine?: (line: string, stream: 'stdout' | 'stderr') => void;
  platform?: NodeJS.Platform;
}

export interface ToolResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
}

class TailBuffer {
  private chunks: Buffer[] = [];
  private size = 0;
  private partial = '';
  private readonly decoder = new StringDecoder('utf8');

  constructor(
    private readonly max: number,
    private readonly onLine?: (line: string) => void,
  ) {}

  push(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.size += chunk.length;
    while (this.size > this.max && this.chunks.length > 1) this.size -= this.chunks.shift()?.length ?? 0;
    if (!this.onLine) return;
    const lines = (this.partial + this.decoder.write(chunk)).split(/\r?\n/);
    this.partial = lines.pop() ?? '';
    for (const line of lines) this.onLine(line);
  }

  finish(): string {
    const rest = this.partial + this.decoder.end();
    if (this.onLine && rest) this.onLine(rest);
    this.partial = '';
    const all = Buffer.concat(this.chunks);
    return all.subarray(Math.max(0, all.length - this.max)).toString('utf8');
  }
}

let runningTools = 0;
let idleWaiters: Array<() => void> = [];
let swapping: Promise<void> | null = null;

/** How many tools started through `spawnTool` have not exited yet. */
export function runningToolCount(): number {
  return runningTools;
}

function toolExited(): void {
  runningTools--;
  if (runningTools > 0) return;
  const waiters = idleWaiters;
  idleWaiters = [];
  for (const wake of waiters) wake();
}

/**
 * Runs `fn` while no tool runs: waits until every tool started through `spawnTool` has exited, then
 * holds new starts until `fn` settles. Replacing a managed tool's folder needs it — Windows cannot
 * rename a folder whose program is running, and elsewhere a running program would lose files it
 * still loads. `fn` must not start a tool itself.
 */
export async function withToolsIdle<T>(fn: () => Promise<T>): Promise<T> {
  while (swapping || runningTools > 0) {
    await (swapping ?? new Promise<void>((resolve) => idleWaiters.push(resolve)));
  }
  let resume = (): void => undefined;
  swapping = new Promise<void>((resolve) => {
    resume = resolve;
  });
  try {
    return await fn();
  } finally {
    swapping = null;
    resume();
  }
}

/**
 * Runs a tool without a shell. Resolves when it exits — also after a timeout or an abort, which
 * kill the whole tree and set `timedOut` / `aborted`; rejects only when it cannot start at all.
 * Waits first while `withToolsIdle` is swapping a tool's folder.
 */
export function spawnTool(cmd: string, args: readonly string[], options: SpawnToolOptions = {}): Promise<ToolResult> {
  if (swapping) return swapping.then(() => spawnTool(cmd, args, options));
  runningTools++;
  return startTool(cmd, args, options).finally(toolExited);
}

function startTool(cmd: string, args: readonly string[], options: SpawnToolOptions): Promise<ToolResult> {
  const platform = options.platform ?? process.platform;
  const max = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  return new Promise<ToolResult>((resolve, reject) => {
    if (options.signal?.aborted) {
      resolve({ code: null, stdout: '', stderr: '', timedOut: false, aborted: true });
      return;
    }
    const child = spawn(cmd, [...args], {
      shell: false,
      windowsHide: true,
      detached: platform !== 'win32',
      cwd: options.cwd,
      env: options.env ?? toolEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = new TailBuffer(max, options.onLine && ((line) => options.onLine?.(line, 'stdout')));
    const stderr = new TailBuffer(max, options.onLine && ((line) => options.onLine?.(line, 'stderr')));
    let timedOut = false;
    let aborted = false;
    let settled = false;

    const stop = (): void => {
      if (child.pid !== undefined) killProcessTree(child.pid, platform);
    };
    const onAbort = (): void => {
      aborted = true;
      stop();
    };
    const timer = options.timeoutMs
      ? setTimeout(() => {
        timedOut = true;
        stop();
      }, options.timeoutMs)
      : null;
    options.signal?.addEventListener('abort', onAbort, { once: true });

    const cleanup = (): void => {
      settled = true;
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    };

    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('error', (err) => {
      if (settled) return;
      cleanup();
      reject(err);
    });
    child.once('close', (code: number | null) => {
      if (settled) return;
      cleanup();
      resolve({ code, stdout: stdout.finish(), stderr: stderr.finish(), timedOut, aborted });
    });
  });
}
