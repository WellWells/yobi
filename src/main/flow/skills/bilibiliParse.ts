import { LOW_AAC_MAX_KBPS, withLowAudio } from '../../../shared/ytdl';
import type { SizeLimit, YtdlChoice, YtdlDestination } from '../../../shared/ytdl';
import { arr, num, obj, str } from './jsonPick';
import type { Json } from './jsonPick';

/*
 * What a bilibili video page and its quality list say, read from the page's own JSON
 * (`__INITIAL_STATE__.videoData`, the player's `playurl` answer).
 */

/** One video (or the part of it the link names), as the menu needs it. */
export interface BilibiliVideoData {
  bvid: string;
  aid: number;
  /** The video's title, with the part's own name after it for a video in several parts. */
  title: string;
  owner: string;
  /** Unix seconds; 0 when the page gave none. */
  pubdate: number;
  desc: string;
  /** The part's length, in seconds. */
  durationS: number;
  /** The id of the part's stream: what `playurl` asks for. */
  cid: number;
  part: number;
  /** An https URL, or "". */
  cover: string;
}

const BV_ID = /^BV1[1-9A-HJ-NP-Za-km-z]{9}$/;

/** bilibili gives its covers as `http://` or `//host` links; only https is fetched. */
export function httpsCover(url: string): string {
  if (/^https:\/\//i.test(url)) return url;
  if (/^http:\/\//i.test(url)) return `https://${url.slice('http://'.length)}`;
  if (url.startsWith('//')) return `https:${url}`;
  return '';
}

/**
 * The page's `videoData` read for part `part` (1 for a single video): null when it names no
 * video or has no such part.
 */
export function readVideoData(raw: unknown, part: number): BilibiliVideoData | null {
  const data = obj(raw);
  const bvid = str(data?.bvid);
  if (!data || !BV_ID.test(bvid)) return null;
  const pages = arr(data.pages).map(obj).filter((page): page is Json => page !== undefined);
  const page = pages.length > 0 ? pages.find((p) => num(p.page) === part) : undefined;
  if (pages.length > 0 ? !page : part !== 1) return null;
  const cid = num(page?.cid) || num(data.cid);
  if (!cid) return null;
  const title = str(data.title);
  const partName = pages.length > 1 ? str(page?.part) : '';
  return {
    bvid,
    aid: num(data.aid),
    title: partName ? `${title} (P${part} ${partName})` : title,
    owner: str(obj(data.owner)?.name),
    pubdate: num(data.pubdate),
    desc: str(data.desc),
    durationS: num(page?.duration) || num(data.duration),
    cid,
    part,
    cover: httpsCover(str(data.pic)),
  };
}

function flagged(value: unknown): boolean {
  return value === true || (typeof value === 'number' && value !== 0);
}

/**
 * A video only paying viewers or the uploader's paying supporters see in full: `rights.pay`,
 * `ugc_pay` or `arc_pay`, a paid collection (`is_chargeable_season`) or supporters only
 * (`is_upower_exclusive`).
 */
export function isPaidVideo(raw: unknown): boolean {
  const data = obj(raw);
  const rights = obj(data?.rights);
  return flagged(rights?.pay) || flagged(rights?.ugc_pay) || flagged(rights?.arc_pay)
    || flagged(data?.is_chargeable_season) || flagged(data?.is_upower_exclusive);
}

/** A `playurl` answer for a short trial clip instead of the video (a free video's has no `is_preview`). */
export function isPreviewPlayurl(playurl: unknown): boolean {
  return flagged(obj(obj(playurl)?.data)?.is_preview);
}

/** What bilibili's video-info API code says about a page that showed no video. */
export type BilibiliMissing = 'notFound' | 'hidden' | 'unknown';

/**
 * `-404` (and `-400`, a malformed id) is gone; `62002` hidden, `62004` under review, `62012` seen
 * only by its uploader, `-403` not open to this visitor: all "not visible".
 */
export function missingReason(code: number | null): BilibiliMissing {
  if (code === -404 || code === -400) return 'notFound';
  if (code === 62002 || code === 62004 || code === 62012 || code === -403) return 'hidden';
  return 'unknown';
}

/**
 * Lines and frame rate by bilibili's quality number (`qn`). The label comes from it, never from
 * the stream's height: a wide "480P" stream is 426 lines tall, and a portrait one taller than wide.
 */
const QN_LINES: Readonly<Record<number, readonly [lines: number, fps?: number]>> = {
  6: [240],
  16: [360],
  32: [480],
  64: [720],
  74: [720, 60],
  80: [1080],
  112: [1080],
  116: [1080, 60],
  120: [2160],
  125: [2160],
  126: [2160],
  127: [4320],
};

/** The lines of a `qn` this table does not know, from the player's own name for it (`1080P …`). */
function linesFromDescription(qn: number, formats: readonly Json[]): readonly [number, number?] | null {
  const format = formats.find((f) => num(f.quality) === qn);
  const match = /(\d{3,4})P(\d{2})?/i.exec(str(format?.new_description) || str(format?.display_desc));
  return match ? [Number(match[1]), match[2] ? Number(match[2]) : undefined] : null;
}

interface Stream {
  lines: number;
  fps: number;
  width: number;
  height: number;
  bandwidth: number;
}

/** The code a bilibili API answer carries: 0 when it answered (`playurl` with streams). */
export function apiCode(answer: unknown): number | null {
  const code = obj(answer)?.code;
  return typeof code === 'number' ? code : null;
}

const SMALL_LINES = 360;

/**
 * The qualities a `playurl` answer actually streams in H.264 (`avc1`), smallest first: only
 * `dash.video[]` counts, `accept_quality` and `quality` list more than is given. Size is the
 * stream's bitrate × `timelength` (ms; the rounded `dash.duration` is ~1% off on a short video)
 * for the H.264 stream plus the best audio (what the download takes); for Telegram, a quality that
 * fits `limitBytes` only with the low AAC listed (`LOW_AAC_MAX_KBPS`, 30216) is priced with it (`withLowAudio`).
 * Every quality plays in Telegram: H.264 with AAC. Under 360p only with `includeSmall` or when
 * nothing larger exists.
 */
export function bilibiliChoices(
  playurl: unknown,
  includeSmall = false,
  durationS = 0,
  destination: YtdlDestination = 'local',
  limitBytes?: SizeLimit,
): YtdlChoice[] {
  const data = obj(obj(playurl)?.data);
  const dash = obj(data?.dash);
  const formats = arr(data?.support_formats).map(obj).filter((f): f is Json => f !== undefined);
  const audios = arr(dash?.audio).map(obj).filter((a): a is Json => a !== undefined);
  const audioBandwidth = Math.max(0, ...audios.map((a) => num(a.bandwidth)));
  const aacBandwidths = audios.filter((a) => str(a.codecs).startsWith('mp4a')).map((a) => num(a.bandwidth));
  const aac = aacBandwidths.length > 0;
  // What yt-dlp's `ba` among the AAC at or under the cap picks: the largest of them.
  const lowBandwidths = aacBandwidths.filter((b) => b > 0 && b <= LOW_AAC_MAX_KBPS * 1_000);
  const lowBandwidth = lowBandwidths.length > 0 ? Math.max(...lowBandwidths) : null;
  const timelength = num(data?.timelength) || durationS * 1_000;
  const best = new Map<number, Stream>();
  for (const video of arr(dash?.video).map(obj)) {
    if (!video || !str(video.codecs).startsWith('avc1')) continue;
    const qn = num(video.id);
    const known = QN_LINES[qn] ?? linesFromDescription(qn, formats);
    if (!known) continue;
    const [lines, qnFps] = known;
    const fps = qnFps ?? Math.round(Number(str(video.frameRate) || str(video.frame_rate)) || 0);
    const stream: Stream = { lines, fps, width: num(video.width), height: num(video.height), bandwidth: num(video.bandwidth) };
    // Two numbers with the same lines (1080P and its high-bitrate twin): the larger stream is the
    // one a download at that quality gets.
    const held = best.get(lines);
    const kept = !held || stream.bandwidth > held.bandwidth ? stream : held;
    best.set(lines, { ...kept, fps: Math.max(stream.fps, held?.fps ?? 0) });
  }
  const bytes = (bandwidth: number, audio: number): number | null =>
    timelength > 0 && bandwidth > 0 ? Math.round(((bandwidth + audio) * timelength) / 1_000 / 8) : null;
  const choices: YtdlChoice[] = [...best.values()].map((stream) => withLowAudio({
    quality: stream.lines,
    label: stream.fps > 30 ? `${stream.lines}p${stream.fps}` : `${stream.lines}p`,
    sizeBytes: bytes(stream.bandwidth, audioBandwidth),
    portrait: stream.height > stream.width,
    telegramPlayable: aac,
  }, lowBandwidth === null ? null : bytes(stream.bandwidth, lowBandwidth), destination, limitBytes));
  choices.sort((a, b) => a.quality - b.quality);
  if (includeSmall) return choices;
  const large = choices.filter((c) => c.quality >= SMALL_LINES);
  return large.length > 0 ? large : choices;
}
