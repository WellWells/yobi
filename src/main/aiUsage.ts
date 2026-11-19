import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { maskSecrets } from '../shared/secretMask';
import { isElevated } from './flow/agent/elevation';

export interface AiUsageReport {
  status: 'ok' | 'missing' | 'error';
  output: string;
  checkedAt: string;
  timezone: string;
}

export interface AiUsageOptions {
  /** Host-owned settings only, never fields from the model's tool call. */
  env?: NodeJS.ProcessEnv;
  writeRoots: readonly string[];
  signal?: AbortSignal;
  timeoutMs?: number;
}

const OUTPUT_LIMIT = 65_536;
const TIMEOUT_MS = 40_000;
const BINARY = process.platform === 'win32' ? 'agentswap.exe' : 'agentswap';
const CHILD_ENV = [
  'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'SYSTEMROOT', 'WINDIR',
  'USER', 'USERNAME', 'LOGNAME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TMP', 'TEMP', 'TMPDIR',
  'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS',
  'CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'AGENTSWAP_HOME',
] as const;

function envValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  if (process.platform !== 'win32') return env[key];
  return Object.entries(env).find(([name]) => name.toUpperCase() === key)?.[1];
}

function localAbsolute(value: string): boolean {
  return path.isAbsolute(value) && !value.startsWith('\\\\') && !value.startsWith('//');
}

function within(file: string, root: string): boolean {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function writable(file: string, roots: readonly string[]): Promise<boolean> {
  const real = await fs.realpath(file).catch(() => path.resolve(file));
  for (const root of roots) {
    const realRoot = await fs.realpath(root).catch(() => path.resolve(root));
    if (within(file, root) || within(real, realRoot)) return true;
  }
  return false;
}

function pathDirs(env: NodeJS.ProcessEnv): string[] {
  return (envValue(env, 'PATH') ?? '').split(path.delimiter)
    .map((dir) => dir.trim().replace(/^"(.*)"$/, '$1')).filter(localAbsolute);
}

/** Child discovery cannot pick up a script the agent wrote, or an inherited loader hook. */
export async function aiUsageEnvironment(env: NodeJS.ProcessEnv, writeRoots: readonly string[]): Promise<NodeJS.ProcessEnv> {
  const clean: NodeJS.ProcessEnv = {};
  for (const key of CHILD_ENV) {
    const value = envValue(env, key);
    if (value !== undefined) clean[key] = value;
  }
  const directories: string[] = [];
  for (const dir of pathDirs(env)) {
    const real = await fs.realpath(dir).catch(() => null);
    if (real && localAbsolute(real) && !await writable(real, writeRoots) && !directories.includes(real)) directories.push(real);
  }
  clean.PATH = directories.join(path.delimiter);
  clean.NO_COLOR = '1';
  clean.AGENTSWAP_NO_UPDATE_CHECK = '1';
  clean.AGENTSWAP_LANG = 'en';
  return clean;
}

function installDirs(env: NodeJS.ProcessEnv): string[] {
  const local = envValue(env, 'LOCALAPPDATA');
  const home = envValue(env, 'HOME') ?? os.homedir();
  return [
    envValue(env, 'AGENTSWAP_INSTALL_DIR') ?? '',
    ...(process.platform === 'win32' ? (local ? [path.join(local, 'agentswap', 'bin')] : [])
      : [path.join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin']),
    ...pathDirs(env),
  ].filter(localAbsolute);
}

async function nativeBinary(file: string): Promise<boolean> {
  const handle = await fs.open(file, 'r');
  try {
    const header = Buffer.alloc(4);
    const { bytesRead } = await handle.read(header, 0, 4, 0);
    if (bytesRead !== 4) return false;
    if (process.platform === 'win32') return header.subarray(0, 2).toString('hex') === '4d5a';
    if (process.platform === 'darwin') return ['cffaedfe', 'cefaedfe', 'feedfacf', 'feedface', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'].includes(header.toString('hex'));
    return header.toString('hex') === '7f454c46';
  } finally {
    await handle.close();
  }
}

/** Resolve a native installation, never a shell alias, wrapper, current-directory file or model path. */
async function locate(env: NodeJS.ProcessEnv, roots: readonly string[]): Promise<{ file?: string; error?: string }> {
  for (const dir of [...new Set(installDirs(env))]) {
    const candidate = path.join(dir, BINARY);
    const stat = await fs.lstat(candidate).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
      throw error;
    });
    if (!stat) continue;
    const real = await fs.realpath(candidate);
    if (!localAbsolute(real) || await writable(candidate, roots) || path.basename(real).toLowerCase() !== BINARY) {
      return { error: 'The located AgentSwap is not in an eligible installation location. Do not run it through shell instead.' };
    }
    if (!(await fs.stat(real)).isFile() || !await nativeBinary(real)) {
      return { error: 'The located AgentSwap is not a native executable. Do not run this wrapper through shell instead.' };
    }
    await fs.access(real, fs.constants.X_OK);
    return { file: real };
  }
  return {};
}

function safeOutput(value: string, env: NodeJS.ProcessEnv): string {
  let text = stripVTControlCharacters(value).slice(0, OUTPUT_LIMIT)
    .replace(/^(\s*#\d+[ \t]+)<([A-Z0-9._%+-]{1,64})@[^<>\r\n]+>/gim, '$1$2')
    .replace(/<[^<>\r\n]*@[^<>\r\n]*>/g, '<account>')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+/gi, '[account]');
  for (const key of ['HOME', 'USERPROFILE']) {
    const home = envValue(env, key);
    if (home) text = text.split(home).join('~');
  }
  return maskSecrets(text, true).trim();
}

/** Supply the local wall clock and offset together so the model never converts UTC itself. */
function localTimestamp(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const offset = -now.getTimezoneOffset();
  const zone = `${offset >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${zone}`;
}

/** One immutable operation. Neither its executable, arguments, environment nor cwd comes from an LLM. */
export async function readAiUsage(options: AiUsageOptions): Promise<AiUsageReport> {
  options.signal?.throwIfAborted();
  const env = options.env ?? process.env;
  const report = (status: AiUsageReport['status'], output: string): AiUsageReport => ({
    status, output, checkedAt: localTimestamp(new Date()), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  if (await isElevated()) return report('error', 'Restart Yobi without administrator/root privileges before checking usage.');
  let cwd: string | undefined;
  try {
    const found = await locate(env, options.writeRoots);
    if (found.error) return report('error', found.error);
    if (!found.file) return report('missing', 'AgentSwap was not found in the host installation locations. Ask before installing it; do not run additional discovery commands.');
    const childEnv = await aiUsageEnvironment(env, options.writeRoots);
    options.signal?.throwIfAborted();
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'yobi-ai-usage-'));
    const timeout = Math.min(TIMEOUT_MS, options.timeoutMs ?? TIMEOUT_MS);
    if (timeout <= 0) return report('error', 'The usage check has no execution time left.');
    const result = await new Promise<{ error: Error | null; stdout: string; stderr: string }>((resolve) => {
      execFile(found.file!, ['status'], {
        shell: false, windowsHide: true, cwd, env: childEnv,
        timeout, maxBuffer: OUTPUT_LIMIT, encoding: 'utf8', signal: options.signal,
      }, (error, stdout, stderr) => resolve({ error, stdout, stderr }));
    });
    options.signal?.throwIfAborted();
    const output = safeOutput([result.stdout, result.stderr].filter(Boolean).join('\n'), env);
    if (result.error) return report('error', `${output}\nThe status check did not complete successfully. Do not retry individual providers; report available results and the failure.`.trim());
    return report(output ? 'ok' : 'error', output || 'AgentSwap returned no usage data. Do not interpret this as zero usage.');
  } catch {
    options.signal?.throwIfAborted();
    return report('error', 'The installed AgentSwap could not be checked. Do not reinstall it or retry through shell automatically.');
  } finally {
    if (cwd) await fs.rm(cwd, { recursive: true, force: true });
  }
}
