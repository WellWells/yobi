/**
 * `export_file`'s conversions (everything but an answer drawn as a card and one file printed as a
 * PDF): the files have been resolved and checked against the read sandbox by the caller; this
 * writes the result into the chat media folder under the run's name and hands back its path, which
 * the caller keeps for the answer like any made file.
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ExportFileRequest } from '../flow/agent/agentExportFile';
import { PICTURE_TYPES, PictureError, convertPicture } from '../convert/picture';
import type { PictureFormat } from '../convert/picture';
import { MEDIA_EXTENSIONS, MediaConvertError, extractSubtitles, mediaToMp3, srtForPlayers } from '../convert/media';
import { qrPng, zipFiles } from '../convert/archive';
import { FileToPdfError, picturesToPdf } from '../pdf/fileToPdf';
import { writeFileAtomic } from '../atomicWrite';

/** A conversion that cannot be made; the message is written for the model. */
export class ConversionRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConversionRefused';
  }
}

export interface ConversionOutput {
  /** Where the made file goes: the chat media folder, under a name unique to the run. */
  pathFor: (fileName: string) => string;
  signal?: AbortSignal;
}

const PICTURE_OUT: Readonly<Record<string, { format: PictureFormat; ext: string }>> = {
  png: { format: 'png', ext: '.png' },
  jpg: { format: 'jpeg', ext: '.jpg' },
  webp: { format: 'webp', ext: '.webp' },
};

/** A file name with no folder and nothing Windows refuses, for a name the model gave. */
export function safeStem(text: string, fallback: string): string {
  const stem = text.replace(/[\\/:*?"<>|\p{Cc}]+/gu, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 80);
  return stem || fallback;
}

function refusedFrom(err: unknown): never {
  if (err instanceof PictureError || err instanceof MediaConvertError || err instanceof FileToPdfError) throw new ConversionRefused(err.message);
  throw err;
}

async function convertOnePicture(file: string, request: ExportFileRequest, out: ConversionOutput): Promise<string> {
  const target = PICTURE_OUT[request.format];
  const mime = PICTURE_TYPES[path.extname(file).toLowerCase()];
  if (!mime) throw new ConversionRefused(`"${path.basename(file)}" is not a picture this app can convert (PNG, JPEG, WebP, GIF, BMP, AVIF, ICO and SVG can be).`);
  const made = await convertPicture(await fs.readFile(file), mime, {
    format: target.format,
    ...(request.crop ? { crop: request.crop } : {}),
    ...(request.width ? { width: request.width } : {}),
  }, out.signal).catch(refusedFrom);
  const suffix = request.crop ? '-crop' : '';
  const dest = out.pathFor(`${safeStem(request.title, path.parse(file).name)}${suffix}${target.ext}`);
  await writeFileAtomic(dest, made.data);
  return dest;
}

/** Makes the file `request` asks for from `files` (already checked readable), or from its text; returns its path. */
export async function convertForRun(request: ExportFileRequest, files: readonly string[], out: ConversionOutput): Promise<string> {
  const first = files[0] ?? '';
  switch (request.format) {
    case 'png':
    case 'jpg':
    case 'webp':
      return convertOnePicture(first, request, out);
    case 'pdf': {
      const pdf = await picturesToPdf(files, out.signal).catch(refusedFrom);
      const dest = out.pathFor(`${safeStem(request.title, path.parse(first).name)}.pdf`);
      await writeFileAtomic(dest, pdf);
      return dest;
    }
    case 'zip': {
      const zip = await zipFiles(files).catch((err: unknown) => {
        throw new ConversionRefused(err instanceof Error ? err.message : String(err));
      });
      const dest = out.pathFor(`${safeStem(request.title, files.length === 1 ? path.parse(first).name : 'files')}.zip`);
      await writeFileAtomic(dest, zip);
      return dest;
    }
    case 'mp3': {
      if (!MEDIA_EXTENSIONS.has(path.extname(first).toLowerCase())) {
        throw new ConversionRefused(`"${path.basename(first)}" is not a video or recording, so it has no sound to make an MP3 of.`);
      }
      const dest = out.pathFor(`${safeStem(request.title, path.parse(first).name)}.mp3`);
      await mediaToMp3(first, dest, out.signal).catch(refusedFrom);
      return dest;
    }
    case 'srt': {
      if (files.length === 0) {
        if (!request.content.includes('-->')) throw new ConversionRefused('"content" is not subtitles: write SRT blocks (number, "00:00:01,000 --> 00:00:03,000", text).');
        const dest = out.pathFor(`${safeStem(request.title, 'subtitles')}.srt`);
        await writeFileAtomic(dest, srtForPlayers(request.content));
        return dest;
      }
      if (!MEDIA_EXTENSIONS.has(path.extname(first).toLowerCase())) throw new ConversionRefused(`"${path.basename(first)}" is not a video.`);
      const dest = out.pathFor(`${safeStem(request.title, path.parse(first).name)}.srt`);
      await extractSubtitles(first, dest, request.track, out.signal).catch(refusedFrom);
      return dest;
    }
    case 'qr': {
      const png = await qrPng(request.content).catch((err: unknown) => {
        throw new ConversionRefused(err instanceof Error ? err.message : String(err));
      });
      const dest = out.pathFor(`${safeStem(request.title, 'qr-code')}.png`);
      await writeFileAtomic(dest, png);
      return dest;
    }
  }
}
