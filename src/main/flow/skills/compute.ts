import { spawn } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { sendLog } from '../../helpers';

// Exported for the test suite.
export function parseArgs(input: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '');
  }
  return out;
}

export async function execRun(config: Record<string, string>): Promise<string> {
  const path = (config.path ?? '').trim();
  if (!path) return '';
  const argv = parseArgs(config.args ?? '');
  const commandLine = argv.length > 0 ? `${path} ${argv.join(' ')}` : path;

  try {
    let child;
    if (process.platform === 'darwin' && path.toLowerCase().endsWith('.app')) {
      const openArgs = argv.length > 0 ? ['-a', path, '--args', ...argv] : ['-a', path];
      child = spawn('open', openArgs, { detached: true, stdio: 'ignore' });
    } else if (process.platform === 'win32' && /\.(bat|cmd)$/i.test(path)) {
      // Node >= 20.12 refuses to spawn .bat/.cmd directly (CVE-2024-27980); run
      // them through cmd.exe instead of letting spawn throw a cryptic EINVAL.
      child = spawn('cmd.exe', ['/c', path, ...argv], { detached: true, stdio: 'ignore', windowsHide: false });
    } else {
      child = spawn(path, argv, { detached: true, stdio: 'ignore', windowsHide: false });
    }

    child.on('error', (err: Error) => {
      sendLog(`⚠️ [AgentFlow] Launch failed for "${path}": ${err.message}`);
    });
    child.unref();
  } catch (err) {
    // spawn can throw synchronously; run is fire-and-forget, so log and continue
    // rather than aborting the flow.
    sendLog(`⚠️ [AgentFlow] Launch failed for "${path}": ${err instanceof Error ? err.message : String(err)}`);
    return commandLine;
  }

  sendLog(`🚀 [AgentFlow] Launched: ${commandLine}`);
  return commandLine;
}

export function execText(config: Record<string, string>): string {
  return config.text ?? '';
}

const RANDOM_MAX_COUNT = 10_000;

function parseIntOr(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt((raw ?? '').trim(), 10);
  return Number.isFinite(n) ? n : fallback;
}

export function execRandom(config: Record<string, string>): string {
  let min = parseIntOr(config.min, 1);
  let max = parseIntOr(config.max, 100);
  if (min > max) [min, max] = [max, min];

  let count = Math.max(1, parseIntOr(config.count, 1));
  if (count > RANDOM_MAX_COUNT) {
    sendLog(`⚠️ [AgentFlow] random: count ${count} exceeds ${RANDOM_MAX_COUNT}, capping to ${RANDOM_MAX_COUNT}`);
    count = RANDOM_MAX_COUNT;
  }

  const rangeSize = max - min + 1;
  const pick = (): number => Math.floor(Math.random() * rangeSize) + min;

  if (count <= 1) return String(pick());

  if (config.unique === 'true') {
    const target = Math.min(count, rangeSize);
    if (target < count) {
      sendLog(`⚠️ [AgentFlow] random: cannot pick ${count} unique numbers from ${min}–${max}, capping to ${target}`);
    }
    const picked = new Set<number>();
    while (picked.size < target) picked.add(pick());
    return JSON.stringify([...picked]);
  }

  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(pick());
  return JSON.stringify(out);
}

// Exported for the test suite.
export function coerceJsOutput(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
}

const JS_RESERVED = new Set([
  'arguments', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
  'default', 'delete', 'do', 'else', 'enum', 'eval', 'export', 'extends', 'false', 'finally',
  'for', 'function', 'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'let', 'new',
  'null', 'package', 'private', 'protected', 'public', 'return', 'static', 'super', 'switch',
  'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'vars',
]);

// Exported for the test suite.
export function isInjectableIdentifier(key: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) && !JS_RESERVED.has(key);
}

function parseContextJson(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
  }
  return {};
}

const JS_PARAM_NAMES = [
  'vars', 'JSON', 'Math', 'Date', 'console', 'fetch', 'URL', 'URLSearchParams',
  'TextEncoder', 'TextDecoder', 'Buffer', 'structuredClone', 'crypto',
] as const;

// Runs user/AI-authored code in a worker thread so a synchronous busy-loop or
// catastrophic regex cannot freeze the Electron main process, and the step
// timeout can actually terminate it.
const JS_WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const coerceJsOutput = ${coerceJsOutput.toString()};
(async () => {
  const { body, ctx, paramNames } = workerData;
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const globalsMap = {
    vars: ctx, JSON: JSON, Math: Math, Date: Date, console: console,
    fetch: globalThis.fetch, URL: URL, URLSearchParams: URLSearchParams,
    TextEncoder: TextEncoder, TextDecoder: TextDecoder, Buffer: Buffer,
    structuredClone: globalThis.structuredClone, crypto: globalThis.crypto,
  };
  let fn;
  try {
    fn = new AsyncFunction(...paramNames, body);
  } catch (err) {
    parentPort.postMessage({ ok: false, kind: 'syntax', error: err instanceof Error ? err.message : String(err) });
    return;
  }
  try {
    const result = await fn(...paramNames.map((n) => globalsMap[n]));
    parentPort.postMessage({ ok: true, value: coerceJsOutput(result) });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
})();
`;

interface JsWorkerResult {
  ok: boolean;
  kind?: string;
  value?: string;
  error?: string;
}

export async function execJs(config: Record<string, string>, timeoutMs = 60_000): Promise<string> {
  const code = config.code ?? '';
  if (!code.trim()) return '';

  const ctx = parseContextJson(config.__contextJson);
  const decls = Object.keys(ctx)
    .filter(isInjectableIdentifier)
    .map((k) => `const ${k} = vars[${JSON.stringify(k)}];`)
    .join('\n');
  const body = `${decls}\n${code}`;

  const worker = new Worker(JS_WORKER_SOURCE, {
    eval: true,
    workerData: { body, ctx, paramNames: [...JS_PARAM_NAMES] },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<string>((resolve, reject) => {
      timer = setTimeout(() => {
        void worker.terminate();
        reject(new Error(`JS step exceeded ${Math.ceil(timeoutMs / 1_000)}s and was terminated`));
      }, Math.max(1_000, timeoutMs));
      worker.once('message', (msg: JsWorkerResult) => {
        if (msg?.ok) {
          resolve(typeof msg.value === 'string' ? msg.value : String(msg.value ?? ''));
        } else if (msg?.kind === 'syntax') {
          reject(new Error(`JS step syntax error: ${msg.error ?? 'unknown error'}`));
        } else {
          reject(new Error(msg?.error ?? 'JS step failed'));
        }
      });
      worker.once('error', (err) => reject(err instanceof Error ? err : new Error(String(err))));
      worker.once('exit', (exitCode) => {
        if (exitCode !== 0) reject(new Error(`JS step worker exited unexpectedly (code ${exitCode})`));
      });
    });
  } finally {
    if (timer) clearTimeout(timer);
    void worker.terminate();
  }
}
