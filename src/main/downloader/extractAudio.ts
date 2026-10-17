import * as fs from 'node:fs/promises';
import { spawnTool, toolEnv } from '../youtubeDownload/processTree';
import { resolveYtdlTools } from '../youtubeDownload/toolState';

/*
 * A video's sound as an MP3, by FFmpeg on a file already downloaded: the post sites' videos (X,
 * Threads, Instagram, Facebook, TikTok) come as progressive mp4s Yobi fetches itself, and the
 * segmented-stream sites' sound is fetched by `streamDownload.ts`, so no yt-dlp is involved. The MP3 carries the same things yt-dlp's `--embed-metadata --embed-thumbnail` give a
 * video row's MP3 — a title, an artist and a JPEG cover — so a phone's player (Telegram's included,
 * which reads the tags) shows what it is.
 */

export interface Mp3Tags {
  title: string;
  artist: string;
  /** A picture file to embed as the cover; any format FFmpeg reads, written as a JPEG. */
  cover?: string;
}

export interface ExtractAudioDeps {
  spawn: typeof spawnTool;
  ffmpeg: () => Promise<string | null>;
}

const defaultDeps: ExtractAudioDeps = {
  spawn: spawnTool,
  ffmpeg: async () => (await resolveYtdlTools())?.ffmpeg ?? null,
};

/** A few minutes of video convert in seconds; this only stops a stuck FFmpeg. */
const EXTRACT_TIMEOUT_MS = 10 * 60_000;
/** What a phone's player shows in one line; longer post text is cut. */
const TAG_MAX_CHARS = 120;

/** One line for a tag: no line breaks or control characters, cut to what a player shows. */
export function tagText(text: string): string {
  const line = text.replace(/\p{Cc}+/gu, ' ').replace(/\s+/g, ' ').trim();
  const chars = Array.from(line);
  return chars.length > TAG_MAX_CHARS ? `${chars.slice(0, TAG_MAX_CHARS - 1).join('')}…` : line;
}

/**
 * The FFmpeg arguments for one MP3: the first sound stream at `bitrateKbps`, the input's own
 * metadata dropped for Yobi's title and artist (ID3v2.3, what most players read), and the cover,
 * when given, as the attached picture. Every value is its own argument: no shell, nothing parsed.
 */
export function mp3ExtractArgs(input: string, output: string, bitrateKbps: number, tags: Mp3Tags): string[] {
  if (!Number.isInteger(bitrateKbps) || bitrateKbps < 32 || bitrateKbps > 320) throw new Error(`invalid MP3 bitrate ${bitrateKbps}`);
  const cover = tags.cover
    ? ['-map', '1:v:0', '-c:v', 'mjpeg', '-disposition:v:0', 'attached_pic', '-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)']
    : [];
  const title = tagText(tags.title);
  const artist = tagText(tags.artist);
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', input,
    ...(tags.cover ? ['-i', tags.cover] : []),
    '-map', '0:a:0',
    ...cover,
    '-c:a', 'libmp3lame', '-b:a', `${bitrateKbps}k`,
    '-map_metadata', '-1',
    '-id3v2_version', '3',
    ...(title ? ['-metadata', `title=${title}`] : []),
    ...(artist ? ['-metadata', `artist=${artist}`] : []),
    output,
  ];
}

/** Why an MP3 could not be made; the message is FFmpeg's own last words, for the log. */
export class AudioExtractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AudioExtractError';
  }
}

/** The last non-empty line FFmpeg printed, for a log line. */
function lastLine(text: string): string {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1) ?? '';
}

async function nonEmpty(file: string): Promise<boolean> {
  return fs.stat(file).then((stat) => stat.isFile() && stat.size > 0, () => false);
}

function stopped(): Error {
  const err = new Error('Converting to MP3 stopped');
  err.name = 'AbortError';
  return err;
}

/**
 * Writes `output`, the MP3 of `input`'s sound. A cover FFmpeg cannot read does not cost the MP3:
 * it is tried once more without one. Throws `AudioExtractError` when FFmpeg is missing or fails
 * (a video without sound included), and an error named AbortError when `signal` stops it.
 */
export async function extractMp3(
  input: string,
  output: string,
  bitrateKbps: number,
  tags: Mp3Tags,
  signal?: AbortSignal,
  deps: ExtractAudioDeps = defaultDeps,
): Promise<void> {
  const ffmpeg = await deps.ffmpeg();
  if (!ffmpeg) throw new AudioExtractError('FFmpeg is not installed');
  const attempts: Mp3Tags[] = tags.cover ? [tags, { title: tags.title, artist: tags.artist }] : [tags];
  let reason = '';
  for (const attempt of attempts) {
    const result = await deps.spawn(ffmpeg, mp3ExtractArgs(input, output, bitrateKbps, attempt), {
      env: toolEnv(),
      signal,
      timeoutMs: EXTRACT_TIMEOUT_MS,
    });
    if (result.aborted || signal?.aborted) {
      await fs.rm(output, { force: true }).catch(() => {});
      throw stopped();
    }
    if (result.code === 0 && (await nonEmpty(output))) return;
    await fs.rm(output, { force: true }).catch(() => {});
    reason = result.timedOut ? 'FFmpeg timed out' : lastLine(result.stderr) || `FFmpeg exited with ${String(result.code)}`;
  }
  throw new AudioExtractError(reason);
}
