import * as os from 'node:os';
import * as path from 'node:path';
import { MANAGED_TOOL_ROWS } from '../../shared/managedTools';
import type { ManagedToolId } from '../../shared/managedTools';

/*
 * What each managed program is and where it comes from. A program is a single executable attached
 * to its author's GitHub releases with a SHA256SUMS file beside it; adding one is a row in
 * `shared/managedTools.ts` plus a spec here.
 */

export interface ToolAsset {
  /** The release file for this machine, e.g. `officecli-win-x64.exe`. */
  name: string;
  /** About how large it is, for the size shown before downloading. */
  approxBytes: number;
}

export interface ManagedToolSpec {
  id: ManagedToolId;
  name: string;
  /** `owner/repo` on GitHub. */
  repo: string;
  /** The command's name on PATH and of the downloaded file (`.exe` added on Windows). */
  command: string;
  asset: (platform: string, arch: string) => ToolAsset | null;
  /** The checksum file attached to every release. */
  sumsFile: string;
  versionArgs: readonly string[];
  /** The version a `versionArgs` run printed, or null when it is not this program. */
  parseVersion: (stdout: string) => string | null;
  minVersion: string;
  /** Variables Yobi's own copy always runs with: its self-updater stays off, Yobi updates it. */
  managedEnv: Readonly<Record<string, string>>;
  /** More of Yobi's environment the program needs, beyond the shared whitelist. */
  passEnv: readonly string[];
  /** Where the program's own installer puts it, for when PATH has not caught up yet. */
  usualLocations: (platform: string, env: NodeJS.ProcessEnv) => string[];
  /** A release is taken only once it has been out this long (an account takeover is usually caught within hours). */
  releaseAgeMs: number;
}

const DAY_MS = 24 * 60 * 60_000;

const OFFICECLI_ASSETS: Record<string, ToolAsset> = {
  'win32-x64': { name: 'officecli-win-x64.exe', approxBytes: 33_558_440 },
  'win32-arm64': { name: 'officecli-win-arm64.exe', approxBytes: 33_996_724 },
  'darwin-x64': { name: 'officecli-mac-x64', approxBytes: 34_911_296 },
  'darwin-arm64': { name: 'officecli-mac-arm64', approxBytes: 33_933_168 },
  'linux-x64': { name: 'officecli-linux-x64', approxBytes: 35_527_269 },
  'linux-arm64': { name: 'officecli-linux-arm64', approxBytes: 34_917_895 },
};

function row(id: ManagedToolId): { name: string } {
  const found = MANAGED_TOOL_ROWS.find((r) => r.id === id);
  if (!found) throw new Error(`no managed tool row for ${id}`);
  return found;
}

const OFFICECLI: ManagedToolSpec = {
  id: 'officecli',
  name: row('officecli').name,
  repo: 'iOfficeAI/OfficeCLI',
  command: 'officecli',
  asset: (platform, arch) => OFFICECLI_ASSETS[`${platform}-${arch}`] ?? null,
  sumsFile: 'SHA256SUMS',
  versionArgs: ['--version'],
  parseVersion: (stdout) => /^\s*v?(\d+\.\d+\.\d+)\b/.exec(stdout)?.[1] ?? null,
  // The first version Yobi was checked against; `mcp` and `--json` are both in it.
  minVersion: '1.0.160',
  // OFFICECLI_SKIP_UPDATE=1 returns at the top of its update check: no download, no rewrite of
  // ~/.officecli/config.json, no refresh of other agents' skill files (UpdateChecker.cs).
  managedEnv: { OFFICECLI_SKIP_UPDATE: '1' },
  passEnv: ['LOCALAPPDATA', 'APPDATA', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME'],
  usualLocations: (platform, env) => {
    if (platform === 'win32') {
      const local = env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
      return [path.win32.join(local, 'OfficeCLI', 'officecli.exe')];
    }
    return [path.posix.join(os.homedir(), '.local', 'bin', 'officecli'), '/opt/homebrew/bin/officecli', '/usr/local/bin/officecli'];
  },
  releaseAgeMs: DAY_MS,
};

export const MANAGED_TOOL_SPECS: Readonly<Record<ManagedToolId, ManagedToolSpec>> = { officecli: OFFICECLI };

export function toolSpec(id: ManagedToolId): ManagedToolSpec {
  return MANAGED_TOOL_SPECS[id];
}
