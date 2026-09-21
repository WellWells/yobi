import { spawn } from 'node:child_process';
import * as os from 'node:os';
import { app } from 'electron';
import { ensureHttpScheme } from '../../urlParser';
import { relaunchApp, sendLog } from '../../helpers';
import { resolveSysInfoSelection, SYSINFO_FIELDS } from '../../../shared/sysinfoFields';
import { createHardwareResolvers } from './hardwareInfo';
import { resolveLocalIp } from './networkInfo';

const BYTES_PER_GB = 1024 ** 3;
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

const PLATFORM_NAMES: Record<string, string> = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };

function formatBytes(bytes: number): string {
  return `${(bytes / BYTES_PER_GB).toFixed(1)} GB`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

async function resolveGpuModel(): Promise<string> {
  try {
    const info = await app.getGPUInfo('complete') as {
      auxAttributes?: { glRenderer?: string };
      gpuDevice?: Array<{ vendorId?: number; deviceId?: number }>;
    };
    const renderer = info.auxAttributes?.glRenderer?.trim();
    if (renderer) return renderer;
    const device = info.gpuDevice?.[0];
    if (device?.vendorId) return `vendor ${device.vendorId}, device ${device.deviceId ?? '?'}`;
  } catch {
  }
  return 'unknown';
}

const PUBLIC_IP_TIMEOUT_MS = 4_000;

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseCloudflareTrace(text: string): string {
  const fields: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) fields[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  const ip = fields.ip ?? '';
  if (!ip) return '';
  return fields.warp === 'on' ? `${ip} (Cloudflare WARP)` : ip;
}

function parseIpifyJsonIp(text: string): string {
  try {
    const parsed = JSON.parse(text) as { ip?: unknown };
    return typeof parsed.ip === 'string' ? parsed.ip.trim() : '';
  } catch {
    return '';
  }
}

const PUBLIC_IP_SOURCES: ReadonlyArray<{ url: string; parse: (text: string) => string }> = [
  { url: 'https://one.one.one.one/cdn-cgi/trace', parse: parseCloudflareTrace },
  { url: 'https://api.ipify.org?format=json', parse: parseIpifyJsonIp },
  { url: 'https://checkip.amazonaws.com', parse: (text) => text.trim() },
];

async function resolvePublicIp(): Promise<string> {
  for (const source of PUBLIC_IP_SOURCES) {
    try {
      const ip = source.parse(await fetchText(source.url, PUBLIC_IP_TIMEOUT_MS));
      if (ip) return ip;
    } catch {
    }
  }
  return 'lookup failed';
}

function resolveSystemLocale(): string {
  try {
    const preferred = app.getPreferredSystemLanguages();
    if (preferred.length > 0 && preferred[0]) return preferred[0];
  } catch {
  }
  try {
    const systemLocale = app.getSystemLocale();
    if (systemLocale) return systemLocale;
  } catch {
  }
  return Intl.DateTimeFormat().resolvedOptions().locale;
}

interface JsonFieldGroup { group: string; key: string; array?: boolean }

const SYSINFO_JSON_GROUPS: Record<string, JsonFieldGroup> = {
  os: { group: 'system', key: 'os' },
  platform: { group: 'system', key: 'platform' },
  hostname: { group: 'system', key: 'hostname' },
  manufacturer: { group: 'system', key: 'manufacturer' },
  locale: { group: 'system', key: 'locale' },
  timezone: { group: 'system', key: 'timezone' },
  uptime: { group: 'system', key: 'uptime' },
  time: { group: 'system', key: 'time' },
  timeLocal: { group: 'system', key: 'timeLocal' },
  cpu: { group: 'cpu', key: 'model' },
  cpuSpeed: { group: 'cpu', key: 'speed' },
  cpuCores: { group: 'cpu', key: 'cores' },
  memoryTotal: { group: 'memory', key: 'total' },
  memoryFree: { group: 'memory', key: 'free' },
  memoryType: { group: 'memory', key: 'type' },
  memoryModules: { group: 'memory', key: 'modules', array: true },
  gpu: { group: 'gpu', key: 'renderer' },
  graphics: { group: 'gpu', key: 'model' },
  displays: { group: 'displays', key: '', array: true },
  motherboard: { group: 'motherboard', key: 'model' },
  bios: { group: 'motherboard', key: 'bios' },
  disks: { group: 'storage', key: 'disks', array: true },
  volumes: { group: 'storage', key: 'volumes', array: true },
  localIp: { group: 'network', key: 'localIp' },
  publicIp: { group: 'network', key: 'publicIp' },
  macAddress: { group: 'network', key: 'macAddress' },
  gateway: { group: 'network', key: 'gateway' },
  netInterface: { group: 'network', key: 'interface' },
  networkAdapters: { group: 'network', key: 'adapters', array: true },
  dns: { group: 'network', key: 'dns', array: true },
  appVersion: { group: 'version', key: 'app' },
  electron: { group: 'version', key: 'electron' },
  node: { group: 'version', key: 'node' },
  chrome: { group: 'version', key: 'chrome' },
};

function buildGroupedSysInfo(typed: Record<string, unknown>): Record<string, unknown> {
  const grouped: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(typed)) {
    const spec = SYSINFO_JSON_GROUPS[field];
    if (!spec) continue;
    const shaped = spec.array && typeof value === 'string' ? value.split(/;\s*/).filter(Boolean) : value;
    if (spec.key === '') {
      grouped[spec.group] = shaped;
    } else {
      const bucket = (grouped[spec.group] ??= {}) as Record<string, unknown>;
      bucket[spec.key] = shaped;
    }
  }
  return grouped;
}

export async function execSysInfo(config: Record<string, string>): Promise<string> {
  const selected = new Set(resolveSysInfoSelection(config));
  const cpus = os.cpus();
  const now = new Date();

  const syncValue: Record<string, () => unknown> = {
    os: () => `${os.type()} ${os.release()} (${os.arch()})`,
    platform: () => PLATFORM_NAMES[process.platform] ?? process.platform,
    hostname: () => os.hostname(),
    locale: () => resolveSystemLocale(),
    timezone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    uptime: () => formatUptime(os.uptime()),
    time: () => now.toISOString(),
    timeLocal: () => now.toString(),
    cpu: () => cpus[0]?.model.trim() ?? 'unknown',
    cpuCores: () => cpus.length,
    memoryTotal: () => formatBytes(os.totalmem()),
    memoryFree: () => formatBytes(os.freemem()),
    appVersion: () => app.getVersion(),
    electron: () => process.versions.electron,
    node: () => process.versions.node,
    chrome: () => process.versions.chrome,
  };

  const asyncValue: Record<string, () => Promise<unknown>> = {
    ...createHardwareResolvers(),
    localIp: resolveLocalIp,
    publicIp: resolvePublicIp,
    gpu: resolveGpuModel,
  };

  const values = new Map<string, unknown>();
  const pending: Array<Promise<void>> = [];
  for (const { key } of SYSINFO_FIELDS) {
    if (!selected.has(key)) continue;
    const asyncFn = asyncValue[key];
    if (asyncFn) pending.push(asyncFn().then((value) => { values.set(key, value); }));
    else values.set(key, syncValue[key]?.());
  }
  await Promise.all(pending);

  const typed: Record<string, unknown> = {};
  for (const { key } of SYSINFO_FIELDS) {
    if (selected.has(key)) typed[key] = values.get(key);
  }

  sendLog(`🖥️ [Flow] System info collected (${Object.keys(typed).length} fields)`);

  const output = config.format === 'json'
    ? JSON.stringify(buildGroupedSysInfo(typed), null, 2)
    : Object.entries(typed)
        .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`)
        .join('\n');

  const subVars: Record<string, string> = {};
  for (const [key, value] of Object.entries(typed)) {
    subVars[key] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return JSON.stringify({ output, ...subVars });
}

export async function execHttp(config: Record<string, string>, timeoutMs: number): Promise<string> {
  const url = ensureHttpScheme(config.url ?? '');
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) throw new Error(`Invalid HTTP URL: ${url}`);

  const method = (config.method ?? 'GET').toUpperCase();
  if (!ALLOWED_METHODS.has(method)) throw new Error(`Unsupported HTTP method: ${method}`);

  let headers: Record<string, string> | undefined;
  const rawHeaders = (config.headers ?? '').trim();
  if (rawHeaders) {
    try {
      const parsed: unknown = JSON.parse(rawHeaders);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      headers = Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
      );
    } catch {
      throw new Error('HTTP headers must be a valid JSON object');
    }
  }

  const hasBody = method !== 'GET' && method !== 'DELETE' && (config.body ?? '') !== '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, timeoutMs));

  sendLog(`🌐 [Flow] HTTP ${method} ${url}`);
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: hasBody ? config.body : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    sendLog(`🌐 [Flow] HTTP ${response.status} — ${text.length} chars`);
    return text;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`HTTP request timed out after ${Math.ceil(timeoutMs / 1_000)}s`);
    }
    // undici throws a bare "fetch failed" and puts the reason on `cause`. That reason is the
    // whole diagnosis — DNS, a refused port, a bad certificate — so it travels with the message.
    if (err instanceof Error && err.cause instanceof Error) {
      throw new Error(`${err.message}: ${err.cause.message}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

type PowerAction = 'shutdown' | 'restart' | 'logout' | 'sleep' | 'lock' | 'hibernate';
const POWER_ACTIONS = new Set<string>(['shutdown', 'restart', 'logout', 'sleep', 'lock', 'hibernate']);

interface PowerCommand {
  cmd: string;
  args: string[];
}

function resolvePowerCommand(action: PowerAction): PowerCommand | null {
  if (process.platform === 'win32') {
    switch (action) {
      case 'shutdown': return { cmd: 'shutdown.exe', args: ['/s', '/t', '0', '/f'] };
      case 'restart': return { cmd: 'shutdown.exe', args: ['/r', '/t', '0', '/f'] };
      case 'logout': return { cmd: 'shutdown.exe', args: ['/l'] };
      case 'sleep': return {
        cmd: 'powershell.exe',
        args: ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend', $true, $false)"],
      };
      case 'lock': return { cmd: 'rundll32.exe', args: ['user32.dll,LockWorkStation'] };
      case 'hibernate': return { cmd: 'shutdown.exe', args: ['/h'] };
    }
  }
  if (process.platform === 'darwin') {
    switch (action) {
      case 'shutdown': return { cmd: 'osascript', args: ['-e', 'tell app "System Events" to shut down'] };
      case 'restart': return { cmd: 'osascript', args: ['-e', 'tell app "System Events" to restart'] };
      case 'logout': return { cmd: 'osascript', args: ['-e', 'tell app "System Events" to log out'] };
      case 'sleep': return { cmd: 'pmset', args: ['sleepnow'] };
      case 'lock': return { cmd: 'osascript', args: ['-e', 'tell application "System Events" to keystroke "q" using {control down, command down}'] };
      case 'hibernate': return null;
    }
  }
  switch (action) {
    case 'shutdown': return { cmd: 'systemctl', args: ['poweroff'] };
    case 'restart': return { cmd: 'systemctl', args: ['reboot'] };
    case 'logout': {
      const sessionId = (process.env.XDG_SESSION_ID ?? '').trim();
      return sessionId
        ? { cmd: 'loginctl', args: ['terminate-session', sessionId] }
        : { cmd: 'loginctl', args: ['terminate-user', os.userInfo().username] };
    }
    case 'sleep': return { cmd: 'systemctl', args: ['suspend'] };
    case 'lock': return { cmd: 'loginctl', args: ['lock-session'] };
    case 'hibernate': return { cmd: 'systemctl', args: ['hibernate'] };
  }
}

export async function execPower(config: Record<string, string>): Promise<string> {
  const action = (config.action ?? '').trim().toLowerCase();
  if (!action) {
    sendLog('⏻ [Flow] Power: no action selected — skipping');
    return '';
  }
  if (!POWER_ACTIONS.has(action)) {
    throw new Error(`Unknown power action: ${action}`);
  }
  const resolved = resolvePowerCommand(action as PowerAction);
  if (!resolved) {
    throw new Error(`Power action "${action}" is not supported on ${process.platform}`);
  }

  const child = spawn(resolved.cmd, resolved.args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', (err: Error) => {
    sendLog(`⚠️ [Flow] Power "${action}" failed: ${err.message}`);
  });
  child.unref();
  sendLog(`⏻ [Flow] Power: ${action} (${resolved.cmd} ${resolved.args.join(' ')})`);
  return '';
}

export async function execRestartApp(): Promise<string> {
  sendLog('🔄 [Flow] Restarting Yobi...');
  relaunchApp('restart_app skill');
  return '';
}
