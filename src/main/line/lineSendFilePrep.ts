/**
 * Checking the files of a send before anything is sent. Each must be a readable, non-empty regular
 * file within LINE's 1 GB limit; unless `asFile`, a JPEG or PNG becomes a photo and an MP4 a video,
 * each with a preview, and one that cannot be goes as a file with a note.
 */
import { stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { LineError } from './errors';
import { jpegGPSRangesOf } from './lineExifGps';
import { hashFile } from './lineMediaFiles';
import { goQuote } from './lineGoText';
import { makePhoto, makeVideo, photoExt, videoExt, type ImageCodec } from './linePhoto';
import { CONTENT_FILE, CONTENT_IMAGE, CONTENT_VIDEO } from './lineSendText';

/** LINE's per-file limit (1 GB). */
export const MAX_SEND_FILE_BYTES = 1 << 30;
/** How many files LINE sends at a time. */
export const MAX_SEND_FILES = 50;
// LINE sends a larger photo or video as a file.
const MAX_PHOTO_BYTES = 20 << 20;
const MAX_VIDEO_BYTES = 200 << 20;

/** One file of a send and what happened to it; keys in line-cli's order. */
export interface FileSend {
  path: string;
  name: string;
  kind: 'file' | 'image' | 'video';
  bytes: number;
  sha256: string;
  /** A video's length. */
  duration_ms?: number;
  /** The JPEG's location (EXIF GPS data) was blanked in what was sent; the file on disk is unchanged. */
  gps_removed?: boolean;
  width?: number;
  height?: number;
  /** planned (dry run), sent, failed, or not_sent (an earlier file failed, so this one was not tried). */
  status: string;
  verified?: boolean;
  server_message_id?: string;
  sent_at?: string;
  expires_at?: string;
  error?: string;
}

/** A checked file ready to send. */
export interface PreparedFile {
  file: FileSend;
  contentType: number;
  ext: string;
  /** JPEG preview of a photo or video. */
  preview: Buffer | null;
}

// A lone UTF-16 surrogate: a Windows file name that is not valid UTF-8.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export function humanBytes(n: number): string {
  if (n >= 1 << 30) return `${(n / (1 << 30)).toFixed(1)} GB`;
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MB`;
  if (n >= 1 << 10) return `${(n / (1 << 10)).toFixed(1)} KB`;
  return `${n} bytes`;
}

function bad(message: string): LineError {
  return new LineError('INVALID_ARGUMENT', message);
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}


/** Checks one file (prepareFile); throws INVALID_ARGUMENT when it cannot be sent at all. */
export async function prepareFile(path: string, asFile: boolean, codec: ImageCodec, notify: (note: string) => void): Promise<PreparedFile> {
  if (path === '') throw bad('file needs a path');
  const abs = resolve(path);
  let size: number;
  try {
    const st = await stat(abs);
    if (!st.isFile()) throw bad(`${goQuote(path)} is not a regular file`);
    size = st.size;
  } catch (err) {
    if (err instanceof LineError) throw err;
    throw bad(`cannot read file ${goQuote(path)}: ${errText(err)}`);
  }
  const name = basename(abs);
  if (size === 0) throw bad(`${goQuote(path)} is empty; LINE does not send empty files`);
  if (size > MAX_SEND_FILE_BYTES) throw bad(`${goQuote(path)} is ${humanBytes(size)}; LINE's limit is 1 GB per file`);
  if (LONE_SURROGATE.test(name)) throw bad(`the file name of ${goQuote(path)} is not valid UTF-8`);
  let hashed: { sha256: string; bytes: number };
  let hasGps: boolean;
  try {
    hashed = await hashFile(abs);
    // The native core zeroes a JPEG's location on upload; this only reports that it will.
    hasGps = (await jpegGPSRangesOf(abs)).length > 0;
  } catch (err) {
    throw bad(`cannot read file ${goQuote(path)}: ${errText(err)}`);
  }
  if (hashed.bytes !== size) throw bad(`${goQuote(path)} changed while it was being read; try again`);
  const j: PreparedFile = {
    file: { path: abs, name, kind: 'file', bytes: size, sha256: hashed.sha256, ...(hasGps ? { gps_removed: true } : {}), status: '' },
    contentType: CONTENT_FILE,
    ext: '',
    preview: null,
  };
  const ext = (/\.([^.\\/]*)$/.exec(name)?.[1] ?? '').toLowerCase();
  if (asFile) return j;
  if (videoExt(ext)) {
    if (size > MAX_VIDEO_BYTES) {
      notify(`note: ${name} is larger than ${humanBytes(MAX_VIDEO_BYTES)}, so it goes as a file, not a video, as LINE does`);
      return j;
    }
    try {
      const v = await makeVideo(abs, codec);
      return { ...j, file: { ...j.file, kind: 'video', duration_ms: v.durationMs }, contentType: CONTENT_VIDEO, ext, preview: v.preview };
    } catch (err) {
      notify(`note: ${name} goes as a file, not a video: ${errText(err)}`);
      return j;
    }
  }
  if (!photoExt(ext)) return j;
  if (size > MAX_PHOTO_BYTES) {
    notify(`note: ${name} is larger than ${humanBytes(MAX_PHOTO_BYTES)}, so it goes as a file, not a photo, as LINE does`);
    return j;
  }
  try {
    const img = await makePhoto(abs, ext, codec);
    return { ...j, file: { ...j.file, kind: 'image', width: img.width, height: img.height }, contentType: CONTENT_IMAGE, ext, preview: img.preview };
  } catch (err) {
    notify(`note: ${name} goes as a file, not a photo: ${errText(err)}`);
    return j;
  }
}

/**
 * Checks every file before anything is sent (PrepareFiles): at most 50, each sendable, and no
 * file given twice unless `allowDuplicate`.
 */
export async function prepareFiles(paths: readonly string[], asFile: boolean, allowDuplicate: boolean, codec: ImageCodec, notify: (note: string) => void = () => undefined): Promise<PreparedFile[]> {
  if (paths.length === 0) throw bad('no files to send');
  if (paths.length > MAX_SEND_FILES) throw bad(`too many files: ${paths.length} (limit ${MAX_SEND_FILES} per send); split them into several sends`);
  const seen = new Map<string, string>();
  const jobs: PreparedFile[] = [];
  for (const p of paths) {
    const j = await prepareFile(p, asFile, codec, notify);
    const prev = seen.get(j.file.sha256);
    if (prev !== undefined && !allowDuplicate) {
      throw bad(`the same file is given twice (${prev} and ${p}); add allow_duplicate only if you mean to send it twice`);
    }
    seen.set(j.file.sha256, p);
    jobs.push(j);
  }
  return jobs;
}
