import { siteLabel } from '../../shared/linkSites/rows';
import { markSiteChanged, siteChangedAt } from '../../shared/linkSites/siteChanged';
import type { LinkSiteId } from '../../shared/linkSites/types';
import type { YtdlFailureCategory } from '../../shared/ytdl';
import { sendLog } from '../helpers';
import { checkYtdlUpdate } from '../youtubeDownload/toolInstaller';
import type { YtdlUpdateResult } from '../youtubeDownload/toolInstaller';
import { getYtdlToolsState, updateYtdlState } from '../youtubeDownload/toolState';
import { YtdlError } from '../youtubeDownload/ytdlErrors';
import { runYtdlpDownload, withDownloadSlot } from './ytdlpInvoke';
import type { YtdlpDownloadResult, YtdlpDownloadRun } from './ytdlpInvoke';

/*
 * One video download for any site: one at a time app-wide, a network failure retried once, and a
 * "the site changed" failure answered by looking for a newer yt-dlp. With none, that site's
 * downloads stay off until one is installed; other sites keep downloading. How a site reads its
 * failures and masks its log lines are the site's hooks (YouTube's are the defaults).
 */

/**
 * The category of "yt-dlp cannot read this site any more", named after YouTube because
 * `lastFailure` in state.json and the Settings text are keyed by it.
 */
export const SITE_CHANGED: YtdlFailureCategory = 'youtubeChanged';

export interface DownloadVideoDeps {
  checkUpdate: (options: { force?: boolean }) => Promise<YtdlUpdateResult>;
  log: (message: string) => void;
}

function defaultDeps(): DownloadVideoDeps {
  return { checkUpdate: checkYtdlUpdate, log: sendLog };
}

let deps: DownloadVideoDeps = defaultDeps();

export function setDownloadVideoDeps(partial: Partial<DownloadVideoDeps> | null): void {
  deps = partial ? { ...defaultDeps(), ...partial } : defaultDeps();
}

export interface SiteDownloadHooks {
  /** Reads why yt-dlp failed; YouTube's reading (`classifyYtdlFailure`) by default. */
  classify?: YtdlpDownloadRun['classify'];
  /** Makes stderr safe for the log; every URL's query cut (`maskYtdlStderr`) by default. */
  mask?: YtdlpDownloadRun['mask'];
  /**
   * A `blocked` failure the site can lift itself (bilibili's HTTP 412: reload its page for a fresh
   * script-check token). True = try once more; without the hook a block is final.
   */
  refreshBlocked?: (signal?: AbortSignal) => Promise<boolean>;
}

export type VideoDownloadOptions = Omit<YtdlpDownloadRun, 'label'> & SiteDownloadHooks;

async function recordFailure(site: LinkSiteId, category: YtdlFailureCategory, siteChanged = false): Promise<void> {
  const at = new Date().toISOString();
  await updateYtdlState((s) => {
    s.lastFailure = { category, at, site };
    if (siteChanged) markSiteChanged(s, site, at);
  }).catch((err) => deps.log(`[Ytdl] could not record the failure: ${err instanceof Error ? err.message : String(err)}`));
}

/**
 * Settings says "the most recent download failed": after one that worked, that is no longer so.
 * Its history is the Statistics page's Downloader card.
 */
async function clearLastFailure(): Promise<void> {
  if (!getYtdlToolsState().lastFailure) return;
  await updateYtdlState((s) => {
    s.lastFailure = undefined;
  }).catch((err) => deps.log(`[Ytdl] could not clear the last failure: ${err instanceof Error ? err.message : String(err)}`));
}

async function downloadWithRetries(site: LinkSiteId, label: string, options: VideoDownloadOptions): Promise<YtdlpDownloadResult> {
  const { refreshBlocked, ...run } = options;
  let networkRetried = false;
  let updated = false;
  let refreshed = false;
  for (;;) {
    try {
      const result = await runYtdlpDownload({ ...run, label });
      await clearLastFailure();
      return result;
    } catch (err) {
      if (!(err instanceof YtdlError)) throw err;
      deps.log(`[Ytdl] ${label} download failed (${err.category}): ${err.stderrTail || err.message}`);
      // Recorded only if the retry fails too: a hiccup that healed is not "the last failure".
      if (err.category === 'network' && !networkRetried) {
        networkRetried = true;
        continue;
      }
      if (err.category === 'blocked' && refreshBlocked && !refreshed) {
        refreshed = true;
        if (await refreshBlocked(run.signal)) {
          deps.log(`[Ytdl] retrying ${label} after refreshing its page`);
          continue;
        }
      }
      if (err.category === SITE_CHANGED && !updated) {
        const check = await deps.checkUpdate({ force: true }).catch(() => ({ updated: false }) as YtdlUpdateResult);
        if (check.updated) {
          updated = true;
          deps.log(`[Ytdl] retrying with yt-dlp ${check.version ?? ''}`);
          continue;
        }
        // Copies the user installed are never updated by Yobi, so a pause would never lift.
        await recordFailure(site, SITE_CHANGED, getYtdlToolsState().status !== 'custom');
        throw err;
      }
      await recordFailure(site, err.category);
      throw err;
    }
  }
}

/**
 * Downloads one video of `site` into `jobDir` and checks it has both picture and sound. Throws
 * `YtdlError` (its category deciding the message) or, when `signal` aborts, an error named
 * AbortError. Refuses at once while that site waits for a newer yt-dlp.
 */
export async function downloadVideo(site: LinkSiteId, options: VideoDownloadOptions): Promise<YtdlpDownloadResult> {
  const label = siteLabel(site);
  const state = getYtdlToolsState();
  if (state.status !== 'ready' && state.status !== 'custom') throw new YtdlError('other', 'tools not ready');
  if (siteChangedAt(state, site)) {
    throw new YtdlError(SITE_CHANGED, `waiting for a yt-dlp that handles the latest ${label} change`);
  }
  return withDownloadSlot(label, options.signal, () => downloadWithRetries(site, label, options));
}
