import { spawn } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { sendLog } from '../../helpers';
import { FlowUserError } from '../userError';

/**
 * Split a command line the way a shell would, minus backslash escapes (Windows paths stay literal):
 * whitespace ends a token, and a quoted segment anywhere in a token joins it without its quotes, so
 * `--title="hello world"` is the one argument `--title=hello world`. `""` is an empty argument; a
 * quote with no closing partner is an ordinary character, and so is an apostrophe right after a
 * letter or digit (`--name=O'Brien 'a b'` keeps the name instead of pairing with the next quote).
 */
export function parseArgs(input: string): string[] {
  const out: string[] = [];
  let token = '';
  let started = false;
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) {
      if (started) out.push(token);
      token = '';
      started = false;
      i++;
      continue;
    }
    const apostrophe = ch === "'" && started && /[\p{L}\p{N}]/u.test(input[i - 1]);
    started = true;
    const opensQuote = ch === '"' || (ch === "'" && !apostrophe);
    const close = opensQuote ? input.indexOf(ch, i + 1) : -1;
    if (close === -1) {
      token += ch;
      i++;
      continue;
    }
    token += input.slice(i + 1, close);
    i = close + 1;
  }
  if (started) out.push(token);
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
      child = spawn('cmd.exe', ['/c', path, ...argv], { detached: true, stdio: 'ignore', windowsHide: false });
    } else {
      child = spawn(path, argv, { detached: true, stdio: 'ignore', windowsHide: false });
    }

    child.on('error', (err: Error) => {
      sendLog(`⚠️ [Flow] Launch failed for "${path}": ${err.message}`);
    });
    child.unref();
  } catch (err) {
    sendLog(`⚠️ [Flow] Launch failed for "${path}": ${err instanceof Error ? err.message : String(err)}`);
    return commandLine;
  }

  sendLog(`🚀 [Flow] Launched: ${commandLine}`);
  return commandLine;
}

export function execText(config: Record<string, string>): string {
  return config.text ?? '';
}

const RANDOM_MAX_COUNT = 10_000;
const RANDOM_DEFAULT_MIN = 1;
const RANDOM_DEFAULT_MAX = 100;

function parseIntOr(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt((raw ?? '').trim(), 10);
  return Number.isFinite(n) ? n : fallback;
}

/** A uniform index in [0, size); the clamp covers `random() * size` rounding up to `size`. */
function randomIndex(size: number): number {
  return Math.min(Math.floor(Math.random() * size), size - 1);
}

/**
 * Above Number.MAX_SAFE_INTEGER doubles skip integers, so `max - min + 1` overstates the reachable
 * values and unique sampling could never finish; reject unsafe bounds up front.
 */
function assertSafeRange(min: number, max: number, config: Record<string, string>): void {
  if (Number.isSafeInteger(min) && Number.isSafeInteger(max) && Number.isSafeInteger(max - min + 1)) return;
  // A blank bound means its default; name that instead of an empty "()".
  const rawMin = (config.min ?? '').trim() || String(RANDOM_DEFAULT_MIN);
  const rawMax = (config.max ?? '').trim() || String(RANDOM_DEFAULT_MAX);
  throw new FlowUserError(
    'flow.error.randomRange',
    { min: rawMin, max: rawMax },
    `random: min (${rawMin}) and max (${rawMax}) must be whole numbers between ${-Number.MAX_SAFE_INTEGER} and ${Number.MAX_SAFE_INTEGER}, at most ${Number.MAX_SAFE_INTEGER - 1} apart`,
  );
}

/** `target` distinct offsets in [0, size): a partial Fisher-Yates over a sparse virtual array, exactly `target` draws. */
function sampleDistinctOffsets(size: number, target: number): number[] {
  const swapped = new Map<number, number>();
  const out: number[] = [];
  for (let i = 0; i < target; i++) {
    const j = i + randomIndex(size - i);
    out.push(swapped.get(j) ?? j);
    swapped.set(j, swapped.get(i) ?? i);
  }
  return out;
}

export function execRandom(config: Record<string, string>): string {
  let min = parseIntOr(config.min, RANDOM_DEFAULT_MIN);
  let max = parseIntOr(config.max, RANDOM_DEFAULT_MAX);
  if (min > max) [min, max] = [max, min];
  assertSafeRange(min, max, config);

  let count = Math.max(1, parseIntOr(config.count, 1));
  if (count > RANDOM_MAX_COUNT) {
    sendLog(`⚠️ [Flow] random: count ${count} exceeds ${RANDOM_MAX_COUNT}, capping to ${RANDOM_MAX_COUNT}`);
    count = RANDOM_MAX_COUNT;
  }

  const rangeSize = max - min + 1;
  const pick = (): number => randomIndex(rangeSize) + min;

  if (count <= 1) return String(pick());

  if (config.unique === 'true') {
    const target = Math.min(count, rangeSize);
    if (target < count) {
      sendLog(`⚠️ [Flow] random: cannot pick ${count} unique numbers from ${min}–${max}, capping to ${target}`);
    }
    return JSON.stringify(sampleDistinctOffsets(rangeSize, target).map((offset) => offset + min));
  }

  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(pick());
  return JSON.stringify(out);
}

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

const JS_PARAM_NAMES = [
  'vars', 'JSON', 'Math', 'Date', 'console', 'fetch', 'URL', 'URLSearchParams',
  'TextEncoder', 'TextDecoder', 'Buffer', 'structuredClone', 'crypto',
] as const;

// A `const` named like a function parameter is a SyntaxError in the body, so context
// keys that collide with a parameter stay reachable only through `vars[...]`.
const JS_RESERVED = new Set<string>([
  ...JS_PARAM_NAMES,
  'arguments', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
  'default', 'delete', 'do', 'else', 'enum', 'eval', 'export', 'extends', 'false', 'finally',
  'for', 'function', 'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'let', 'new',
  'null', 'package', 'private', 'protected', 'public', 'return', 'static', 'super', 'switch',
  'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield',
]);

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
