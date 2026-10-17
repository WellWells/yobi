import { matchLink, matchVideoRef, videoHasSubtitles, videoHasSummary, videoIsAudioOnly, withoutShareTitle } from './linkSites/rows';
import { siteChangedAt } from './linkSites/siteChanged';
import type { SiteChangedMap } from './linkSites/siteChanged';
import type { LinkMatch, LinkSiteId, VideoRef, VideoSiteId } from './linkSites/types';
import type { FlowButton } from './types';

export type { FlowButton };

/**
 * Telegram's cloud Bot API takes uploads up to 50 MB (sendVideo and sendDocument alike). Kept a
 * little under it so an MB/MiB mix-up or the multipart overhead never decides the outcome.
 */
export const TELEGRAM_UPLOAD_LIMIT_BYTES = 49_000_000;

/** Telegram's own limit on one album. */
export const TELEGRAM_ALBUM_MAX = 10;

/**
 * A size limit as people say it: the Bot API's upload limit is "50 MB" (the constant sits a little
 * under it), a limit of a gigabyte or more in GB ("2 GB" for Telegram's 2000 MiB), anything else
 * as `formatMegabytes` writes it ("100 MB").
 */
export function formatLimit(bytes: number): string {
  if (bytes === TELEGRAM_UPLOAD_LIMIT_BYTES) return '50 MB';
  if (bytes >= 1_000_000_000) return `${Math.round((bytes / 2 ** 30) * 10) / 10} GB`;
  return formatMegabytes(bytes);
}

export type YtdlDestination = 'telegram' | 'local';

/**
 * `''` = not given (show the menu), `summary`, `srt` (the subtitles), `best`, `mp3` (the sound
 * alone), or a quality number such as `720`.
 */
export type YtdlQuality = string;

/** What a download hands over: the video, or its sound alone as an MP3 (the menu's MP3 button). */
export type DownloadKind = 'video' | 'audio';

/** What a site's yt-dlp options are built for: a quality the menu offered, `best`, or the MP3. */
export type YtdlPick = number | 'best' | 'mp3';

export type YtdlInputHint = '' | 'ambiguous2k';

export interface YtdlInput {
  videoId: string;
  /** The link the video's row rebuilt (YouTube's canonical watch URL), never the text the user typed. */
  url: string;
  quality: YtdlQuality;
  hint: YtdlInputHint;
}

/**
 * Menu words that are read as nothing, so a message or button carrying them still gets the menu
 * rather than the agent.
 */
const NO_OP_WORDS = new Set(['split', '分段']);

const MIN_QUALITY = 144;
const MAX_QUALITY = 4320;

const QUALITY_ALIASES: Record<string, string> = {
  '4k': '2160',
  uhd: '2160',
  '8k': '4320',
  hd: '720',
  fhd: '1080',
  fullhd: '1080',
  qhd: '1440',
  best: 'best',
  max: 'best',
  '最高': 'best',
  '最高畫質': 'best',
  '最高画质': 'best',
  mp3: 'mp3',
  audio: 'mp3',
  '音訊': 'mp3',
  '音频': 'mp3',
  '音檔': 'mp3',
  summary: 'summary',
  sum: 'summary',
  '摘要': 'summary',
  '摘要重點': 'summary',
  '摘要重点': 'summary',
  '總結': 'summary',
  '总结': 'summary',
  srt: 'srt',
  subtitles: 'srt',
  subs: 'srt',
  '字幕': 'srt',
  '字幕檔': 'srt',
  '字幕文件': 'srt',
};

/**
 * One quality word: an alias, or a number of lines with an optional `p` and frame rate
 * (`1080`, `1080p`, `1080p60`). `null` when the word is not a quality at all.
 */
export function parseQualityToken(token: string): YtdlQuality | null {
  const word = token.trim().toLowerCase();
  if (!word) return null;
  const alias = QUALITY_ALIASES[word];
  if (alias) return alias;
  const match = /^(\d{3,4})(?:p(?:\d{2})?)?$/.exec(word);
  if (!match) return null;
  const lines = Number(match[1]);
  if (lines < MIN_QUALITY || lines > MAX_QUALITY) return null;
  return String(lines);
}

/** What the video menu reads from its input: the video and the words beside it. */
export interface VideoInput {
  ref: VideoRef;
  quality: YtdlQuality;
  hint: YtdlInputHint;
}

function firstVideoToken(tokens: readonly string[]): { ref: VideoRef; index: number } | null {
  for (const [index, token] of tokens.entries()) {
    const ref = matchVideoRef(token);
    if (ref) return { ref, index };
  }
  return null;
}

/**
 * Reads what followed `/ytdl`: the first link a video row takes plus, optionally, a quality,
 * "mp3", "summary" or the subtitles (the last two only where the site's menu has them). Words that
 * are none of these are ignored, so the menu appears instead of a guess; a site's share title
 * before its link is never read for one (a title with "720p" in it is no quality). A YouTube Music
 * link with no word of its own is the MP3 (its row marks it `music`). `null` when there is no
 * video link at all.
 */
export function parseVideoInput(raw: string): VideoInput | null {
  const tokens = withoutShareTitle(raw).split(/\s+/).filter(Boolean);
  const link = firstVideoToken(tokens);
  if (!link) return null;
  let quality = '';
  let hint: YtdlInputHint = '';
  for (const [index, token] of tokens.entries()) {
    if (index === link.index || NO_OP_WORDS.has(token.toLowerCase()) || quality) continue;
    if (token.toLowerCase() === '2k' && !videoIsAudioOnly(link.ref.site)) {
      hint = 'ambiguous2k';
      continue;
    }
    const word = parseQualityToken(token) ?? '';
    quality = offeredBy(link.ref.site, word) ? word : '';
  }
  if (!quality && !hint && link.ref.kind === 'music') quality = 'mp3';
  return { ref: link.ref, quality, hint };
}

/**
 * Whether `site`'s menu takes the quality: "summary" and the subtitles only where its row offers
 * them; a site with sound only (SoundCloud) takes the MP3 alone.
 */
function offeredBy(site: VideoSiteId, quality: YtdlQuality): boolean {
  if (quality === 'summary') return videoHasSummary(site);
  if (quality === 'srt') return videoHasSubtitles(site);
  if (videoIsAudioOnly(site)) return quality === 'mp3';
  return true;
}

/** One word beside a link of `site` that its menu reads: a no-op word ("split"), or a quality the site offers. */
function menuTakes(site: VideoSiteId, word: string): boolean {
  if (NO_OP_WORDS.has(word.toLowerCase())) return true;
  if (!isYtdlMenuWord(word)) return false;
  const quality = parseQualityToken(word);
  // `2k`, the ambiguous quality: a site with sound only has no use for it.
  return quality === null ? !videoIsAudioOnly(site) : offeredBy(site, quality);
}

/** `parseVideoInput`, the video given as its id and the link its row rebuilt (`url`). */
export function parseYtdlInput(raw: string): YtdlInput | null {
  const input = parseVideoInput(raw);
  if (!input) return null;
  return { videoId: input.ref.id, url: input.ref.url, quality: input.quality, hint: input.hint };
}

/**
 * Whether a link found in a message is the video menu's: a video link alone or with only the
 * menu's own words (a quality, "summary" and the subtitles where the site's menu has them,
 * "split"; for a site with sound only, the MP3 words and "split" alone). Any other word beside it, a second link included, makes the message a question for the
 * agent. The routers in `linkSites/registry.ts` decide by this.
 */
export function isVideoMenuMatch(match: LinkMatch | null): match is LinkMatch<VideoRef> {
  if (match?.ref.shape !== 'video') return false;
  const { site } = match.ref;
  return match.prompt.split(/\s+/).filter(Boolean).every((word) => menuTakes(site, word));
}

/**
 * Whether a message holds nothing but what `/ytdl` reads: one video link and, optionally, its own
 * words. The routers' own check (`matchLink`, then `isVideoMenuMatch`), so a pasted link alone
 * goes straight to the menu and anything else to the agent.
 */
export function isBareYtdlMessage(raw: string): boolean {
  return isVideoMenuMatch(matchLink(raw));
}

/** One of the menu's own words beside a video link: a quality, "mp3", "summary", the subtitles, "split" or the ambiguous `2k`. */
export function isYtdlMenuWord(token: string): boolean {
  const word = token.toLowerCase();
  return NO_OP_WORDS.has(word) || word === '2k' || parseQualityToken(token) !== null;
}

/** One entry of `streamingData.adaptiveFormats` / `formats` in YouTube's player response. */
export interface YtFormat {
  itag?: number;
  mimeType?: string;
  width?: number;
  height?: number;
  fps?: number;
  bitrate?: number;
  contentLength?: string | number;
  qualityLabel?: string;
  audioChannels?: number;
}

export interface YtdlChoice {
  /** The quality number buttons and `youtube_download` use, from YouTube's own label (`1080`). */
  quality: number;
  /** `1080p`, or `1080p60` when the best format at this quality runs above 30 fps. */
  label: string;
  /** Estimated video + audio bytes; `null` when YouTube did not say. */
  sizeBytes: number | null;
  /** Taller than wide (a Short). */
  portrait: boolean;
  /** Plays inline in Telegram: H.264 video with AAC audio exists at this quality. */
  telegramPlayable: boolean;
  /**
   * Telegram only: over the limit with the best stereo AAC but not with the low one
   * (`LOW_AAC_MAX_KBPS`), so `sizeBytes` is with the low one and the download asks for it.
   * Absent everywhere else.
   */
  lowAudio?: true;
}

/**
 * The low AAC a Telegram download takes when the best one alone pushes the file over the limit:
 * AAC at or under this bitrate (YouTube's itag 139 ≈ 49 kbps, bilibili's 30216 ≈ 66 kbps; the
 * next ones up are ~129 and ~100–130 kbps). yt-dlp's `[abr<=N]` filter and the estimate both use it.
 */
export const LOW_AAC_MAX_KBPS = 80;

/** YouTube's low AAC (itag 139) when the watch page does not list it: 4.91 MiB over 844 s ≈ 48.8 kbps. */
export const LOW_AAC_ESTIMATE_KBPS = 49;

/** `durationS` of the low AAC at `LOW_AAC_ESTIMATE_KBPS`; null without a length. */
export function lowAacEstimateBytes(durationS: number): number | null {
  return Number.isFinite(durationS) && durationS > 0 ? Math.round((durationS * LOW_AAC_ESTIMATE_KBPS * 1_000) / 8) : null;
}

/**
 * The largest file a download may be for the person and the place it goes, in bytes; null = none
 * (this computer). The download skills work it out (`ytdlAccess.ts`: 100 MB without the admin
 * right, else what Telegram takes right now); left out, it is the Bot API's own upload limit.
 */
export type SizeLimit = number | null;

/**
 * `choice` as a download to `destination` gets it: for Telegram, a quality over `limitBytes` whose
 * size with the low AAC (`lowAudioSizeBytes`, video included) fits is that size and marked
 * `lowAudio`; anything else — a quality that fits, one that fits with neither, the computer — as it is.
 */
export function withLowAudio(
  choice: YtdlChoice,
  lowAudioSizeBytes: number | null,
  destination: YtdlDestination,
  limitBytes: SizeLimit = TELEGRAM_UPLOAD_LIMIT_BYTES,
): YtdlChoice {
  if (destination !== 'telegram' || limitBytes === null || !exceedsLimit(choice, limitBytes) || lowAudioSizeBytes === null) return choice;
  return lowAudioSizeBytes <= limitBytes ? { ...choice, sizeBytes: lowAudioSizeBytes, lowAudio: true } : choice;
}

function lengthOf(format: YtFormat): number | null {
  const n = Number(format.contentLength);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isVideo(format: YtFormat): boolean {
  return (format.mimeType ?? '').startsWith('video/') && typeof format.height === 'number';
}

function isAudio(format: YtFormat): boolean {
  return (format.mimeType ?? '').startsWith('audio/');
}

function isH264(format: YtFormat): boolean {
  return /codecs="?avc1/i.test(format.mimeType ?? '');
}

/**
 * Stereo AAC — what a Telegram download asks yt-dlp for. Left to itself yt-dlp ranks more channels
 * higher and picks a 5.1 track three times the size that phones play as stereo anyway.
 */
function isStereoAac(format: YtFormat): boolean {
  return /codecs="?mp4a/i.test(format.mimeType ?? '') && (format.audioChannels ?? 2) <= 2;
}

/** `1080p60 HDR` → 1080. Falls back to the shorter side when YouTube gives no label. */
export function formatQuality(format: YtFormat): number | null {
  const label = /^(\d{3,4})p/.exec(format.qualityLabel ?? '');
  if (label) return Number(label[1]);
  if (typeof format.width === 'number' && typeof format.height === 'number') {
    return Math.min(format.width, format.height);
  }
  return null;
}

function largest(formats: YtFormat[]): YtFormat | undefined {
  return [...formats].sort((a, b) => (lengthOf(b) ?? 0) - (lengthOf(a) ?? 0) || (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
}

/**
 * The low AAC a Telegram download would get, in bytes: the largest stereo AAC at or under
 * `LOW_AAC_MAX_KBPS` the page lists (what yt-dlp's `ba` among them picks), else estimated from
 * the length — the watch page often leaves itag 139 out although yt-dlp gets it.
 */
function lowAacBytes(aac: readonly YtFormat[], durationS: number): number | null {
  const low = largest(aac.filter((f) => (f.bitrate ?? Infinity) <= LOW_AAC_MAX_KBPS * 1_000 && lengthOf(f) !== null));
  return low ? lengthOf(low) : lowAacEstimateBytes(durationS);
}

/**
 * The qualities a video offers, smallest first, each with a size estimate for what the download
 * will most likely pick for `destination` (`withLowAudio` against `limitBytes` for Telegram;
 * `durationS` estimates the low AAC when none is listed). Under 360p is listed only when nothing
 * larger exists.
 */
export function buildYtdlChoices(
  formats: YtFormat[],
  destination: YtdlDestination,
  includeSmall = false,
  durationS = 0,
  limitBytes: SizeLimit = TELEGRAM_UPLOAD_LIMIT_BYTES,
): YtdlChoice[] {
  const videos = formats.filter(isVideo);
  const audios = formats.filter(isAudio);
  const aac = audios.filter(isStereoAac);
  const lowAudio = lowAacBytes(aac, durationS);
  const byQuality = new Map<number, YtFormat[]>();
  for (const format of videos) {
    const quality = formatQuality(format);
    if (quality === null) continue;
    byQuality.set(quality, [...(byQuality.get(quality) ?? []), format]);
  }
  const choices: YtdlChoice[] = [];
  for (const [quality, group] of byQuality) {
    const h264 = group.filter(isH264);
    const telegramPlayable = h264.length > 0 && aac.length > 0;
    const video = destination === 'telegram' && h264.length > 0 ? largest(h264) : largest(group);
    const audio = destination === 'telegram' && aac.length > 0 ? largest(aac) : largest(audios);
    if (!video) continue;
    const videoBytes = lengthOf(video);
    const audioBytes = audio ? lengthOf(audio) : 0;
    const sizeBytes = videoBytes !== null && audioBytes !== null ? videoBytes + audioBytes : null;
    const fps = Math.max(...group.map((f) => f.fps ?? 0));
    const choice: YtdlChoice = {
      quality,
      label: fps > 30 ? `${quality}p${fps}` : `${quality}p`,
      sizeBytes,
      portrait: (video.height ?? 0) > (video.width ?? 0),
      telegramPlayable,
    };
    // Only the H.264 + AAC download can swap its sound for the low AAC.
    const lowSize = telegramPlayable && videoBytes !== null && lowAudio !== null ? videoBytes + lowAudio : null;
    choices.push(withLowAudio(choice, lowSize, destination, limitBytes));
  }
  choices.sort((a, b) => a.quality - b.quality);
  if (includeSmall) return choices;
  const large = choices.filter((c) => c.quality >= 360);
  return large.length > 0 ? large : choices;
}

/** The MP3's bitrate: a Telegram chat gets the smaller file, this computer the fuller one. */
export const MP3_BITRATE_KBPS: Readonly<Record<YtdlDestination, number>> = { telegram: 128, local: 192 };

/** The MP3 button's and the progress line's name for it: a format, the same in every language. */
export const MP3_LABEL = 'MP3';

/** The menu's MP3: the video's sound alone, at the bitrate its destination gets. */
export interface YtdlAudioChoice {
  kind: 'audio';
  label: string;
  bitrateKbps: number;
  /** Length × bitrate; `null` when the site gave no length. */
  sizeBytes: number | null;
}

/** The MP3 of a video `durationS` seconds long, going to `destination`. */
export function mp3Choice(durationS: number, destination: YtdlDestination): YtdlAudioChoice {
  const bitrateKbps = MP3_BITRATE_KBPS[destination];
  const sizeBytes = Number.isFinite(durationS) && durationS > 0 ? Math.round((durationS * bitrateKbps * 1000) / 8) : null;
  return { kind: 'audio', label: MP3_LABEL, bitrateKbps, sizeBytes };
}

/** Whether the estimate already says the file is over `limitBytes` (null: no limit). Unknown sizes are tried. */
export function exceedsLimit(choice: Pick<YtdlChoice, 'sizeBytes'>, limitBytes: SizeLimit): boolean {
  return limitBytes !== null && choice.sizeBytes !== null && choice.sizeBytes > limitBytes;
}

export const MAX_FLOW_BUTTONS = 12;
export const MAX_FLOW_BUTTON_LABEL = 64;

/**
 * A bot step's `buttons` field: one button per line, `label | input`. A line without `|` uses
 * the same text for both. Blank lines are skipped; at most `MAX_FLOW_BUTTONS`.
 */
export function parseFlowButtons(text: string): FlowButton[] {
  const buttons: FlowButton[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const bar = trimmed.indexOf('|');
    const label = (bar >= 0 ? trimmed.slice(0, bar) : trimmed).trim();
    const input = (bar >= 0 ? trimmed.slice(bar + 1) : trimmed).trim();
    if (!label || !input) continue;
    buttons.push({ label: Array.from(label).slice(0, MAX_FLOW_BUTTON_LABEL).join(''), input });
    if (buttons.length >= MAX_FLOW_BUTTONS) break;
  }
  return buttons;
}

export function formatFlowButtons(buttons: readonly FlowButton[]): string {
  return buttons.map((b) => `${b.label.replace(/\|/g, '/')} | ${b.input}`).join('\n');
}

/**
 * A step's `buttonImages`: one line per button that has a picture, `input | picture`, matched to
 * its button by the input — a flow may put buttons of its own around the step's (the forward's
 * "analyze" line comes first), so the place in the list says nothing.
 */
export function formatButtonImages(buttons: readonly FlowButton[]): string {
  return buttons.filter((b) => b.image).map((b) => `${b.input} | ${b.image}`).join('\n');
}

/** The buttons with their pictures (`formatButtonImages`); a button with none stays as it is. */
export function withButtonImages(buttons: readonly FlowButton[], images: string | undefined): FlowButton[] {
  const byInput = new Map<string, string>();
  for (const line of (images ?? '').split(/\r?\n/)) {
    const bar = line.lastIndexOf(' | ');
    if (bar < 0) continue;
    const input = line.slice(0, bar).trim();
    const image = line.slice(bar + 3).trim();
    if (input && image) byInput.set(input, image);
  }
  return buttons.map((button) => {
    const image = byInput.get(button.input);
    return image ? { ...button, image } : button;
  });
}

export interface YtdlMenuLabels {
  /** The "summary" button's label; left out for a site with no transcript to sum up. */
  summary?: string;
  /** The subtitles (.srt) button's label; left out for a video with no subtitles. */
  subtitles?: string;
  /** `{{size}}` = "95 MB". */
  size: string;
  /** Over what the chat can be sent: saved on the computer only. `{{size}}` = "900 MB". */
  sizeSavedOnly: string;
  unknownSize: string;
}

export function formatMegabytes(bytes: number): string {
  const mb = bytes / 1_000_000;
  return `${mb >= 10 ? Math.round(mb) : Math.max(0.1, Math.round(mb * 10) / 10)} MB`;
}

/** `720p · 95 MB`, or with the "saved to computer" words when it is over what the chat can be sent. */
function sizedLabel(
  choice: Pick<YtdlChoice, 'label' | 'sizeBytes'>,
  sendLimitBytes: SizeLimit,
  labels: YtdlMenuLabels,
): string {
  const size = choice.sizeBytes === null ? labels.unknownSize : formatMegabytes(choice.sizeBytes);
  const template = exceedsLimit(choice, sendLimitBytes) ? labels.sizeSavedOnly : labels.size;
  return `${choice.label} · ${template.replace('{{size}}', size)}`;
}

/**
 * The menu under a video: "summary" first (when the site has a transcript), then one button per
 * quality, then the MP3 (when `audio` is given), then the subtitles (when the video has them).
 * A choice over `sendLimitBytes` (what the chat can be sent now; null on the computer) still gets
 * a button and says it is only saved to the computer. "summary" and the subtitles need no download
 * tools, so they stay while downloads are off; the button limit cuts qualities, never the MP3 or
 * the subtitles.
 */
export function buildYtdlButtons(
  url: string,
  choices: readonly YtdlChoice[],
  sendLimitBytes: SizeLimit,
  labels: YtdlMenuLabels,
  downloadReady: boolean,
  audio: YtdlAudioChoice | null = null,
): FlowButton[] {
  const buttons: FlowButton[] = labels.summary === undefined ? [] : [{ label: labels.summary, input: `${url} summary` }];
  const last: FlowButton[] = labels.subtitles === undefined ? [] : [{ label: labels.subtitles, input: `${url} srt` }];
  if (!downloadReady) return [...buttons, ...last];
  for (const choice of choices) {
    buttons.push({ label: sizedLabel(choice, sendLimitBytes, labels), input: `${url} ${choice.quality}` });
  }
  const tail: FlowButton[] = audio ? [{ label: sizedLabel(audio, sendLimitBytes, labels), input: `${url} mp3` }, ...last] : last;
  return [...buttons.slice(0, MAX_FLOW_BUTTONS - tail.length), ...tail];
}

export interface YtdlProgressSample {
  downloadedBytes: number;
  totalBytes: number | null;
}

export interface YtdlProgress {
  downloadedBytes: number;
  totalBytes: number | null;
  /** Never 100 before the download has finished; null when no total is known. */
  percent: number | null;
  /** Smoothed over the last few seconds; null until there are two samples far enough apart. */
  bytesPerSecond: number | null;
  /** Null without a total or a speed. */
  etaSeconds: number | null;
}

/** Samples closer than this are too noisy to time; the next one measures across both. */
const SPEED_WINDOW_MS = 500;
/** Weight of the newest measurement: a dip or a burst moves the speed, a single one does not. */
const SPEED_SMOOTHING = 0.3;

/**
 * yt-dlp reports each stream on its own (video, then audio), each counting from zero. This adds
 * the finished ones up so the line reads as one download, measured against the menu's estimate
 * when there is one, and times it for a speed and the time left.
 */
export function createYtdlProgress(
  estimateBytes: number | null,
  now: () => number = Date.now,
): (sample: YtdlProgressSample) => YtdlProgress {
  let done = 0;
  let current = 0;
  let currentTotal: number | null = null;
  let mark: { at: number; bytes: number } | null = null;
  let speed: number | null = null;
  return (sample) => {
    if (sample.downloadedBytes < current) done += currentTotal ?? current;
    current = sample.downloadedBytes;
    currentTotal = sample.totalBytes;
    const downloadedBytes = done + current;
    const at = now();
    if (!mark) {
      mark = { at, bytes: downloadedBytes };
    } else if (at - mark.at >= SPEED_WINDOW_MS) {
      const measured = Math.max(0, downloadedBytes - mark.bytes) / ((at - mark.at) / 1000);
      speed = speed === null ? measured : SPEED_SMOOTHING * measured + (1 - SPEED_SMOOTHING) * speed;
      mark = { at, bytes: downloadedBytes };
    }
    const total = estimateBytes ?? (currentTotal === null ? null : done + currentTotal);
    const totalBytes = total === null ? null : Math.max(total, downloadedBytes);
    const percent = totalBytes ? Math.min(99, Math.floor((downloadedBytes / totalBytes) * 100)) : null;
    const etaSeconds = totalBytes !== null && speed !== null && speed > 0
      ? Math.max(0, totalBytes - downloadedBytes) / speed
      : null;
    return { downloadedBytes, totalBytes, percent, bytesPerSecond: speed, etaSeconds };
  };
}

/** `12:34`, or `1:02:03` past an hour. */
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '';
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Linux allows 255 bytes per name; leave room for " (12)" and the extension. */
const FILE_NAME_MAX_BYTES = 200;

const utf8 = new TextEncoder();

function truncateUtf8(text: string, maxBytes: number): string {
  let out = '';
  let bytes = 0;
  for (const ch of text) {
    const size = utf8.encode(ch).length;
    if (bytes + size > maxBytes) break;
    out += ch;
    bytes += size;
  }
  return out;
}

/**
 * A file name for a video title that is valid on Windows, macOS and Linux alike: no reserved
 * characters or names, no trailing dots or spaces, NFC, and at most 200 UTF-8 bytes before the
 * extension. Falls back to `video` when nothing usable is left. A `tag` (the quality, `720p`)
 * follows the title in parentheses and survives a long title: the title is cut, not the tag.
 */
export function safeVideoFileName(title: string, ext: string, tag = ''): string {
  const cleanTag = tag.replace(/[^a-z0-9]/gi, '');
  const suffix = cleanTag ? ` (${cleanTag})` : '';
  const name = safeNameStem(title, FILE_NAME_MAX_BYTES - suffix.length, 'video');
  const cleanExt = ext.replace(/^\./, '').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'mp4';
  return `${name}${suffix}.${cleanExt}`;
}

/** A folder name under the same rules as `safeVideoFileName`, with no extension; `fallback` when nothing usable is left. */
export function safeFolderName(name: string, fallback: string): string {
  return safeNameStem(name, FILE_NAME_MAX_BYTES, fallback);
}

function safeNameStem(title: string, maxBytes: number, fallback: string): string {
  const name = truncateUtf8(
    title.normalize('NFC')
      .replace(/[<>:"/\\|?*\t\r\n]/g, ' ')
      .replace(/\p{Cc}/gu, '')
      .replace(/\s+/g, ' ')
      .trim(),
    maxBytes,
  ).replace(/[.\s]+$/, '').trim();
  if (!name) return fallback;
  return WINDOWS_RESERVED.test(name) ? `${name}_` : name;
}

/** `name.mp4` → `name (2).mp4`. */
export function numberedFileName(fileName: string, n: number): string {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return `${fileName} (${n})`;
  return `${fileName.slice(0, dot)} (${n})${fileName.slice(dot)}`;
}

export type YtdlToolStatus = 'missing' | 'installing' | 'ready' | 'broken' | 'custom';

export type YtdlFailureCategory =
  | 'youtubeChanged'
  /** yt-dlp offers fewer formats than the watch page listed: one quality, not every download. */
  | 'formatMissing'
  | 'blocked'
  | 'restricted'
  | 'live'
  | 'network'
  | 'firewall'
  | 'disk'
  | 'other';

export interface YtdlInstallProgress {
  component: 'yt-dlp' | 'ffmpeg' | 'ffprobe';
  phase: 'download' | 'verify' | 'extract' | 'test';
  receivedBytes: number;
  totalBytes: number;
}

export interface YtdlLastFailure {
  category: YtdlFailureCategory;
  at: string;
  /** Whose download it was; absent means YouTube. */
  site?: LinkSiteId;
}

export interface YtdlToolsState {
  status: YtdlToolStatus;
  /** This platform has a pinned build at all (false on, e.g., Windows ARM64 without x64 tools). */
  supported: boolean;
  progress?: YtdlInstallProgress;
  ytdlpVersion?: string;
  ffmpegVersion?: string;
  /** Total download size for this platform, in bytes, before anything is installed. */
  downloadBytes: number;
  /** Where the tools live, for the dialog and the settings card. */
  location: string;
  nightly: boolean;
  customPaths?: { ytdlp: string; ffmpegDir: string };
  /**
   * The last download failed the way a YouTube change makes yt-dlp fail, and no newer yt-dlp has
   * been installed since. Downloads are off until one is.
   */
  youtubeChangedAt?: string;
  /** The same for every other site: one site's change pauses that site's downloads only. */
  siteChangedAt?: SiteChangedMap;
  lastFailure?: YtdlLastFailure;
  /** The last install or update attempt failed, in English (localised by the renderer). */
  installError?: string;
  lastCheckedAt?: string;
}

/** `site`'s downloads can run: the tools are there and no change of that site waits for a newer yt-dlp. */
export function ytdlDownloadReady(
  state: Pick<YtdlToolsState, 'status' | 'youtubeChangedAt' | 'siteChangedAt'>,
  site: LinkSiteId,
): boolean {
  return (state.status === 'ready' || state.status === 'custom') && !siteChangedAt(state, site);
}
