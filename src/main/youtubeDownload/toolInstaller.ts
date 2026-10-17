import * as path from 'node:path';
import { errorText } from '../../shared/errorText';
import { clearSiteChanged } from '../../shared/linkSites/siteChanged';
import type { YtdlToolsState } from '../../shared/ytdl';
import { Mutex } from '../flow/lanes';
import { ytdlToolsRoot } from './paths';
import { FFMPEG_VERSION } from './toolManifest';
import {
  compareYtdlpVersions, fetchRelease, promote, pruneVersions, relativeToRoot, stageFfmpeg, stageYtdlp,
  withStaging, ytdlInstallerDeps,
} from './toolStage';
import type { InstalledYtdlp, PersistedYtdlState } from './toolState';
import { getYtdlToolsState, readYtdlState, setYtdlInstalling, setYtdlProgress, updateYtdlState } from './toolState';

export { selfTest, setYtdlInstallerDeps, ytdlInstallerDeps } from './toolStage';

/*
 * Installs and updates the managed tools: download → verify → unpack → self-test → switch.
 * Everything is staged in a hidden folder under the tools root and only renamed into place once
 * it ran; the active version in state.json changes last, so any failure leaves the previous
 * install exactly as it was.
 */

const UPDATE_CHECK_MIN_GAP_MS = 60 * 60_000;

/** Install, update, remove and custom paths never overlap. */
export const toolsLock = new Mutex();

async function runInstall(): Promise<YtdlToolsState> {
  const tools = ytdlInstallerDeps().tools();
  if (!tools) throw new Error(`no download tools for ${process.platform}-${process.arch}`);
  const before = await readYtdlState();
  const nightly = before.nightly === true;
  setYtdlInstalling(true);
  try {
    const next = await withStaging(async (staging) => {
      const release = await fetchRelease(nightly);
      const ytdlp = await stageYtdlp(staging, tools, release);
      const ffmpegStaged = path.join(staging, 'ffmpeg');
      await stageFfmpeg(ffmpegStaged, tools);
      const ytdlpDir = await promote(ytdlp.dir, path.join(ytdlToolsRoot(), 'yt-dlp'), release.version);
      const ffmpegDir = await promote(ffmpegStaged, path.join(ytdlToolsRoot(), 'ffmpeg'), FFMPEG_VERSION);
      const installed: InstalledYtdlp = { version: release.version, nightly, dir: relativeToRoot(ytdlpDir), exe: ytdlp.exe };
      let saved: PersistedYtdlState = {};
      await updateYtdlState((s) => {
        if (s.ytdlp && s.ytdlp.dir !== installed.dir) s.previousYtdlp = s.ytdlp;
        if (s.ytdlp?.version !== installed.version) clearSiteChanged(s);
        s.ytdlp = installed;
        s.ffmpeg = { version: FFMPEG_VERSION, dir: relativeToRoot(ffmpegDir) };
        s.testedOk = true;
        s.installError = undefined;
        saved = structuredClone(s);
      });
      ytdlInstallerDeps().log(`[Ytdl] installed yt-dlp ${release.version}${nightly ? ' (nightly)' : ''} and FFmpeg ${FFMPEG_VERSION}`);
      return saved;
    });
    await pruneVersions(next);
  } catch (err) {
    ytdlInstallerDeps().log(`[Ytdl] install failed: ${errorText(err)}`);
    await updateYtdlState((s) => {
      s.installError = errorText(err);
    }).catch(() => undefined);
    await pruneVersions(await readYtdlState());
    throw err;
  } finally {
    setYtdlInstalling(false);
  }
  return getYtdlToolsState();
}

let installRun: Promise<YtdlToolsState> | null = null;

/** Downloads, verifies and switches to a full set of tools. Concurrent callers share one run. */
export function installYtdlTools(): Promise<YtdlToolsState> {
  installRun ??= toolsLock.runExclusive(runInstall).finally(() => {
    installRun = null;
  });
  return installRun;
}

export interface YtdlUpdateResult {
  updated: boolean;
  version?: string;
}

async function runUpdate(force: boolean): Promise<YtdlUpdateResult> {
  const state = await readYtdlState();
  const active = state.ytdlp;
  const tools = ytdlInstallerDeps().tools();
  if (state.customPaths || !active || !state.testedOk || !tools) return { updated: false };
  const last = Date.parse(state.lastCheckedAt ?? '');
  if (!force && Number.isFinite(last) && Date.now() - last < UPDATE_CHECK_MIN_GAP_MS) return { updated: false, version: active.version };
  const nightly = state.nightly === true;
  const checkedAt = new Date().toISOString();
  try {
    const release = await fetchRelease(nightly);
    if (active.nightly === nightly && compareYtdlpVersions(release.version, active.version) <= 0) {
      await updateYtdlState((s) => {
        s.lastCheckedAt = checkedAt;
        s.installError = undefined;
      });
      return { updated: false, version: active.version };
    }
    const installed = await withStaging(async (staging) => {
      const staged = await stageYtdlp(staging, tools, release);
      const dir = await promote(staged.dir, path.join(ytdlToolsRoot(), 'yt-dlp'), release.version);
      return { version: release.version, nightly, dir: relativeToRoot(dir), exe: staged.exe } satisfies InstalledYtdlp;
    });
    await updateYtdlState((s) => {
      if (s.ytdlp && s.ytdlp.dir !== installed.dir) s.previousYtdlp = s.ytdlp;
      s.ytdlp = installed;
      clearSiteChanged(s);
      s.lastCheckedAt = checkedAt;
      s.installError = undefined;
    });
    ytdlInstallerDeps().log(`[Ytdl] updated yt-dlp ${active.version} → ${installed.version}`);
    await pruneVersions(await readYtdlState());
    return { updated: true, version: installed.version };
  } catch (err) {
    ytdlInstallerDeps().log(`[Ytdl] update check failed: ${errorText(err)}`);
    await updateYtdlState((s) => {
      s.lastCheckedAt = checkedAt;
      s.installError = errorText(err);
    }).catch(() => undefined);
    throw err;
  } finally {
    setYtdlProgress(undefined);
  }
}

let updateRun: Promise<YtdlUpdateResult> | null = null;

/**
 * Managed tools only: installs a newer yt-dlp (or the other channel's, after the nightly switch)
 * and makes it active. Without `force`, does nothing when the last check was under an hour ago.
 */
export function checkYtdlUpdate(options: { force?: boolean } = {}): Promise<YtdlUpdateResult> {
  updateRun ??= toolsLock.runExclusive(() => runUpdate(options.force === true)).finally(() => {
    updateRun = null;
  });
  return updateRun;
}
