import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { sendLog } from '../helpers';
import { defaultMuxDeps, muxStreams } from './streamMux';
import type { StreamMuxDeps } from './streamMux';

/*
 * An MP4 whose index (`moov`) sits after the media (`mdat`) plays only once the whole file is
 * read: a player in a chat or a browser waits for the end, and seeking has nothing to go on. The
 * files saved as a site sent them (a post's mp4 from its CDN, a single file yt-dlp did not merge)
 * get the index moved to the front here with a stream copy (`muxStreams`, `+faststart`). A file
 * already in that order, a fragmented one, and anything that is not an MP4 are left alone; only
 * the top-level box headers are read to tell.
 */

/** Enough for any real file's top level (ftyp, free, mdat, moov, udta…); a longer run is not an MP4 we know. */
const MAX_TOP_BOXES = 64;
const BOX_HEADER_BYTES = 16;

export type Mp4Layout = 'faststart' | 'moov-at-end' | 'other';

/** Where the file's `moov` sits: before every `mdat`, after one, or `other` (not an MP4, fragmented, unreadable). */
export async function mp4Layout(file: string): Promise<Mp4Layout> {
  const handle = await fs.open(file, 'r');
  try {
    const { size } = await handle.stat();
    const header = Buffer.alloc(BOX_HEADER_BYTES);
    let pos = 0;
    let sawMdat = false;
    for (let index = 0; index < MAX_TOP_BOXES && pos + 8 <= size; index++) {
      const { bytesRead } = await handle.read(header, 0, BOX_HEADER_BYTES, pos);
      const type = header.toString('latin1', 4, 8);
      if (index === 0 && type !== 'ftyp') return 'other';
      if (type === 'moov') return sawMdat ? 'moov-at-end' : 'faststart';
      if (type === 'moof') return 'other';
      if (type === 'mdat') sawMdat = true;
      let length = header.readUInt32BE(0);
      if (length === 1) {
        if (bytesRead < BOX_HEADER_BYTES) return 'other';
        length = Number(header.readBigUInt64BE(8));
      } else if (length === 0) {
        // The box runs to the end of the file: nothing follows it.
        return 'other';
      }
      if (length < 8) return 'other';
      pos += length;
    }
    return 'other';
  } finally {
    await handle.close();
  }
}

/**
 * Moves `file`'s index to the front when it sits at the end; true when the file was rewritten.
 * A missing or failing FFmpeg keeps the file as downloaded (it still plays once fully read); a
 * Stop throws the error named AbortError that `muxStreams` throws.
 */
export async function ensureFaststart(
  file: string,
  signal?: AbortSignal,
  deps: StreamMuxDeps = defaultMuxDeps,
  log: (line: string) => void = sendLog,
): Promise<boolean> {
  const layout = await mp4Layout(file).catch((): Mp4Layout => 'other');
  if (layout !== 'moov-at-end') return false;
  try {
    await muxStreams('mp4', { video: file }, file, signal, deps);
    log(`⏩ [Media] moved the MP4 index to the front: ${path.basename(file)}`);
    return true;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    log(`⚠️ [Media] kept ${path.basename(file)} as downloaded; moving its index failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}
