import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { errorText } from '../../shared/errorText';
import { clearSiteChanged } from '../../shared/linkSites/siteChanged';
import type { YtdlToolsState } from '../../shared/ytdl';
import { Mutex } from '../flow/lanes';
import { MANAGED_DIRS, VERSION_FILE, isInsideDir, ytdlToolsRoot } from './paths';
import { runningToolCount, withToolsIdle } from './processTree';
import { FFMPEG_VERSION } from './toolManifest';
import {
  adoptLegacyFolder, compareYtdlpVersions, fetchRelease, pruneLeftovers, replaceFolder, stageFfmpeg, stageYtdlp, withStaging,
  ytdlInstallerDeps,
} from './toolStage';
import type { InstalledYtdlp } from './toolState';
import { getYtdlToolsState, readYtdlState, setYtdlInstalling, setYtdlProgress, toolsPath, updateYtdlState } from './toolState';

export { selfTest, setYtdlInstallerDeps, ytdlInstallerDeps } from './toolStage';

/*
 * Installs and updates the managed tools: download → verify → unpack → self-test → switch.
 * Everything is staged in a hidden folder under the tools root and only swapped in for the tool's
 * fixed folder once it ran, while no tool runs; any failure before the swap leaves the previous
 * install exactly as it was.
 */

const UPDATE_CHECK_MIN_GAP_MS = 60 * 60_000;

/** Install, update, remove and custom paths never overlap. */
export const toolsLock = new Mutex();

/** Runs folder swaps once no download or other tool is running. */
async function swapWhenIdle(swap: () => Promise<void>): Promise<void> {
  if (runningToolCount() > 0) ytdlInstallerDeps().log('[Ytdl] waiting for running tools to finish before switching');
  await withToolsIdle(swap);
}

/** Swaps staged folders in for the fixed ones. */
function swapIn(folders: ReadonlyArray<{ staged: string; name: string }>): Promise<void> {
  return swapWhenIdle(async () => {
    for (const folder of folders) await replaceFolder(folder.staged, folder.name);
  });
}

/**
 * Moves an install from before the fixed folders (`yt-dlp/<version>/`, `ffmpeg/<version>/`) into
 * them: the version in use becomes the fixed folder, without downloading again, and every other
 * dated folder is deleted. Run at startup; does nothing once the folders are fixed.
 */
export function migrateLegacyToolFolders(): Promise<void> {
  return toolsLock.runExclusive(async () => {
    const state = await readYtdlState();
    const legacy: Array<{ name: string; keep: { dir: string; version: string } | null }> = [];
    for (const { name, record } of [{ name: MANAGED_DIRS.ytdlp, record: state.ytdlp }, { name: MANAGED_DIRS.ffmpeg, record: state.ffmpeg }]) {
      const parent = path.join(ytdlToolsRoot(), name);
      if (record?.dir === name || !existsSync(parent) || existsSync(path.join(parent, VERSION_FILE))) continue;
      const dir = record ? toolsPath(record.dir) : null;
      const inUse = record && dir && dir !== parent && isInsideDir(parent, dir) && existsSync(dir);
      legacy.push({ name, keep: inUse ? { dir, version: record.version } : null });
    }
    if (legacy.length === 0) return;
    await swapWhenIdle(async () => {
      for (const folder of legacy) await adoptLegacyFolder(folder.name, folder.keep);
    });
    // Writing takes the labelled folders' versions and points the records at them.
    await updateYtdlState(() => undefined);
    await pruneLeftovers();
    ytdlInstallerDeps().log(`[Ytdl] moved ${legacy.map((f) => f.name).join(', ')} into fixed folders`);
  });
}

async function runInstall(): Promise<YtdlToolsState> {
  const tools = ytdlInstallerDeps().tools();
  if (!tools) throw new Error(`no download tools for ${process.platform}-${process.arch}`);
  const before = await readYtdlState();
  const nightly = before.nightly === true;
  setYtdlInstalling(true);
  try {
    await withStaging(async (staging) => {
      const release = await fetchRelease(nightly);
      const ytdlp = await stageYtdlp(staging, tools, release);
      const ffmpegStaged = path.join(staging, 'ffmpeg');
      await stageFfmpeg(ffmpegStaged, tools);
      await swapIn([{ staged: ytdlp.dir, name: MANAGED_DIRS.ytdlp }, { staged: ffmpegStaged, name: MANAGED_DIRS.ffmpeg }]);
      const installed: InstalledYtdlp = { version: release.version, nightly, dir: MANAGED_DIRS.ytdlp, exe: ytdlp.exe };
      await updateYtdlState((s) => {
        if (s.ytdlp?.version !== installed.version) clearSiteChanged(s);
        s.ytdlp = installed;
        s.ffmpeg = { version: FFMPEG_VERSION, dir: MANAGED_DIRS.ffmpeg };
        s.testedOk = true;
        s.installError = undefined;
      });
      ytdlInstallerDeps().log(`[Ytdl] installed yt-dlp ${release.version}${nightly ? ' (nightly)' : ''} and FFmpeg ${FFMPEG_VERSION}`);
    });
  } catch (err) {
    ytdlInstallerDeps().log(`[Ytdl] install failed: ${errorText(err)}`);
    await updateYtdlState((s) => {
      s.installError = errorText(err);
    }).catch(() => undefined);
    throw err;
  } finally {
    await pruneLeftovers();
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
      await swapIn([{ staged: staged.dir, name: MANAGED_DIRS.ytdlp }]);
      return { version: release.version, nightly, dir: MANAGED_DIRS.ytdlp, exe: staged.exe } satisfies InstalledYtdlp;
    });
    await updateYtdlState((s) => {
      s.ytdlp = installed;
      clearSiteChanged(s);
      s.lastCheckedAt = checkedAt;
      s.installError = undefined;
    });
    ytdlInstallerDeps().log(`[Ytdl] updated yt-dlp ${active.version} → ${installed.version}`);
    return { updated: true, version: installed.version };
  } catch (err) {
    ytdlInstallerDeps().log(`[Ytdl] update check failed: ${errorText(err)}`);
    await updateYtdlState((s) => {
      s.lastCheckedAt = checkedAt;
      s.installError = errorText(err);
    }).catch(() => undefined);
    throw err;
  } finally {
    await pruneLeftovers();
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
