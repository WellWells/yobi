import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { sendLog } from '../../helpers';
import {
  AudioExtractError,
  cleanupYtdlJobs,
  createYtdlJobDir,
  extractMp3,
  getYtdlToolsState,
  probeMedia,
  removeYtdlJobDir,
} from '../../youtubeDownload';
import type { Mp3Tags } from '../../youtubeDownload';
import { isCachedDownload, recordDownloads } from '../../downloadsCache';
import { photoUrl, xPostMessage } from '../../../shared/xMedia';
import type { XMediaInput } from '../../../shared/xMedia';
import { MP3_BITRATE_KBPS, exceedsLimit, formatLimit, formatMegabytes, mp3Choice } from '../../../shared/ytdl';
import type { SizeLimit, YtdlDestination } from '../../../shared/ytdl';
import { telegramSendLimitBytes } from '../../telegram/largeUpload';
import { FlowUserError } from '../userError';
import { saveIntoFolder } from './savedDownloads';
import { postFileStem, readLinkedThread, siteName } from './postReader';
import { readAccessOf } from './readAccess';
import { chooseVariant, downloadTo, fetchVariantTo, mediaFileName, saveFolder } from './postMediaFetch';
import { resolveYtdlDestination, savedSummary as savedFileSummary } from './ytdl';
import { downloadLimitBytes, overCap, ytdlAccessFor } from './ytdlAccess';
import type { XMedia, XPost } from './xPosts';
import { formatPostTime } from './xReader';

/*
 * A post's videos as MP3s (the "MP3" button under a forwarded X, Threads, Instagram, Facebook or
 * TikTok post): FFmpeg takes the sound out of the mp4 Yobi already fetches for
 * the forward — no yt-dlp. The mp4 the forward left in Downloads/Yobi is used again while it is
 * there; otherwise the site's own reader gives it anew. The MP3 goes out as a video row's does
 * (the bitrate a Telegram chat or this computer gets, Telegram's music player, the limit a bot
 * user may download), one per video in the post.
 */

/** A video with sound to take: an X GIF is a silent mp4, never offered. */
function isSoundVideo(item: XMedia): boolean {
  return item.kind === 'video';
}

/** Whether a post has a video whose sound can become an MP3: the forward offers "MP3" only then. */
export function postHasSound(media: readonly XMedia[]): boolean {
  return media.some(isSoundVideo);
}

/** FFmpeg comes with the download tools; without them, the same notice as a video's download. */
function requireFfmpeg(): void {
  const { status } = getYtdlToolsState();
  if (status === 'ready' || status === 'custom') return;
  throw new FlowUserError('flow.error.ytdlToolsMissing', {}, 'The download tools (FFmpeg) are not installed');
}

function noSound(): FlowUserError {
  return new FlowUserError('flow.error.xMediaNoSound', {}, 'This post has no video with sound to make an MP3 of');
}

function overCapError(sizeBytes: number, limitBytes: SizeLimit): FlowUserError {
  const size = formatMegabytes(sizeBytes);
  const limit = formatLimit(limitBytes ?? 0);
  return new FlowUserError('flow.error.mp3OverCap', { size, limit }, `The MP3 is about ${size}, over the ${limit} this bot user may download`);
}

/** What the player shows: the post's first line (or its file name) by whoever posted it. */
export function postMp3Tags(post: Pick<XPost, 'text' | 'name' | 'author'>, site: string, stem: string): Mp3Tags {
  const firstLine = post.text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '';
  return { title: firstLine || stem, artist: post.name || (post.author ? `@${post.author}` : site) };
}

interface Mp3Job {
  site: string;
  stem: string;
  /** The item's place among the post's media, and how many there are: what its file is named by. */
  index: number;
  count: number;
  /** Where the forward saved the post's files, and where the MP3s go. */
  folder: string;
  jobDir: string;
  bitrateKbps: number;
  tags: Mp3Tags;
}

interface MadeMp3 {
  file: string;
  sizeBytes: number;
  /** Already in Downloads/Yobi from an earlier press: used as it is. */
  reused: boolean;
}

/** The video's mp4: the forward's copy in Downloads/Yobi while it is there, else its best version fetched now. */
async function videoFile(item: XMedia, job: Mp3Job, signal: AbortSignal | undefined): Promise<string> {
  const name = mediaFileName(job.stem, job.index, job.count, '.mp4');
  const cached = path.join(job.folder, name);
  if (await isCachedDownload(cached)) {
    sendLog(`♻️ [${job.site}] Using the downloaded ${cached} for the MP3`);
    return cached;
  }
  // Only the sound is kept, so the best version: its sound is the best the site has.
  const best = await chooseVariant(item, 'local', signal);
  const file = path.join(job.jobDir, name);
  const bytes = await fetchVariantTo(best, file, null, signal);
  sendLog(`⬇️ [${job.site}] video ${best.height}p ${formatMegabytes(bytes)} for the MP3`);
  return file;
}

/** The cover for the MP3, best effort: the video's poster, or nothing. */
async function coverFile(item: XMedia, job: Mp3Job, signal: AbortSignal | undefined): Promise<string> {
  const url = item.image ? photoUrl(item, 'medium') : '';
  if (!url.startsWith('https://')) return '';
  const file = path.join(job.jobDir, `cover-${job.index + 1}`);
  try {
    await downloadTo(url, file, 10_000_000, signal);
    return file;
  } catch (err) {
    if (signal?.aborted) throw err;
    sendLog(`⚠️ [${job.site}] No cover for the MP3: ${err instanceof Error ? err.message : String(err)}`);
    return '';
  }
}

/** One video's MP3 in the job folder (or the one already saved); null when the video has no sound. */
async function mp3Of(item: XMedia, job: Mp3Job, signal: AbortSignal | undefined): Promise<MadeMp3 | null> {
  const name = mediaFileName(job.stem, job.index, job.count, '.mp3');
  const saved = path.join(job.folder, name);
  if (await isCachedDownload(saved)) {
    sendLog(`♻️ [${job.site}] Reusing ${saved} — already made`);
    return { file: saved, sizeBytes: (await fs.stat(saved)).size, reused: true };
  }
  const video = await videoFile(item, job, signal);
  const probe = await probeMedia(video).catch(() => null);
  if (probe && !probe.hasAudio) {
    sendLog(`🔇 [${job.site}] Video ${job.index + 1} has no sound — no MP3 of it`);
    return null;
  }
  const cover = await coverFile(item, job, signal);
  const out = path.join(job.jobDir, name);
  await extractMp3(video, out, job.bitrateKbps, { ...job.tags, ...(cover ? { cover } : {}) }, signal).catch((err: unknown) => {
    if (!(err instanceof AudioExtractError)) throw err;
    throw new FlowUserError('flow.error.xMediaMp3Failed', {}, `FFmpeg could not make the MP3: ${err.message}`);
  });
  const sizeBytes = (await fs.stat(out)).size;
  sendLog(`🎵 [${job.site}] MP3 ${job.bitrateKbps} kbps ${formatMegabytes(sizeBytes)} → ${name}`);
  return { file: out, sizeBytes, reused: false };
}

/** Where the MP3s went, when they were not handed to a bot step: the computer, or too large for Telegram. */
function savedSummary(files: readonly string[], sizes: readonly number[], destination: YtdlDestination, showPath: boolean): string {
  const tooLarge = destination === 'telegram';
  const sizeBytes = tooLarge ? Math.max(...sizes) : sizes.reduce((sum, n) => sum + n, 0);
  return savedFileSummary({ filePath: files.length === 1 ? files[0] : path.dirname(files[0]), sizeBytes }, destination, showPath);
}

/**
 * The post's videos as MP3s in Downloads/Yobi, enveloped as `x_media`'s output: the files one per
 * line, `kind` audio, the caption (who and the link — the post itself was just forwarded) and,
 * when they stay on this computer, `savedLocally` with where. A capped bot user gets nothing over
 * their limit, told before anything is fetched when the length already says so.
 */
export async function postAudio(input: XMediaInput, config: Record<string, string>, signal: AbortSignal | undefined): Promise<string> {
  requireFfmpeg();
  const site = siteName(input.source);
  const destination = resolveYtdlDestination(config.destination, config.__triggerPlatform);
  const access = await ytdlAccessFor(config);
  const limit = downloadLimitBytes(access, destination);
  const { focal: post } = await readLinkedThread(input, 'media', signal, readAccessOf(config));
  // A post that only quotes a video: the video it quotes is what the person wants.
  const media = post.media.length > 0 ? post.media : post.quoteMedia;
  const videos = media.flatMap((item, index) => (isSoundVideo(item) ? [{ item, index }] : []));
  if (videos.length === 0) throw noSound();
  if (access.capped) {
    for (const { item } of videos) {
      const estimate = mp3Choice(item.durationMs / 1000, destination);
      if (exceedsLimit(estimate, limit)) throw overCapError(estimate.sizeBytes ?? 0, limit);
    }
  }
  sendLog(`🎵 [${site}] MP3 of ${input.id}: ${videos.length} video(s) → ${destination}`);
  const stem = postFileStem(input.source, post);
  const folder = saveFolder(input, post, media.length, config.folder);
  const tags = postMp3Tags(post, site, stem);

  void cleanupYtdlJobs().catch(() => {});
  const jobDir = await createYtdlJobDir();
  try {
    const made: MadeMp3[] = [];
    for (const { item, index } of videos) {
      const job: Mp3Job = { site, stem, index, count: media.length, folder, jobDir, bitrateKbps: MP3_BITRATE_KBPS[destination], tags };
      const one = await mp3Of(item, job, signal);
      if (one) made.push(one);
    }
    if (made.length === 0) throw noSound();
    const sizes = made.map((m) => m.sizeBytes);
    const largest = Math.max(...sizes);
    if (overCap(largest, access, limit)) throw overCapError(largest, limit);
    const files: string[] = [];
    for (const one of made) {
      if (one.reused) {
        // Used again: its time in Downloads/Yobi starts over, as a reused video download's does.
        await recordDownloads([one.file]).catch(() => {});
        files.push(one.file);
      } else {
        files.push(await saveIntoFolder(one.file, folder, path.basename(one.file)));
      }
    }
    sendLog(`💾 [${site}] ${files.length} MP3(s) in ${folder}`);
    const handedOver = destination === 'telegram' && largest <= telegramSendLimitBytes();
    const caption = xPostMessage({ name: post.name, author: post.author, text: '', link: post.link });
    return JSON.stringify({
      // One per line: a bot step sends several as one album of audio files.
      output: files.join('\n'),
      previews: '',
      count: String(files.length),
      kind: 'audio',
      title: tags.title,
      message: caption,
      caption,
      overflow: '',
      text: post.text,
      author: post.author ? `@${post.author}` : '',
      name: post.name,
      date: formatPostTime(post.createdAt),
      link: post.link,
      prompt: '',
      videoText: '',
      savedLocally: handedOver ? '0' : '1',
      chatMedia: '',
      summary: handedOver ? '' : savedSummary(files, sizes, destination, access.showPath),
      notice: '',
      analyze: '',
      mp3: '',
      buttons: '',
      buttonImages: '',
    });
  } finally {
    await removeYtdlJobDir(jobDir).catch(() => {});
  }
}
