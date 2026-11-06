/**
 * File names for what line_download and line_preview save:
 * `<sent time>_<message id>_<safe file name>` for a named file, else `<sent time>_<message id><sniffed
 * ext>`, so attachments with one name in one second never share a name. Files are written with
 * writeFileAtomic (same-folder temp, then rename), so a failed write leaves no partial file.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join, parse, resolve } from 'node:path';
import { writeFileAtomic } from '../atomicWrite';
import { LineError } from './errors';

const RESERVED_CHARS = '<>:"|?*';

/** An error's text, with the cause Node's fetch hides behind "fetch failed". */
export function errorText(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: unknown }).cause;
  return cause instanceof Error && cause.message ? `${err.message} (${cause.message})` : err.message;
}

/** A file's SHA-256 and size, read in pieces: a file may be 1 GB. */
export async function hashFile(path: string): Promise<{ sha256: string; bytes: number }> {
  const h = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    h.update(chunk as Buffer);
    bytes += (chunk as Buffer).length;
  }
  return { sha256: h.digest('hex'), bytes };
}

/** Creates the save folder (absolute); a folder that cannot be made fails the whole call. */
export async function ensureOutputDir(dir: string): Promise<string> {
  const abs = resolve(dir);
  try {
    await mkdir(abs, { recursive: true });
  } catch (err) {
    throw new LineError('INVALID_ARGUMENT', `cannot create output directory: ${errorText(err)}`);
  }
  return abs;
}

/** Writes one decrypted file into `dir`; `failure` is '' on success, else the write_failed note. */
export async function writeMediaFile(dir: string, name: string, bytes: Buffer): Promise<{ path: string; failure: string }> {
  const path = join(dir, name);
  try {
    await writeFileAtomic(path, bytes);
    return { path, failure: '' };
  } catch (err) {
    return { path, failure: `write failed: ${errorText(err)}` };
  }
}

/**
 * A sender-supplied file name made safe to create on Windows: only the last path element, reserved
 * and control characters replaced with '_', trailing dots and spaces trimmed, and reserved device
 * names (CON, PRN, AUX, NUL, COM1-9, LPT1-9) prefixed with '_'. '' when nothing usable is left.
 */
export function safeFileName(raw: string): string {
  const cut = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\'));
  let name = cut >= 0 ? raw.slice(cut + 1) : raw;
  name = Array.from(name, (ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f || RESERVED_CHARS.includes(ch) ? '_' : ch;
  }).join('');
  name = name.replace(/[. ]+$/, '');
  if (!name) return '';
  const stem = name.split('.')[0].replace(/ +$/, '').toUpperCase();
  const device = stem === 'CON' || stem === 'PRN' || stem === 'AUX' || stem === 'NUL'
    || (stem.length === 4 && (stem.startsWith('COM') || stem.startsWith('LPT')) && stem[3] >= '1' && stem[3] <= '9');
  return device ? `_${name}` : name;
}

/** The extension of an image's first bytes; '.bin' for anything else (a zip-based .docx too). */
export function sniffExt(b: Buffer): string {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return '.jpg';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'))) return '.png';
  if (b.length >= 6 && ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('latin1'))) return '.gif';
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return '.webp';
  return '.bin';
}

// `2026-03-01T10:00:00+08:00` → `20260301-100000` (the wall time as sent_at shows it); anything
// else is used as it is.
function fileStamp(sentAt: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})[+-]\d{2}:\d{2}$/.exec(sentAt);
  return m ? `${m[1]}${m[2]}${m[3]}-${m[4]}${m[5]}${m[6]}` : sentAt;
}

/** A downloaded file's name: its own (made safe) when it has one, else the message id plus a sniffed extension. */
export function downloadFileName(sentAt: string, id: string, fileName: string, bytes: Buffer): string {
  const name = safeFileName(fileName);
  return name ? `${fileStamp(sentAt)}_${id}_${name}` : `${fileStamp(sentAt)}_${id}${sniffExt(bytes)}`;
}

/**
 * Moves a finished download from `temp` to `dst` and returns where it went. A file already at dst
 * is this message's earlier download, possibly changed since: it is kept as it is, reused when it
 * holds these bytes, and otherwise left alone beside a new "name (2).ext".
 */
export async function placeDownload(temp: string, dst: string): Promise<string> {
  const { dir, name, ext } = parse(dst);
  const fresh = await hashFile(temp);
  for (let n = 1; ; n++) {
    const path = n === 1 ? dst : join(dir, `${name} (${n})${ext}`);
    const size = await stat(path).then((s) => s.size, () => -1);
    if (size < 0) {
      await rename(temp, path);
      return path;
    }
    if (size === fresh.bytes && (await hashFile(path)).sha256 === fresh.sha256) {
      await rm(temp, { force: true });
      return path;
    }
  }
}

/** A preview's name: the send time and message id, with an extension sniffed from the image bytes. */
export function previewFileName(sentAt: string, id: string, bytes: Buffer): string {
  return `${fileStamp(sentAt)}_${id}${sniffExt(bytes)}`;
}
