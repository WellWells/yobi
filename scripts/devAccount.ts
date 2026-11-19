import { execFileSync } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Stored secrets are sealed with a key that only the OS account which wrote them can open
 * (DPAPI on Windows, the login Keychain on macOS, the user's keyring on Linux). The dev app keeps
 * its secrets in this checkout and in the shared `%APPDATA%\Electron` profile, so starting it as
 * another account makes Chromium replace that key and every stored secret becomes unreadable.
 */

export interface DevAccount {
  platform: NodeJS.Platform;
  /** POSIX uid; undefined on Windows. */
  uid: number | undefined;
  /** Windows SID of the running process; undefined elsewhere or when it could not be read. */
  sid: string | undefined;
  /** Home directory of the account itself. */
  accountHome: string;
  /** Home directory the environment points at (USERPROFILE / HOME). */
  envHome: string | undefined;
}

export type DevAccountProblem = 'service-account' | 'root' | 'borrowed-home';

/** LocalSystem, LocalService, NetworkService. */
const WINDOWS_SERVICE_SIDS = new Set(['S-1-5-18', 'S-1-5-19', 'S-1-5-20']);

function sameDir(a: string, b: string, platform: NodeJS.Platform): boolean {
  const norm = (p: string) => path.resolve(p).replace(/[\\/]+$/, '');
  return platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
}

export function devAccountProblem(account: DevAccount): DevAccountProblem | null {
  if (account.platform === 'win32' && account.sid && WINDOWS_SERVICE_SIDS.has(account.sid)) return 'service-account';
  if (account.platform !== 'win32' && account.uid === 0) return 'root';
  if (account.envHome && !sameDir(account.envHome, account.accountHome, account.platform)) return 'borrowed-home';
  return null;
}

function readWindowsSid(): string | undefined {
  try {
    const whoami = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'whoami.exe');
    const out = execFileSync(whoami, ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true, timeout: 5_000 });
    return out.match(/"(S-1-[\d-]+)"/)?.[1];
  } catch {
    return undefined;
  }
}

export function currentDevAccount(): DevAccount {
  const info = os.userInfo();
  const platform = process.platform;
  return {
    platform,
    uid: platform === 'win32' ? undefined : info.uid,
    sid: platform === 'win32' ? readWindowsSid() : undefined,
    accountHome: info.homedir,
    envHome: platform === 'win32' ? process.env.USERPROFILE : process.env.HOME,
  };
}

export function devAccountMessage(problem: DevAccountProblem, account: DevAccount): string {
  const why =
    problem === 'service-account'
      ? `this shell runs as a Windows service account (${account.sid}), e.g. a "gsudo -s" shell.`
      : problem === 'root'
        ? 'this shell runs as root, e.g. "sudo npm run dev".'
        : `this shell runs as a different account (home ${account.accountHome}) than the one its environment belongs to (${account.envHome}).`;
  return [
    '',
    '\x1b[31m✖ npm run dev refused to start:\x1b[0m',
    `  ${why}`,
    '  Stored keys (bot tokens, API keys, MCP sign-ins) are sealed for your own OS account; starting',
    '  as another account replaces that key and every saved secret has to be entered again.',
    '  Start it from a normal terminal as yourself. If you need admin rights, use plain "gsudo"',
    '  (same account, elevated), not "gsudo -s".',
    '',
  ].join('\n');
}
