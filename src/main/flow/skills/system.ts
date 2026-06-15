import { spawn } from 'node:child_process';
import * as os from 'node:os';
import { app } from 'electron';
import { fetchRawText } from '../../urlParser';
import { relaunchApp, sendLog } from '../../helpers';

const BYTES_PER_GB = 1024 ** 3;
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

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

function collectLocalIps(): string[] {
  const result: string[] = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) result.push(addr.address);
    }
  }
  return result;
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

export async function execSysInfo(config: Record<string, string>): Promise<string> {
  const cpus = os.cpus();
  const now = new Date();
  const info: Record<string, unknown> = {
    os: `${os.type()} ${os.release()} (${os.arch()})`,
    platform: process.platform,
    hostname: os.hostname(),
    cpu: cpus[0]?.model.trim() ?? 'unknown',
    cpuCores: cpus.length,
    memoryTotal: formatBytes(os.totalmem()),
    memoryFree: formatBytes(os.freemem()),
    uptime: formatUptime(os.uptime()),
    localIp: collectLocalIps(),
    time: now.toISOString(),
    timeLocal: now.toString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  };

  if (config.includeGpu !== 'false') {
    info.gpu = await resolveGpuModel();
  }

  if (config.includePublicIp === 'true') {
    try {
      info.publicIp = (await fetchRawText('https://api.ipify.org')).trim();
    } catch (err) {
      info.publicIp = `lookup failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  sendLog(`🖥️ [AgentFlow] System info collected (${Object.keys(info).length} fields)`);

  if (config.format === 'json') {
    return JSON.stringify(info, null, 2);
  }
  return Object.entries(info)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`)
    .join('\n');
}

export async function execHttp(config: Record<string, string>, timeoutMs: number): Promise<string> {
  const url = (config.url ?? '').trim();
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

  sendLog(`🌐 [AgentFlow] HTTP ${method} ${url}`);
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: hasBody ? config.body : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    sendLog(`🌐 [AgentFlow] HTTP ${response.status} — ${text.length} chars`);
    return text;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`HTTP request timed out after ${Math.ceil(timeoutMs / 1_000)}s`);
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
    sendLog('⏻ [AgentFlow] Power: no action selected — skipping');
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
    sendLog(`⚠️ [AgentFlow] Power "${action}" failed: ${err.message}`);
  });
  child.unref();
  sendLog(`⏻ [AgentFlow] Power: ${action} (${resolved.cmd} ${resolved.args.join(' ')})`);
  return '';
}

export async function execRestartApp(): Promise<string> {
  sendLog('🔄 [AgentFlow] Restarting Yobi...');
  relaunchApp('restart_app skill');
  return '';
}
