/**
 * A video's or a recording's sound as an MP3, and a video's own subtitle track as an .srt, for
 * `export_file`: both by the FFmpeg Yobi already uses for downloads (Settings › downloads; the
 * user's own copy when they pointed Yobi at one). No new program, and nothing goes online.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawnTool, toolEnv } from '../managedTools/processTree';
import { resolveYtdlTools } from '../youtubeDownload/toolState';
import { AudioExtractError, extractMp3 } from '../downloader/extractAudio';
import { writeFileAtomic } from '../atomicWrite';

/** A file this module cannot convert; the message is written for the model. */
export class MediaConvertError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaConvertError';
  }
}

/**
 * One bitrate for every chat: Telegram's 128 kbps (its Bot API sends up to 50 MB, about 55
 * minutes at this rate), which is also plenty for speech and phone listening.
 */
export const CONVERT_MP3_KBPS = 128;
const PROBE_TIMEOUT_MS = 60_000;
const SUBTITLE_TIMEOUT_MS = 5 * 60_000;

export const MEDIA_EXTENSIONS: ReadonlySet<string> = new Set([
  '.mp4', '.m4v', '.mov', '.mkv', '.webm', '.avi', '.wmv', '.flv', '.ts', '.mts', '.m2ts', '.3gp', '.mpg', '.mpeg',
  '.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.oga', '.opus', '.wma', '.amr',
]);

const FFMPEG_MISSING = 'FFmpeg is not installed, so sound and subtitles cannot be taken out of a video here. Tell the user to install it in Settings (the download tools), then ask again.';

export interface MediaDeps {
  spawn: typeof spawnTool;
  ffmpeg: () => Promise<string | null>;
  extractMp3: typeof extractMp3;
}

const defaultDeps: MediaDeps = {
  spawn: spawnTool,
  ffmpeg: async () => (await resolveYtdlTools())?.ffmpeg ?? null,
  extractMp3,
};

/** `file`'s sound as an MP3 at `output`, tagged with the file's name. */
export async function mediaToMp3(file: string, output: string, signal?: AbortSignal, deps: MediaDeps = defaultDeps): Promise<void> {
  if (!(await deps.ffmpeg())) throw new MediaConvertError(FFMPEG_MISSING);
  try {
    await deps.extractMp3(file, output, CONVERT_MP3_KBPS, { title: path.parse(file).name, artist: '' }, signal);
  } catch (err) {
    if (err instanceof AudioExtractError) {
      throw new MediaConvertError(`No MP3 could be made from "${path.basename(file)}" (it may have no sound, or not be a video or recording). Tell the user.`);
    }
    throw err;
  }
}

export interface SubtitleTrack {
  /** Its place among the file's subtitle tracks, from 0 (FFmpeg's `0:s:N`). */
  index: number;
  /** ISO 639-2 as the file says it ("eng", "chi"), '' when unsaid. */
  language: string;
  codec: string;
  title: string;
}

/** Subtitle formats FFmpeg can write as text; pictures of text (Blu-ray, DVD, DVB) cannot be. */
const TEXT_CODECS: ReadonlySet<string> = new Set(['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text', 'microdvd', 'subviewer', 'subviewer1', 'mpl2', 'jacosub', 'realtext', 'sami', 'stl', 'vplayer', 'pjs']);

/** The subtitle tracks `ffmpeg -i` lists, in file order. */
export function subtitleTracksOf(stderr: string): SubtitleTrack[] {
  const tracks: SubtitleTrack[] = [];
  const lines = stderr.split(/\r?\n/);
  lines.forEach((line, at) => {
    const found = /Stream #\d+:\d+(?:\[[^\]]*\])?(?:\(([A-Za-z-]+)\))?[^:]*: Subtitle: ([\w-]+)/.exec(line);
    if (!found) return;
    // The track's title, when it has one, is in the metadata lines right under the stream line.
    let title = '';
    for (let next = at + 1; next < lines.length && !/Stream #/.test(lines[next]); next++) {
      const named = /^\s+title\s*:\s*(.+)$/.exec(lines[next]);
      if (named) {
        title = named[1].trim();
        break;
      }
    }
    tracks.push({ index: tracks.length, language: (found[1] ?? '').toLowerCase(), codec: found[2].toLowerCase(), title });
  });
  return tracks;
}

const LANGUAGE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  en: ['eng', 'en', 'english'],
  zh: ['chi', 'zho', 'zh', 'chinese', 'cht', 'chs', 'zh-tw', 'zh-hant', 'zh-cn', 'zh-hans'],
  ja: ['jpn', 'ja', 'japanese'],
  ko: ['kor', 'ko', 'korean'],
  fr: ['fre', 'fra', 'fr', 'french'],
  de: ['ger', 'deu', 'de', 'german'],
  es: ['spa', 'es', 'spanish'],
};

function languageKey(text: string): string {
  const lower = text.trim().toLowerCase();
  return Object.entries(LANGUAGE_ALIASES).find(([, names]) => names.includes(lower))?.[0] ?? lower;
}

/** The track asked for: '' = the first text track, a number = that track (from 1), else a language. */
export function pickSubtitleTrack(tracks: readonly SubtitleTrack[], asked: string): SubtitleTrack | string {
  const listed = tracks.map((t) => `${t.index + 1}${t.language ? ` (${t.language})` : ''}${t.title ? ` "${t.title}"` : ''}${TEXT_CODECS.has(t.codec) ? '' : ' [picture subtitles]'}`).join(', ');
  if (tracks.length === 0) return 'This video has no subtitle track of its own. Tell the user; never write subtitles yourself and call them the video\'s.';
  const wanted = asked.trim();
  let track: SubtitleTrack | undefined;
  if (!wanted) track = tracks.find((t) => TEXT_CODECS.has(t.codec)) ?? tracks[0];
  else if (/^\d+$/.test(wanted)) track = tracks[Number(wanted) - 1];
  else track = tracks.find((t) => t.language && languageKey(t.language) === languageKey(wanted));
  if (!track) return `No subtitle track matches "${wanted}". The video's tracks: ${listed}. Set "track" to one of them.`;
  if (!TEXT_CODECS.has(track.codec)) {
    return `Track ${track.index + 1} holds subtitles as pictures (${track.codec}), which cannot be turned into text here. The video's tracks: ${listed}.`;
  }
  return track;
}

/** SRT text as Windows players read CJK right: UTF-8 BOM, CRLF line ends. */
export function srtForPlayers(text: string): string {
  return `﻿${text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim().replace(/\n/g, '\r\n')}\r\n`;
}

/** `file`'s subtitle track `asked` (see `pickSubtitleTrack`) as an .srt at `output`; returns the track used. */
export async function extractSubtitles(file: string, output: string, asked: string, signal?: AbortSignal, deps: MediaDeps = defaultDeps): Promise<SubtitleTrack> {
  const ffmpeg = await deps.ffmpeg();
  if (!ffmpeg) throw new MediaConvertError(FFMPEG_MISSING);
  // FFmpeg with an input and no output lists the streams and exits 1: the listing is what we want.
  const probe = await deps.spawn(ffmpeg, ['-hide_banner', '-i', file], { env: toolEnv(), signal, timeoutMs: PROBE_TIMEOUT_MS });
  if (probe.aborted || signal?.aborted) throw abortError();
  const picked = pickSubtitleTrack(subtitleTracksOf(probe.stderr), asked);
  if (typeof picked === 'string') throw new MediaConvertError(picked);
  const raw = `${output}.raw.srt`;
  try {
    const result = await deps.spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-map', `0:s:${picked.index}`, '-c:s', 'srt', raw], {
      env: toolEnv(), signal, timeoutMs: SUBTITLE_TIMEOUT_MS,
    });
    if (result.aborted || signal?.aborted) throw abortError();
    const text = result.code === 0 ? await fs.readFile(raw, 'utf8').catch(() => '') : '';
    if (!text.trim()) throw new MediaConvertError(`Subtitle track ${picked.index + 1} could not be taken out of "${path.basename(file)}". Tell the user.`);
    await writeFileAtomic(output, srtForPlayers(text));
    return picked;
  } finally {
    await fs.rm(raw, { force: true }).catch(() => undefined);
  }
}

function abortError(): Error {
  const err = new Error('Converting stopped');
  err.name = 'AbortError';
  return err;
}
