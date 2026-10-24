import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { sendLog } from '../../helpers';
import { getLangCache, t } from '../../i18n';
import {
  YtdlError,
  cleanupYtdlJobs,
  createYtdlJobDir,
  findYtdlJob,
  getYtdlToolsState,
  removeYtdlJobDir,
  writeYtdlJobRecord,
} from '../../youtubeDownload';
import type { YtdlJobRecord } from '../../youtubeDownload';
import { largeUploadReady, telegramSendLimitBytes } from '../../telegram/largeUpload';
import {
  DOWNLOAD_MENU,
  buildVideoEntryButtons,
  buildYtdlButtons,
  createYtdlProgress,
  exceedsLimit,
  formatDuration,
  formatFlowButtons,
  formatLimit,
  formatMegabytes,
  mp3Choice,
  parseQualityToken,
  parseVideoInput,
  previewQuality,
  safeVideoFileName,
  ytdlDownloadReady,
  ytdlSizeList,
} from '../../../shared/ytdl';
import type {
  DownloadKind, SizeLimit, YtdlChoice, YtdlDestination, YtdlFailureCategory, YtdlMenuLabels, YtdlPick, YtdlProgressSample,
} from '../../../shared/ytdl';
import { matchVideoRef, siteLabel, videoHasSubtitles, videoHasSummary, videoIsAudioOnly } from '../../../shared/linkSites/rows';
import { siteChangedAt } from '../../../shared/linkSites/siteChanged';
import type { StepProgress } from '../../../shared/stepProgress';
import { SPACE_FACTOR, fetchLimitFor, freeDiskBytes, streamCapBytes } from '../../downloader/fetchLimits';
import { StreamTooLargeError } from '../../downloader/streamTypes';
import { countDownload, countDownloadFailure } from '../../downloader/usage';
import { FlowUserError } from '../userError';
import { downloadsFolder } from './fileOps';
import { readAccessOf } from './readAccess';
import { saveIntoFolder } from './savedDownloads';
import { VIDEO_SITES, downloadSiteVideo } from './videoSites';
import type { VideoInfo } from './videoSites';
import { PLAYLIST_KIND } from '../../../shared/linkSites/types';
import type { VideoRef, VideoSiteId } from '../../../shared/linkSites/types';
import { choicesWithinCap, downloadLimitBytes, menuChoicesWithinCap, overCap, ytdlAccessFor } from './ytdlAccess';
import type { YtdlAccess } from './ytdlAccess';
import { readVideoSubtitles, saveSubtitles } from './ytdlSubtitles';

/** `auto` follows whoever started the run: a Telegram command gets Telegram, anything else this computer. */
export function resolveYtdlDestination(raw: string | undefined, triggerPlatform: string | undefined): YtdlDestination {
  const choice = (raw ?? '').trim().toLowerCase();
  if (choice === 'telegram' || choice === 'local') return choice;
  return (triggerPlatform ?? '').trim().toLowerCase() === 'telegram' ? 'telegram' : 'local';
}

function failedEnvelope(): string {
  return JSON.stringify({
    output: '', url: '', videoId: '', title: '', channel: '', duration: '', image: '', quality: '',
    download: '', buttons: '', available: '', downloadReady: '0', notice: '', isFailed: '1',
  });
}

/*
 * Both skills take a link of any video row (`parseVideoInput`, `matchVideoRef`) and do everything
 * site-specific through that site's adapter (`VIDEO_SITES`): its info, its summary, its download.
 * The skills keep YouTube's names, which users' flows store.
 */

/** How long a read may run before the chat is told it is still reading; fast reads report nothing. */
export const READING_NOTICE_MS = 3_000;

/**
 * The video through its site's adapter; `signal` (the step's Stop) reaches the read. A read still
 * going after `READING_NOTICE_MS` reports a `reading` phase, so a slow page does not look like a
 * paste that did nothing. `config` is the step's: whether the run may use a sign-in (`readAccessOf`).
 */
async function readVideo(
  ref: VideoRef,
  config: Readonly<Record<string, string>>,
  signal?: AbortSignal,
  onProgress?: (progress: StepProgress) => void,
): Promise<VideoInfo> {
  if (isPlaylist(ref)) throw playlistRefused(ref.site);
  const { signIn } = readAccessOf(config);
  return withReadingNotice(ref.site, onProgress, () => VIDEO_SITES[ref.site].info(ref, signal, { signIn }));
}

/** A link to a whole playlist or collection (`PLAYLIST_KIND`), which the rows take only to turn away. */
function isPlaylist(ref: VideoRef | undefined): boolean {
  return ref?.kind === PLAYLIST_KIND;
}

/** The answer to a playlist link: downloads go one video at a time; nothing is read. */
function playlistRefused(site: VideoSiteId): FlowUserError {
  const label = siteLabel(site);
  return new FlowUserError('flow.error.videoPlaylist', { site: label }, `The link is a ${label} playlist; downloads take one video at a time`);
}

/** Runs a read of `site`'s pages, reporting `reading` once if it is still going after `READING_NOTICE_MS`. */
async function withReadingNotice<T>(
  site: VideoSiteId,
  onProgress: ((progress: StepProgress) => void) | undefined,
  read: () => Promise<T>,
): Promise<T> {
  const notice = onProgress
    ? setTimeout(() => onProgress(phaseOnly('reading', siteLabel(site))), READING_NOTICE_MS)
    : undefined;
  try {
    return await read();
  } finally {
    clearTimeout(notice);
  }
}

function qualityList(choices: readonly YtdlChoice[]): string {
  return choices.map((c) => c.label).join(', ');
}

/** A capped bot user asked for more than their limit: name the limit and the qualities that fit, if any. */
function overCapError(label: string | null, sizeBytes: number | null, allowed: readonly YtdlChoice[], limitBytes: SizeLimit): FlowUserError {
  const limit = formatLimit(limitBytes ?? 0);
  if (label === null || sizeBytes === null || allowed.length === 0) {
    return new FlowUserError('flow.error.ytdlOverCapNone', { limit }, `No quality of this video fits the ${limit} this bot user may download`);
  }
  const size = formatMegabytes(sizeBytes);
  const available = qualityList(allowed);
  return new FlowUserError(
    'flow.error.ytdlOverCap',
    { quality: label, size, available, limit },
    `${label} is about ${size}, over the ${limit} this bot user may download (fits: ${available})`,
  );
}

/**
 * Under the menu: what the person should know about this site's downloads right now. `offers`
 * says whether this video's menu has "summary" (`VideoInfo.summary`) and "subtitles"
 * (`VideoInfo.subtitles`); `needsSignIn` that it has neither only because the read was signed out
 * (`VideoInfo.summaryNeedsSignIn`); `hiddenOverCap` the person's limit when it left choices out, else null.
 * `scope` says when the link holds more than this one video: opened inside a playlist
 * (`VideoRef.inList`), or one part of several (`VideoInfo.part`) — only this one is downloaded.
 */
function menuNotice(
  site: VideoSiteId,
  offers: { summary: boolean; subtitles: boolean; needsSignIn: boolean },
  downloadReady: boolean,
  hint: string,
  hiddenOverCap: SizeLimit,
  scope: { inList: boolean; part?: VideoInfo['part'] },
): string {
  const strings = getLangCache();
  const lines: string[] = [];
  if (scope.inList) lines.push(t(strings, 'ytdl.notice.playlistOne'));
  if (scope.part) lines.push(t(strings, 'ytdl.notice.part', { part: String(scope.part.index), total: String(scope.part.total) }));
  if (hint === 'ambiguous2k') lines.push(t(strings, 'ytdl.notice.ambiguous2k'));
  if (offers.needsSignIn) lines.push(t(strings, 'ytdl.notice.summaryNeedsSignIn', { site: siteLabel(site) }));
  if (downloadReady && hiddenOverCap !== null) lines.push(t(strings, 'ytdl.notice.overCap', { limit: formatLimit(hiddenOverCap) }));
  if (!downloadReady) {
    lines.push(siteChangedAt(getYtdlToolsState(), site)
      ? t(strings, 'ytdl.notice.youtubeChanged', { site: siteLabel(site) })
      : t(strings, 'ytdl.notice.toolsMissing'));
    // Only "summary" and the subtitles need no download tools: say which of them still work.
    if (offers.summary) {
      lines.push(t(strings, offers.subtitles ? 'ytdl.notice.summaryAndSubtitlesStillWork' : 'ytdl.notice.summaryStillWorks'));
    } else if (offers.subtitles) {
      lines.push(t(strings, 'ytdl.notice.subtitlesStillWork'));
    }
  }
  return lines.join('\n');
}

/**
 * A Stop is never turned into a failed envelope: a stopped read ends the run, as a post read does.
 * A link that cannot be read counts as a failed download; a menu shown counts nothing, the
 * download it offers does.
 */
export async function execYoutubeInfo(
  config: Record<string, string>,
  signal?: AbortSignal,
  onProgress?: (progress: StepProgress) => void,
): Promise<string> {
  const failSoft = config.emitFailFlag === 'true';
  try {
    return await youtubeInfo(config, signal, briefly(config, onProgress));
  } catch (err) {
    const ref = parseVideoInput(config.input ?? '')?.ref;
    const site = ref?.site;
    // A playlist turned away is the person's link, not a failed download.
    if (!isPlaylist(ref)) countDownloadFailure(site, err, signal);
    if (!failSoft || signal?.aborted) throw err;
    sendLog(`⚠️ [${site ? siteLabel(site) : 'Video'}] ${err instanceof Error ? err.message : String(err)}`);
    return failedEnvelope();
  }
}

async function youtubeInfo(
  config: Record<string, string>,
  signal: AbortSignal | undefined,
  onProgress: ((progress: StepProgress) => void) | undefined,
): Promise<string> {
  const input = parseVideoInput(config.input ?? '');
  if (!input) {
    throw new FlowUserError('flow.error.ytdlNotYoutube', {}, 'The input has no YouTube video link');
  }
  const info = await readVideo(input.ref, config, signal, onProgress);
  const site = info.ref.site;
  const url = info.ref.url;
  const destination = resolveYtdlDestination(config.destination, config.__triggerPlatform);
  const access = await ytdlAccessFor(config);
  // The most this person gets here: a capped person sees nothing over it; anyone else sees it
  // marked as saved to the computer only.
  const limit = downloadLimitBytes(access, destination);
  // Every quality, under 360p too: the menu falls back to those, the notice counts them all.
  const allChoices = info.choices(destination, true, limit);
  const choices = menuChoicesWithinCap(info.choices(destination, false, limit), allChoices, access, limit);
  const mp3 = mp3Choice(info.durationS, destination);
  // A capped person's menu offers the MP3 only when it fits, as it does each quality.
  const audio = access.capped && exceedsLimit(mp3, limit) ? null : mp3;
  const downloadReady = ytdlDownloadReady(getYtdlToolsState(), site);
  const strings = getLangCache();
  const duration = formatDuration(info.durationS);
  // The row says the site can sum up at all; this read says whether this video can now.
  const summary = videoHasSummary(site) && info.summary;
  const subtitles = videoHasSubtitles(site) && info.subtitles !== undefined;
  // A link alone: a Telegram user with the preview grant gets a short video at a low quality first.
  const preview = !input.quality && access.preview && destination === 'telegram' && downloadReady && !videoIsAudioOnly(site)
    ? previewQuality(allChoices, info.durationS, limit)
    : null;
  const menu = menuStage(input.quality, summary || preview !== null);
  // A bot chat's menu: short buttons on two rows, the sizes in its text.
  const compact = config.__triggerPlatform === 'telegram' || config.__triggerPlatform === 'line';
  const labels: YtdlMenuLabels = {
    ...(subtitles ? { subtitles: t(strings, compact ? 'ytdl.menu.subtitlesShort' : 'ytdl.menu.subtitles') } : {}),
    size: t(strings, 'ytdl.menu.size'),
    sizeSavedOnly: t(strings, 'ytdl.menu.sizeSavedOnly'),
    unknownSize: t(strings, 'ytdl.menu.unknownSize'),
  };
  // The download menu has something only with the tools, or with subtitles that need none.
  const downloads = downloadReady || subtitles;
  const buttons = menu === 'entry'
    ? buildVideoEntryButtons(url, {
      ...(summary ? { analyze: t(strings, 'ytdl.menu.analyze') } : {}),
      ...(downloads ? { download: t(strings, 'ytdl.menu.download') } : {}),
    })
    : buildYtdlButtons(url, choices, limit, labels, downloadReady, audio, compact);
  // An audio-only site's menu is the MP3 alone: its size still needs the line.
  const sizedAudio = downloadReady ? audio : null;
  const qualityLine = menu === 'entry'
    ? ''
    : compact
      ? (choices.length > 0 || sizedAudio ? t(strings, 'ytdl.info.sizes', { list: ytdlSizeList(choices, sizedAudio, limit, labels) }) : '')
      : (choices.length > 0 ? t(strings, 'ytdl.info.qualities', { list: qualityList(choices) }) : '');
  const byline = [info.channel, duration].filter(Boolean).join(' · ');
  // Said once, under the link's first answer.
  const needsSignIn = !input.quality && videoHasSummary(site) && info.summaryNeedsSignIn === true;
  const hidden = choicesWithinCap(allChoices, access, limit).length < allChoices.length || audio === null;
  const notice = menuNotice(
    // "Summary still works" only where its button is: the first menu.
    site, { summary: summary && menu === 'entry', subtitles, needsSignIn }, downloadReady, input.hint,
    hidden && menu !== 'entry' ? limit : null,
    { inList: input.ref.inList === true, part: info.part },
  );
  const text = [
    info.title,
    byline,
    qualityLine,
    notice,
  ].filter(Boolean).join('\n');
  // A link pasted alone in a Telegram chat: the answer takes its message's place (the bot step
  // deletes it), so the answer carries the link (user, 2026-10-23: 「刪除原PO 的網址 / 然後把網址直接
  // 附著在 output 上面」) — the site's own form of it, without the tracking parameters.
  const replaceLink = !input.quality && config.__triggerPlatform === 'telegram';
  const link = replaceLink ? url : '';
  const previewLabel = preview === null ? '' : allChoices.find((c) => c.quality === preview)?.label ?? `${preview}p`;
  const previewCaption = preview === null
    ? ''
    : [info.title, byline, link, t(strings, 'ytdl.preview.caption', { quality: previewLabel }), notice].filter(Boolean).join('\n');
  const botText = [info.title, byline, link, qualityLine, notice].filter(Boolean).join('\n');
  // The desktop chat's menu shows the cover as a bot chat's does; a bot step sends `image` itself.
  const cover = config.cover === 'true' && !input.quality ? (await VIDEO_SITES[site].chatCover?.(info)) ?? '' : '';
  return JSON.stringify({
    output: text,
    chatMedia: cover,
    url,
    videoId: info.ref.id,
    title: info.title,
    channel: info.channel,
    duration,
    image: info.cover,
    // The cover goes with the link's first answer only, not with the download menu asked for after it.
    menuImage: input.quality ? '' : info.cover,
    quality: input.quality,
    // What this run carries out — a summary, a download — or empty when it answers with a menu.
    pick: menu ? '' : input.quality,
    // Set only for a download, so a stop step on it ends the menu and summary branches.
    download: menu || input.quality === 'summary' ? '' : input.quality,
    // The quality a preview downloads (`480`), or empty for none.
    preview: preview === null ? '' : String(preview),
    previewCaption,
    // What a bot chat's menu says: the text, with the link when the menu takes the link's place.
    botText,
    // "1" when the answer takes the place of the pasted link's message (`replaceTrigger`).
    replaceLink: replaceLink ? '1' : '',
    buttons: formatFlowButtons(buttons),
    available: choices.map((c) => String(c.quality)).join(','),
    downloadReady: downloadReady ? '1' : '0',
    notice,
    isFailed: '0',
  });
}

/**
 * Which menu a run answers with, or '' when it carries out a choice: a link alone gets the first
 * menu ("analyze", "download") when there is more than the download to offer — a summary, or a
 * preview above it — and the download menu straight away otherwise; "download" gets the download menu.
 */
function menuStage(quality: string, firstMenu: boolean): '' | 'entry' | 'download' {
  if (quality === DOWNLOAD_MENU) return 'download';
  if (quality) return '';
  return firstMenu ? 'entry' : 'download';
}

export const FAILURE_KEYS: Record<YtdlFailureCategory, string> = {
  youtubeChanged: 'flow.error.ytdlBroken',
  formatMissing: 'flow.error.ytdlFormatMissing',
  blocked: 'flow.error.ytdlBlocked',
  restricted: 'flow.error.ytdlRestrictedGeneric',
  live: 'flow.error.ytdlLive',
  network: 'flow.error.ytdlNetwork',
  firewall: 'flow.error.ytdlFirewall',
  disk: 'flow.error.ytdlDiskFull',
  other: 'flow.error.ytdlFailed',
};

/** A download failure in the person's words; `site` names the site for the keys that say which. */
export function asFlowError(err: unknown, site: VideoSiteId): unknown {
  if (!(err instanceof YtdlError)) return err;
  return new FlowUserError(FAILURE_KEYS[err.category], { site: siteLabel(site) }, err.message);
}

function requestedQuality(raw: string | undefined): YtdlPick {
  const quality = parseQualityToken(raw ?? '');
  if (quality === 'best' || quality === 'mp3') return quality;
  if (quality && quality !== 'summary' && quality !== DOWNLOAD_MENU) return Number(quality);
  throw new FlowUserError('flow.error.ytdlNoQuality', {}, 'No video quality was given (e.g. 720 or best)');
}

async function requireFreeSpace(dir: string, estimate: number | null): Promise<void> {
  if (estimate === null) return;
  const free = await freeDiskBytes(dir);
  if (free === null) return;
  const needed = Math.ceil(estimate * SPACE_FACTOR);
  if (free >= needed) return;
  throw new FlowUserError(
    'flow.error.ytdlDiskNeeded',
    { size: formatMegabytes(needed) },
    `Not enough disk space: about ${formatMegabytes(needed)} needed, ${formatMegabytes(free)} free`,
  );
}

/** The tools are there and `site` is not waiting for a newer yt-dlp; another site's pause does not count. */
function requireTools(site: VideoSiteId): void {
  const state = getYtdlToolsState();
  if (state.status !== 'ready' && state.status !== 'custom') {
    throw new FlowUserError('flow.error.ytdlToolsMissing', {}, 'The video download tools are not installed');
  }
  if (siteChangedAt(state, site)) {
    throw new FlowUserError('flow.error.ytdlBroken', { site: siteLabel(site) }, `${siteLabel(site)} changed and yt-dlp has no fix yet`);
  }
}

/** How often a download reports: live for the desktop bar, without a message per yt-dlp line. */
const PROGRESS_INTERVAL_MS = 200;

/**
 * Turns yt-dlp's lines into `StepProgress` reports, at most one per interval. An MP3's estimate is
 * the converted file, not the sound yt-dlp fetches, so its bar follows the totals yt-dlp reports.
 */
function downloadProgressReporter(
  target: DownloadTarget,
  onProgress: ((progress: StepProgress) => void) | undefined,
  now: () => number = Date.now,
): { sample: (sample: YtdlProgressSample) => void; postprocess: () => void } | undefined {
  if (!onProgress) return undefined;
  const track = createYtdlProgress(target.kind === 'audio' ? null : target.sizeBytes, now);
  const kind = target.kind === 'audio' ? { kind: target.kind } : {};
  let lastAt = -Infinity;
  let lastPercent: number | null = null;
  let processing = false;
  return {
    sample: (sample) => {
      const p = track(sample);
      const at = now();
      // A new whole percent always shows; between them, once per interval for the speed.
      if (processing || (p.percent === lastPercent && at - lastAt < PROGRESS_INTERVAL_MS)) return;
      lastAt = at;
      lastPercent = p.percent;
      onProgress({ phase: 'downloading', label: target.label, ...p, ...kind });
    },
    postprocess: () => {
      if (processing) return;
      processing = true;
      onProgress(phaseOnly('processing', target.label, null, target.kind));
    },
  };
}

function phaseOnly(phase: StepProgress['phase'], label: string, sizeBytes: number | null = null, kind: DownloadKind = 'video'): StepProgress {
  return {
    phase, label, percent: null, downloadedBytes: 0, totalBytes: sizeBytes, bytesPerSecond: null, etaSeconds: null,
    ...(kind === 'audio' ? { kind } : {}),
  };
}

/** What a download fetches: one of the video's qualities, or its sound alone as an MP3. */
interface DownloadTarget {
  kind: DownloadKind;
  /** `720p60`, or `MP3`. */
  label: string;
  /** The menu's estimate; null when the site gave none. */
  sizeBytes: number | null;
  /** What the site's options are built for. */
  pick: YtdlPick;
  /** The reuse key's quality: the video's lines, or the MP3's bitrate in kbps. */
  keyQuality: number;
  /** The envelope's `quality`: the lines downloaded (`720`), or `mp3`. */
  quality: string;
  /** The menu priced it with the low AAC (`YtdlChoice.lowAudio`): the download asks for that. */
  lowAudio: boolean;
}

/** The quality asked for among the video's, held to the cap; throws when there is none to get. */
function videoTarget(
  quality: number | 'best',
  choices: readonly YtdlChoice[],
  allowed: readonly YtdlChoice[],
  access: YtdlAccess,
  limitBytes: SizeLimit,
): DownloadTarget {
  // "best" for a capped person is the best that fits, not the best there is.
  const choice = quality === 'best' ? (access.capped ? allowed : choices).at(-1) : choices.find((c) => c.quality === quality);
  if (!choice) {
    if (quality === 'best') throw overCapError(null, null, allowed, limitBytes);
    const available = qualityList(choices);
    const asked = `${quality}p`;
    throw new FlowUserError('flow.error.ytdlQualityMissing', { quality: asked, available }, `This video has no ${asked} (available: ${available})`);
  }
  if (access.capped && !allowed.includes(choice)) throw overCapError(choice.label, choice.sizeBytes, allowed, limitBytes);
  const lowAudio = choice.lowAudio === true;
  return {
    kind: 'video',
    label: choice.label,
    sizeBytes: choice.sizeBytes,
    // yt-dlp's own "best" would ignore the cap, or the estimate the low AAC was chosen for: the
    // quality picked above is what gets asked for.
    pick: access.capped || lowAudio ? choice.quality : quality,
    keyQuality: choice.quality,
    quality: String(choice.quality),
    lowAudio,
  };
}

/** The video's MP3 at the bitrate `destination` gets, held to the cap as a quality is. */
function audioTarget(
  durationS: number,
  destination: YtdlDestination,
  access: YtdlAccess,
  allowed: readonly YtdlChoice[],
  limitBytes: SizeLimit,
): DownloadTarget {
  const audio = mp3Choice(durationS, destination);
  if (access.capped && exceedsLimit(audio, limitBytes)) throw overCapError(audio.label, audio.sizeBytes, allowed, limitBytes);
  return {
    kind: 'audio', label: audio.label, sizeBytes: audio.sizeBytes, pick: 'mp3', keyQuality: audio.bitrateKbps, quality: 'mp3', lowAudio: false,
  };
}

interface DownloadedVideo {
  title: string;
  kind: DownloadKind;
  /** The envelope's `quality`: `720`, or `mp3`. */
  quality: string;
  /** The whole video in the downloads folder. */
  filePath: string;
  sizeBytes: number;
  savedLocally: boolean;
}

function readySummary(video: DownloadedVideo): string {
  return t(getLangCache(), 'ytdl.summary.ready', { title: video.title, size: formatMegabytes(video.sizeBytes) });
}

/**
 * Where a file that stays on this computer is. For a Telegram chat it was over what the bot can
 * send: the line names that limit and, while large uploads are not set up, where to set them up.
 */
export function savedSummary(
  files: { filePath: string; sizeBytes: number },
  destination: YtdlDestination,
  showPath: boolean,
): string {
  const strings = getLangCache();
  const size = formatMegabytes(files.sizeBytes);
  // The whole path, so the person knows where to look; as code, since Markdown would read the
  // backslashes of a Windows path as escapes.
  const file = files.filePath.includes('`') ? files.filePath : `\`${files.filePath}\``;
  if (destination !== 'telegram') {
    return showPath ? t(strings, 'ytdl.summary.saved', { size, file }) : t(strings, 'ytdl.summary.savedNoPath', { size });
  }
  const limit = formatLimit(telegramSendLimitBytes());
  const line = showPath
    ? t(strings, 'ytdl.summary.tooLarge', { size, limit, file })
    : t(strings, 'ytdl.summary.tooLargeNoPath', { size, limit });
  return largeUploadReady() ? line : `${line}\n${t(strings, 'ytdl.summary.largeUploadHint')}`;
}

function downloadEnvelope(video: DownloadedVideo, destination: YtdlDestination, access: YtdlAccess): string {
  const fileName = path.basename(video.filePath);
  const summary = video.savedLocally ? savedSummary(video, destination, access.showPath) : readySummary(video);
  return JSON.stringify({
    output: video.filePath,
    title: video.title,
    kind: video.kind,
    quality: video.quality,
    sizeMb: (video.sizeBytes / 1_000_000).toFixed(1),
    fileName,
    savedLocally: video.savedLocally ? '1' : '0',
    summary,
  });
}

/**
 * The same video at the same quality (or its MP3 at the same bitrate), finished within the time
 * Downloads/Yobi keeps it and still in the folder this step saves to: used as is instead of
 * downloading it again — the person deleted the sent video and pressed the button again. Reusing
 * it starts its time in Downloads/Yobi again (`findYtdlJob`).
 */
async function reuseDownload(
  match: Pick<YtdlJobRecord, 'site' | 'videoId' | 'variant' | 'kind' | 'audio' | 'quality' | 'destination'>,
  folder: string,
  label: string,
): Promise<YtdlJobRecord | null> {
  // Only a download saved in `folder` is found (`findYtdlJob` checks the folder).
  const hit = await findYtdlJob({ ...match, folder }).catch(() => null);
  if (!hit) return null;
  sendLog(`♻️ [${label}] Reusing ${hit.record.filePath} (${formatMegabytes(hit.record.sizeBytes)}) — already downloaded`);
  return hit.record;
}

export async function execYoutubeDownload(
  config: Record<string, string>,
  signal?: AbortSignal,
  onProgress?: (progress: StepProgress) => void,
): Promise<string> {
  const ref = matchVideoRef(config.url ?? '');
  // A playlist turned away is no use of the downloader, nor a failure of it.
  const site = ref && !isPlaylist(ref) ? ref.site : null;
  return countDownload(site, signal, () => youtubeDownload(config, signal, briefly(config, onProgress)));
}

/**
 * A step with `progress: "brief"` (a link pasted alone, answered in the background — user
 * 2026-10-23: "寫好處理中，然後下次更新就是出現result") says "working" once, the first time it has
 * anything to report, and nothing after: no reading, no quality, no bar, no sending.
 */
function briefly(
  config: Readonly<Record<string, string>>,
  onProgress: ((progress: StepProgress) => void) | undefined,
): ((progress: StepProgress) => void) | undefined {
  if (!onProgress || config.progress !== 'brief') return onProgress;
  let told = false;
  return () => {
    if (told) return;
    told = true;
    onProgress(phaseOnly('working', ''));
  };
}

async function youtubeDownload(
  config: Record<string, string>,
  signal: AbortSignal | undefined,
  onProgress: ((progress: StepProgress) => void) | undefined,
): Promise<string> {
  const asked = matchVideoRef(config.url ?? '');
  if (!asked) throw new FlowUserError('flow.error.ytdlNotYoutube', {}, 'The url is not a YouTube video link');
  if (isPlaylist(asked)) throw playlistRefused(asked.site);
  if (parseQualityToken(config.quality ?? '') === 'srt') return subtitlesDownload(asked, config, signal, onProgress);
  const requested = requestedQuality(config.quality);
  // A site with sound only (SoundCloud) has its MP3 alone: any quality asked for is that.
  const quality: YtdlPick = videoIsAudioOnly(asked.site) ? 'mp3' : requested;
  requireTools(asked.site);
  const info = await readVideo(asked, config, signal, onProgress);
  // The site's own form of the link, as its `info` read it, is what gets downloaded.
  const { ref } = info;
  const label = siteLabel(ref.site);
  const destination = resolveYtdlDestination(config.destination, config.__triggerPlatform);
  const access = await ytdlAccessFor(config);
  const limit = downloadLimitBytes(access, destination);
  const choices = info.choices(destination, true, limit);
  const allowed = choicesWithinCap(choices, access, limit);
  const target = quality === 'mp3'
    ? audioTarget(info.durationS, destination, access, allowed, limit)
    : videoTarget(quality, choices, allowed, access, limit);
  // Whether a file of this size goes to the bot step, or only stays on the computer: decided now,
  // for a reused file too — large uploads may have been set up (or taken away) since.
  const handedOver = (sizeBytes: number): boolean => destination === 'telegram' && sizeBytes <= telegramSendLimitBytes();
  const sending = (sizeBytes: number): void => {
    onProgress?.(phaseOnly('sending', target.label, sizeBytes, target.kind));
  };
  const shown = { title: info.title, kind: target.kind, quality: target.quality };

  const match = {
    site: ref.site, videoId: ref.id, variant: ref.variant ?? '', kind: target.kind,
    // A low-AAC file and one with the usual audio never stand in for each other.
    ...(target.lowAudio ? { audio: 'low' as const } : {}),
    quality: target.keyQuality, destination,
  };
  const reused = await reuseDownload(match, downloadsFolder(config.folder), label);
  if (reused) {
    if (overCap(reused.sizeBytes, access, limit)) throw overCapError(target.label, reused.sizeBytes, allowed, limit);
    const savedLocally = !handedOver(reused.sizeBytes);
    if (!savedLocally) sending(reused.sizeBytes);
    return downloadEnvelope({ ...reused, ...shown, savedLocally }, destination, access);
  }

  void cleanupYtdlJobs().catch(() => {});
  const jobDir = await createYtdlJobDir();
  await requireFreeSpace(jobDir, target.sizeBytes);
  // The checks above read the menu's estimate; a site Yobi downloads itself is also held to them
  // as the bytes arrive (an m3u8 link's playlist may declare far less than its segments send).
  const fetchLimit = await fetchLimitFor(jobDir, access.capped && limit !== null ? streamCapBytes(limit) : null);
  const smaller = target.kind === 'video' ? allowed.filter((c) => c.quality < target.keyQuality) : [];
  let keepJobDir = false;
  try {
    onProgress?.(phaseOnly('starting', target.label, target.sizeBytes, target.kind));
    const reporter = downloadProgressReporter(target, onProgress);
    const result = await downloadSiteVideo(ref, target.pick, destination, {
      info,
      jobDir,
      signal,
      onProgress: reporter?.sample,
      onPostprocess: reporter?.postprocess,
      onLog: sendLog,
      ...(target.lowAudio ? { lowAudio: true } : {}),
      ...(fetchLimit ? { fetchLimit } : {}),
    }).catch((err: unknown) => {
      if (!(err instanceof StreamTooLargeError)) throw asFlowError(err, ref.site);
      // Stopped as it passed the limit: over the person's cap, or more than the disk can take.
      if (!err.disk) throw overCapError(target.label, err.receivedBytes, smaller, limit);
      throw new FlowUserError(FAILURE_KEYS.disk, { site: label }, `Stopped before filling the disk: ${err.message}`);
    });
    // The estimate fitted but the file did not: a capped person gets nothing, and the job folder goes.
    if (overCap(result.sizeBytes, access, limit)) throw overCapError(target.label, result.sizeBytes, smaller, limit);
    // `Title (720p).mp4`; an MP3 is the title alone, as a song is.
    const fileName = safeVideoFileName(info.title, path.extname(result.filePath), target.kind === 'video' ? target.label : '');
    // Over what the bot can send: only the computer, never split into parts.
    const sent = handedOver(result.sizeBytes);

    // Every download lands in the downloads folder, a Telegram one too: the bot step sends from
    // there, and the folder's cleanup removes it.
    const folder = downloadsFolder(config.folder);
    const finalPath = await saveIntoFolder(result.filePath, folder, fileName);
    sendLog(`💾 [${label}] Saved ${finalPath} (${formatMegabytes(result.sizeBytes)})`);
    await removeJobContents(jobDir);
    const record: YtdlJobRecord = { ...match, filePath: finalPath, sizeBytes: result.sizeBytes, savedLocally: !sent };
    // The folder stays (as long as the downloads) only to remember where this copy went.
    keepJobDir = await writeYtdlJobRecord(jobDir, record).then(() => true, () => false);
    if (sent) sending(result.sizeBytes);
    return downloadEnvelope({ ...record, ...shown }, destination, access);
  } finally {
    if (!keepJobDir) await removeYtdlJobDir(jobDir).catch(() => {});
  }
}

/**
 * The subtitles as an .srt (`ytdlSubtitles.ts`): the video read as for a download, then its
 * timed captions, each read reporting `reading` when slow. No tools, no size cap, no reuse.
 */
async function subtitlesDownload(
  asked: VideoRef,
  config: Record<string, string>,
  signal: AbortSignal | undefined,
  onProgress: ((progress: StepProgress) => void) | undefined,
): Promise<string> {
  const info = await readVideo(asked, config, signal, onProgress);
  const subtitles = await withReadingNotice(info.ref.site, onProgress, () => readVideoSubtitles(info, signal));
  const access = await ytdlAccessFor(config);
  return saveSubtitles(info, subtitles, {
    folder: downloadsFolder(config.folder),
    destination: resolveYtdlDestination(config.destination, config.__triggerPlatform),
    showPath: access.showPath,
  });
}

/** yt-dlp's leftovers (part files, the separate streams), leaving the folder itself. */
async function removeJobContents(jobDir: string): Promise<void> {
  const names = await fs.readdir(jobDir).catch(() => [] as string[]);
  await Promise.all(names.map((name) => fs.rm(path.join(jobDir, name), { recursive: true, force: true }).catch(() => {})));
}

