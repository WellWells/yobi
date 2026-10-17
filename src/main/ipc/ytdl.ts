import { ipcMain } from 'electron';
import { IPC } from '../../shared/types';
import type { YtdlToolsState } from '../../shared/ytdl';
import { isDownloadsKeep, normalizeDownloadsKeep } from '../../shared/downloads';
import type { DownloadsKeep } from '../../shared/downloads';
import { errorText } from '../../shared/errorText';
import { config, saveConfig } from '../config';
import { sendLog, sendToRenderer } from '../helpers';
import {
  checkYtdlUpdate,
  getYtdlToolsState,
  installYtdlTools,
  onYtdlToolsState,
  removeYtdlTools,
  setYtdlCustomPaths,
  setYtdlNightly,
} from '../youtubeDownload';

const MAX_PATH_CHARS = 1_024;

/** A custom-path request from the settings page, or `null` (clear). Anything else is refused. */
export function parseCustomPaths(raw: unknown): { ytdlp: string; ffmpegDir: string } | null | undefined {
  if (raw === null) return null;
  if (!raw || typeof raw !== 'object') return undefined;
  const { ytdlp, ffmpegDir } = raw as Record<string, unknown>;
  if (typeof ytdlp !== 'string' || typeof ffmpegDir !== 'string') return undefined;
  const a = ytdlp.trim();
  const b = ffmpegDir.trim();
  if (!a || !b || a.length > MAX_PATH_CHARS || b.length > MAX_PATH_CHARS) return undefined;
  return { ytdlp: a, ffmpegDir: b };
}

/** Stores a valid choice for how long Downloads/Yobi keeps files; returns the one in force. */
export function setDownloadsKeep(raw: unknown): DownloadsKeep {
  if (isDownloadsKeep(raw)) saveConfig({ downloadsKeep: raw });
  return normalizeDownloadsKeep(config.downloadsKeep);
}

/**
 * The download tools are managed only from this computer's own window: nothing a bot message or
 * a flow step sends reaches these handlers, so no chat can install a program or point Yobi at one.
 */
export function registerYtdlHandlers(): void {
  onYtdlToolsState((state: YtdlToolsState) => sendToRenderer(IPC.YTDL_TOOLS_STATE, state));

  ipcMain.handle(IPC.YTDL_TOOLS_GET, () => getYtdlToolsState());

  ipcMain.handle(IPC.YTDL_TOOLS_INSTALL, async () => {
    try {
      return await installYtdlTools();
    } catch (err) {
      sendLog(`❌ [YouTube] Installing the download tools failed: ${errorText(err)}`);
      return getYtdlToolsState();
    }
  });

  ipcMain.handle(IPC.YTDL_TOOLS_CHECK_UPDATE, async () => {
    try {
      await checkYtdlUpdate({ force: true });
    } catch (err) {
      sendLog(`⚠️ [YouTube] Checking for a yt-dlp update failed: ${errorText(err)}`);
    }
    return getYtdlToolsState();
  });

  ipcMain.handle(IPC.YTDL_TOOLS_REMOVE, async () => {
    try {
      await removeYtdlTools();
    } catch (err) {
      sendLog(`⚠️ [YouTube] Removing the download tools failed: ${errorText(err)}`);
    }
    return getYtdlToolsState();
  });

  ipcMain.handle(IPC.YTDL_TOOLS_SET_CUSTOM, async (_event, raw: unknown) => {
    const paths = parseCustomPaths(raw);
    if (paths === undefined) return getYtdlToolsState();
    try {
      await setYtdlCustomPaths(paths);
    } catch (err) {
      sendLog(`⚠️ [YouTube] The custom tool paths did not work: ${errorText(err)}`);
    }
    return getYtdlToolsState();
  });

  ipcMain.handle(IPC.YTDL_TOOLS_SET_NIGHTLY, async (_event, on: unknown) => {
    if (typeof on !== 'boolean') return getYtdlToolsState();
    try {
      await setYtdlNightly(on);
    } catch (err) {
      sendLog(`⚠️ [YouTube] Switching the yt-dlp channel failed: ${errorText(err)}`);
    }
    return getYtdlToolsState();
  });

  ipcMain.handle(IPC.DOWNLOADS_KEEP_GET, () => normalizeDownloadsKeep(config.downloadsKeep));
  ipcMain.handle(IPC.DOWNLOADS_KEEP_SET, (_event, raw: unknown) => setDownloadsKeep(raw));
}
