import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawnTool, toolEnv } from '../youtubeDownload/processTree';
import { resolveYtdlTools } from '../youtubeDownload/toolState';

/*
 * Putting fetched streams into the file a person gets, with the managed FFmpeg: separate video
 * and audio (or a progressive file) copied into one MP4 with its index in front (`+faststart`,
 * so a phone starts playing before the end arrives), or a sound stream copied into an M4A.
 * Nothing is re-encoded here; an MP3 is `extractMp3` (`extractAudio.ts`). Every value is its own
 * argument: no shell, nothing parsed.
 */

export interface StreamMuxDeps {
  spawn: typeof spawnTool;
  ffmpeg: () => Promise<string | null>;
}

export const defaultMuxDeps: StreamMuxDeps = {
  spawn: spawnTool,
  ffmpeg: async () => (await resolveYtdlTools())?.ffmpeg ?? null,
};

/** Copying streams is quick; this only stops a stuck FFmpeg. */
const MUX_TIMEOUT_MS = 30 * 60_000;

export type MuxTarget = 'mp4' | 'm4a';

/**
 * FFmpeg's arguments: for `mp4`, the first video stream of `video` and the first audio stream of
 * `audio` (or of `video` itself, if it has one, when there is no separate audio); for `m4a`, the
 * first audio stream of `audio`. Written as MP4 (`-f mp4`), whatever `output` is named.
 */
export function muxArgs(target: MuxTarget, inputs: { video?: string; audio?: string }, output: string): string[] {
  const head = ['-hide_banner', '-loglevel', 'error', '-y'];
  const tail = ['-c', 'copy', '-movflags', '+faststart', '-f', 'mp4', output];
  if (target === 'm4a') {
    if (!inputs.audio) throw new Error('an M4A needs an audio stream');
    return [...head, '-i', inputs.audio, '-map', '0:a:0', ...tail];
  }
  if (!inputs.video) throw new Error('an MP4 needs a video stream');
  if (inputs.audio) return [...head, '-i', inputs.video, '-i', inputs.audio, '-map', '0:v:0', '-map', '1:a:0', ...tail];
  // A progressive file carries its own sound, when it has any: `?` keeps a silent one working.
  return [...head, '-i', inputs.video, '-map', '0:v:0', '-map', '0:a:0?', ...tail];
}

/** Why FFmpeg could not put the file together; the message is FFmpeg's own last words, for the log. */
export class MuxError extends Error {
  constructor(message: string, readonly toolsMissing = false) {
    super(message);
    this.name = 'MuxError';
  }
}

function lastLine(text: string): string {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1) ?? '';
}

function stopped(): Error {
  const err = new Error('Putting the video together stopped');
  err.name = 'AbortError';
  return err;
}

/**
 * Writes `output` from the fetched streams, through a hidden temporary file next to it renamed
 * once FFmpeg succeeds. Throws `MuxError` (`toolsMissing` when there is no FFmpeg) or an error
 * named AbortError on Stop; no partial file is left either way.
 */
export async function muxStreams(
  target: MuxTarget,
  inputs: { video?: string; audio?: string },
  output: string,
  signal?: AbortSignal,
  deps: StreamMuxDeps = defaultMuxDeps,
): Promise<void> {
  const ffmpeg = await deps.ffmpeg();
  if (!ffmpeg) throw new MuxError('FFmpeg is not installed', true);
  const temp = path.join(path.dirname(output), `.${path.basename(output)}.${randomUUID()}.part`);
  try {
    const result = await deps.spawn(ffmpeg, muxArgs(target, inputs, temp), { env: toolEnv(), signal, timeoutMs: MUX_TIMEOUT_MS });
    if (result.aborted || signal?.aborted) throw stopped();
    const stat = await fs.stat(temp).catch(() => null);
    if (result.code !== 0 || !stat?.isFile() || stat.size <= 0) {
      throw new MuxError(result.timedOut ? 'FFmpeg timed out' : lastLine(result.stderr) || `FFmpeg exited with ${String(result.code)}`);
    }
    await fs.rename(temp, output);
  } finally {
    await fs.rm(temp, { force: true }).catch(() => {});
  }
}
