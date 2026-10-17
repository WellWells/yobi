import { arr, num, obj, str } from './jsonPick';
import type { Json } from './jsonPick';
import { httpsCover } from './bilibiliParse';

/*
 * A bilibili video's subtitles, the words a summary is made of: the player's subtitle list, then the
 * chosen track's JSON. Never the danmaku (bullet comments): they are not the video's words.
 */

/** One subtitle track the list offers: a person's (CC) or bilibili's machine one (AI). */
export interface SubtitleTrack {
  /** bilibili's language code: `zh-CN`, `zh-Hant`, `en-US`, `ai-zh`, `ai-en`… */
  lan: string;
  /** The language as the player names it; falls back to `lan`. */
  name: string;
  ai: boolean;
  /** An https URL on bilibili's file host (`*.hdslb.com`). */
  url: string;
}

/** What the subtitle list says. `signedIn` is null when it could not be read at all. */
export interface SubtitleList {
  signedIn: boolean | null;
  tracks: SubtitleTrack[];
}

/** The list endpoint for one part (`cid`) of a video. */
export function playerInfoUrl(bvid: string, cid: number): string {
  return `https://api.bilibili.com/x/player/v2?bvid=${bvid}&cid=${cid}`;
}

const FILE_HOST = /(^|\.)hdslb\.com$/i;

/** A track's file, made https; "" for anything but bilibili's own file host. */
export function subtitleFileUrl(raw: string): string {
  const url = httpsCover(raw);
  if (!url) return '';
  try {
    return FILE_HOST.test(new URL(url).hostname) ? url : '';
  } catch {
    return '';
  }
}

/**
 * The player's answer read: who it saw (`login_mid` is 0 for a visitor) and every track it gave a
 * file for. An answer that is not code 0 says nothing about either.
 */
export function readSubtitleList(answer: unknown): SubtitleList {
  const root = obj(answer);
  if (root?.code !== 0) return { signedIn: null, tracks: [] };
  const data = obj(root.data);
  const tracks: SubtitleTrack[] = [];
  for (const raw of arr(obj(data?.subtitle)?.subtitles).map(obj)) {
    if (!raw) continue;
    const url = subtitleFileUrl(str(raw.subtitle_url));
    const lan = str(raw.lan);
    if (!url || !lan) continue;
    tracks.push({ lan, name: str(raw.lan_doc) || lan, ai: lan.startsWith('ai-') || num(raw.type) === 1, url });
  }
  return { signedIn: num(data?.login_mid) > 0, tracks };
}

/** The video a subtitle list was asked for: its `aid` and the part's `cid`. */
export interface SubtitleOwner {
  aid: number;
  cid: number;
}

/**
 * Whose words a track's file holds, as far as its name tells: a machine (AI) track's file is named
 * after its video (`/bfs/ai_subtitle/…/<aid><cid><hash>.json`); any other file carries no ids and
 * is `unknown` and trusted. `other` = another video's, which the list sometimes hands out.
 */
export function trackOwner(track: SubtitleTrack, video: SubtitleOwner): 'match' | 'other' | 'unknown' {
  if (!(video.aid > 0) || !(video.cid > 0)) return 'unknown';
  let path: string;
  try {
    path = new URL(track.url).pathname;
  } catch {
    return 'unknown';
  }
  if (!path.includes('/ai_subtitle/')) return 'unknown';
  const name = path.slice(path.lastIndexOf('/') + 1);
  return name.startsWith(`${video.aid}${video.cid}`) ? 'match' : 'other';
}

/** The tracks that may be this video's, apart from the ones named after another video. */
export function tracksOfVideo(tracks: readonly SubtitleTrack[], video: SubtitleOwner): { own: SubtitleTrack[]; foreign: SubtitleTrack[] } {
  const own: SubtitleTrack[] = [];
  const foreign: SubtitleTrack[] = [];
  for (const track of tracks) (trackOwner(track, video) === 'other' ? foreign : own).push(track);
  return { own, foreign };
}

function isChinese(track: SubtitleTrack): boolean {
  return /^(ai-)?zh\b/i.test(track.lan);
}

/**
 * The track a summary reads: a person's Chinese subtitles first, then bilibili's machine Chinese
 * (`ai-zh`), then a person's in any language, then any. Null when there is none.
 */
export function pickSubtitle(tracks: readonly SubtitleTrack[]): SubtitleTrack | null {
  return tracks.find((t) => !t.ai && isChinese(t))
    ?? tracks.find((t) => t.ai && isChinese(t))
    ?? tracks.find((t) => !t.ai)
    ?? tracks[0]
    ?? null;
}

/**
 * A subtitle file (`{ body: [{ from, to, content }] }`) as plain text, one line per caption in
 * time order; a caption repeated across lines (a held line split in two) is kept once.
 */
export function subtitleText(file: unknown): string {
  const lines = arr(obj(file)?.body)
    .map(obj)
    .filter((line): line is Json => line !== undefined)
    .sort((a, b) => num(a.from) - num(b.from))
    .map((line) => str(line.content).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return lines.filter((line, index) => line !== lines[index - 1]).join('\n');
}
