import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { anySiteChanged, clearSiteChanged } from '../../shared/linkSites/siteChanged';
import type { YtdlToolsState } from '../../shared/ytdl';
import { ytdlToolsRoot } from './paths';
import { checkYtdlUpdate, selfTest, toolsLock, ytdlInstallerDeps } from './toolInstaller';
import type { YtdlCustomPaths } from './toolState';
import { customToolPaths, getYtdlToolsState, updateYtdlState } from './toolState';

/** The settings card's actions: remove, custom paths, the nightly switch, and the update timer. */

export function removeYtdlTools(): Promise<YtdlToolsState> {
  return toolsLock.runExclusive(async () => {
    const root = ytdlToolsRoot();
    const names = await fs.readdir(root).catch(() => [] as string[]);
    for (const name of names) {
      if (name === 'state.json') continue;
      await fs.rm(path.join(root, name), { recursive: true, force: true })
        .catch((err) => ytdlInstallerDeps().log(`[Ytdl] could not remove ${name}: ${err instanceof Error ? err.message : String(err)}`));
    }
    return updateYtdlState((s) => {
      s.ytdlp = undefined;
      s.previousYtdlp = undefined;
      s.ffmpeg = undefined;
      s.testedOk = false;
      clearSiteChanged(s);
      s.lastFailure = undefined;
      s.installError = undefined;
    });
  });
}

/**
 * Uses tools the user installed: `ytdlp` is the executable, `ffmpegDir` the folder holding ffmpeg
 * and ffprobe. All three must run before anything is saved; Yobi never updates them. `null` goes
 * back to the managed tools.
 */
export function setYtdlCustomPaths(paths: YtdlCustomPaths | null): Promise<YtdlToolsState> {
  return toolsLock.runExclusive(async () => {
    if (!paths) {
      return updateYtdlState((s) => {
        s.customPaths = undefined;
        s.customVersion = undefined;
        clearSiteChanged(s);
        s.lastFailure = undefined;
      });
    }
    if (!path.isAbsolute(paths.ytdlp) || !path.isAbsolute(paths.ffmpegDir)) {
      throw new Error('custom tool paths must be absolute');
    }
    const custom = { ytdlp: path.normalize(paths.ytdlp), ffmpegDir: path.normalize(paths.ffmpegDir) };
    const tools = customToolPaths(custom);
    const version = (await selfTest('yt-dlp', tools.ytdlp, '--version')).trim().split(/\r?\n/)[0] ?? '';
    await selfTest('ffmpeg', tools.ffmpeg, '-version');
    await selfTest('ffprobe', tools.ffprobe, '-version');
    return updateYtdlState((s) => {
      s.customPaths = custom;
      s.customVersion = version || undefined;
      clearSiteChanged(s);
      s.lastFailure = undefined;
    });
  });
}

/** Switches the yt-dlp channel; the next update check installs the other channel's build. */
export function setYtdlNightly(on: boolean): Promise<YtdlToolsState> {
  return updateYtdlState((s) => {
    s.nightly = on;
    s.lastCheckedAt = undefined;
  });
}

const FIRST_CHECK_DELAY_MS = 5 * 60_000;
const TICK_MS = 60 * 60_000;
const DAILY_MS = 24 * 60 * 60_000;
/** While some site's change has its downloads off, a fixed yt-dlp is looked for more often. */
const SITE_CHANGED_MS = 6 * 60 * 60_000;

let timer: NodeJS.Timeout | null = null;

export async function scheduledYtdlCheck(now = Date.now()): Promise<void> {
  const state = getYtdlToolsState();
  if (state.status !== 'ready') return;
  const interval = anySiteChanged(state) ? SITE_CHANGED_MS : DAILY_MS;
  const last = Date.parse(state.lastCheckedAt ?? '');
  if (Number.isFinite(last) && now - last < interval) return;
  await checkYtdlUpdate({ force: true });
}

function schedule(delay: number): void {
  timer = setTimeout(() => {
    schedule(TICK_MS);
    scheduledYtdlCheck().catch(() => undefined);
  }, delay);
  timer.unref();
}

/** Checks hourly whether a check is due (daily, or every 6 h while any site's changed flag is set). */
export function startYtdlUpdateSchedule(): void {
  if (timer) return;
  schedule(FIRST_CHECK_DELAY_MS);
}

export function stopYtdlUpdateSchedule(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}
