import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { sendLog } from '../../helpers';
import { getLangCache, t } from '../../i18n';
import { createYtdlJobDir, removeYtdlJobDir } from '../../youtubeDownload';
import { safeVideoFileName } from '../../../shared/ytdl';
import type { YtdlDestination } from '../../../shared/ytdl';
import { siteLabel } from '../../../shared/linkSites/rows';
import { FlowUserError } from '../userError';
import { saveIntoFolder } from './savedDownloads';
import { buildSrt } from './srt';
import type { TimedSubtitles, VideoInfo } from './videoSiteTypes';

/*
 * The menu's "subtitles": an .srt Yobi builds from the video's timed captions (`srt.ts`), saved in
 * the downloads folder like every download (three days in Downloads/Yobi). No yt-dlp, so it works
 * while the download tools are missing or the site's downloads are paused; and no size cap — a
 * subtitle file is a few hundred KB at most.
 */

export interface SubtitlesTarget {
  /** The folder the step saves to (`downloadsFolder(config.folder)`). */
  folder: string;
  destination: YtdlDestination;
  /** Whether the reply may name the file's folder on this computer (`YtdlAccess.showPath`). */
  showPath: boolean;
}

/** The video's subtitles, or the `FlowUserError` saying why there are none. */
export async function readVideoSubtitles(info: VideoInfo, signal?: AbortSignal): Promise<TimedSubtitles> {
  const site = siteLabel(info.ref.site);
  if (!info.subtitles) {
    if (info.summaryNeedsSignIn) {
      throw new FlowUserError('flow.error.videoSubtitlesNeedSignIn', { site }, `${site} gives subtitles only to a signed-in account`);
    }
    throw new FlowUserError('flow.error.videoNoSubtitles', {}, `This ${site} video has no subtitles`);
  }
  return info.subtitles(signal);
}

/**
 * Writes the .srt (`Title.srt`, a number added when the name is taken) and gives back the
 * `youtube_download` envelope: `kind` "subtitles"; handed to the bot step only for Telegram (sent
 * as a document), saved and said so everywhere else.
 */
export async function saveSubtitles(info: VideoInfo, subtitles: TimedSubtitles, target: SubtitlesTarget): Promise<string> {
  const label = siteLabel(info.ref.site);
  const text = buildSrt(subtitles.cues);
  if (!text) throw new FlowUserError('flow.error.videoNoSubtitles', {}, `The ${label} subtitles (${subtitles.language}) have no words`);
  const fileName = safeVideoFileName(info.title, 'srt');
  const jobDir = await createYtdlJobDir();
  let finalPath: string;
  try {
    const written = path.join(jobDir, fileName);
    await fs.writeFile(written, text, 'utf8');
    finalPath = await saveIntoFolder(written, target.folder, fileName);
  } finally {
    await removeYtdlJobDir(jobDir).catch(() => {});
  }
  const sizeBytes = Buffer.byteLength(text, 'utf8');
  sendLog(`💬 [${label}] Saved ${finalPath} (${subtitles.language}${subtitles.auto ? ', automatic' : ''})`);
  const handedOver = target.destination === 'telegram';
  return JSON.stringify({
    output: finalPath,
    kind: 'subtitles',
    title: info.title,
    quality: 'srt',
    sizeMb: (sizeBytes / 1_000_000).toFixed(1),
    fileName: path.basename(finalPath),
    savedLocally: handedOver ? '0' : '1',
    summary: subtitlesSummary(info.title, finalPath, handedOver, target.showPath),
  });
}

function subtitlesSummary(title: string, filePath: string, handedOver: boolean, showPath: boolean): string {
  const strings = getLangCache();
  if (handedOver) return t(strings, 'ytdl.summary.subtitlesReady', { title });
  if (!showPath) return t(strings, 'ytdl.summary.subtitlesSavedNoPath');
  // As code, like a saved video's path: Markdown would read a Windows path's backslashes as escapes.
  const file = filePath.includes('`') ? filePath : `\`${filePath}\``;
  return t(strings, 'ytdl.summary.subtitlesSaved', { file });
}
