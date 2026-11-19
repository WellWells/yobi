import { sendLog } from '../../helpers';
import { FlowAbortError } from '../runtime';
import { PICTURE_MAX_SIDE, readCropBox } from '../../convert/picture';
import type { CropBox } from '../../convert/picture';

/*
 * A bot answers with text alone; a file is made only when someone asks for one.
 * "Turn it into a PDF" makes the file of the answer it means, in the Card
 * style from Settings, sent with the run's answer. The same tool converts files
 * (a phone's photos zipped, a WebP as a JPEG, the item the model found cropped out, a
 * video's sound as MP3, its subtitles as .srt, a link as a QR code) — one tool, not one per
 * conversion: the catalog budget is tight and every one of them is "make me a file". The caller
 * renders and keeps the file; this module only reads the request and words the result.
 */

/** Where the file came from, for the observation. */
export type ExportSourceKind = 'content' | 'reply' | 'answer' | 'file';

export type ExportFormat = 'pdf' | 'png' | 'webp' | 'jpg' | 'zip' | 'mp3' | 'srt' | 'qr';

export type ExportedFile =
  | {
    /** The file's name, as the user receives it. */
    name: string;
    /** What it was made as: a PDF when the asked-for answer picture was past the height limit. */
    format: string;
    from: ExportSourceKind;
  }
  /** No text to make it from: the replied-to message has none, or the chat has no earlier answer. */
  | { missing: 'reply' | 'answer' }
  /** A "file" that may not be read or cannot be converted; the reason is written for the model. */
  | { refused: string };

export interface ExportFileRequest {
  format: ExportFormat;
  /** Markdown the model wrote for the file ('' = the replied-to message, else the chat's last answer); the text of a QR code or an .srt. */
  content: string;
  /** '' = the content's own leading heading, or none. */
  title: string;
  /** Files to convert instead (paths as the file tools read them); [] = make the file from text. */
  files: string[];
  /** Pictures: the area to keep. */
  crop?: CropBox;
  /** Pictures: the width to scale to. */
  width?: number;
  /** .srt from a video: which subtitle track ('' = the first). */
  track: string;
}

export type ExportFile = (request: ExportFileRequest) => Promise<ExportedFile>;

/** A file or two and a redo; a run that keeps exporting is not converging. */
export const MAX_EXPORT_CALLS_PER_RUN = 3;

/**
 * What the catalog lists for a run whose answer can carry a file: a tier-1 brief, the full
 * `EXPORT_FILE_LINE` from `tool_help`. The brief keeps what a first call needs: that only this
 * tool's file reaches the user, what it can make, and that leaving "content" out means the answer
 * already given. Kept within the catalog budget.
 */
export const EXPORT_FILE_BRIEF = '- "export_file": Send the user a FILE when asked: an answer as PDF/PNG/WebP (omit "content" for the replied-to message, else the last answer), or "file"(s) converted: PDF, picture format/crop/size, zip, MP3 or .srt from video, QR code. config: "format" (REQUIRED). [+opts]';

export const EXPORT_FILE_LINE = '- "export_file": Make a FILE the user receives when they ask to convert, export or download something. You cannot attach files yourself: only the file this tool makes reaches the user, sent with your answer. config keys: "format" (REQUIRED: "pdf", "png", "webp", "jpg", "zip", "mp3", "srt" or "qr"), "content" (Markdown for an answer file, drawn in their card style — omit it to use the message the user replied to, else the last answer in this chat; write it only for something new, such as a table they asked for. For "qr": the text or link to encode. For "srt": subtitles you wrote, such as a translation), "title" (omit to use the content\'s own heading), "file" (files to convert instead, named as the file tools read them; several as a JSON array. "pdf": a Word/Excel/PowerPoint file, web page, .md, text or picture, or several pictures one per page; "png"/"jpg"/"webp": one picture in that format; "zip": all of them in one archive; "mp3": a video\'s or recording\'s sound; "srt": a video\'s own subtitle track), "crop" (pictures: "left,top,right,bottom" of the area to keep, in thousandths of the picture\'s width and height, 0-1000 — look at the picture to place it), "width" (pictures: pixels, proportions kept), "track" (srt from a video: track number or language; default the first) → returns: the file attached.';

const FORMATS: Readonly<Record<string, ExportFormat>> = {
  pdf: 'pdf',
  png: 'png',
  webp: 'webp',
  jpg: 'jpg',
  jpeg: 'jpg',
  image: 'png',
  picture: 'png',
  zip: 'zip',
  mp3: 'mp3',
  audio: 'mp3',
  srt: 'srt',
  subtitles: 'srt',
  qr: 'qr',
  qrcode: 'qr',
  'qr code': 'qr',
};

export function readExportFormat(value: string | undefined): ExportFormat | null {
  return FORMATS[(value ?? '').trim().toLowerCase().replace(/^\./, '').replace(/[-_]/g, ' ')] ?? null;
}

/**
 * The files named in "file": one path, a JSON array (what a model's array arrives as), or paths
 * one per line or between "|" — characters no file name holds.
 */
export function readExportFiles(value: string | undefined): string[] {
  const text = (value ?? '').trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map((item) => String(item ?? '').trim()).filter(Boolean);
    } catch {
      // Not JSON after all: read it as written.
    }
  }
  return text.split(/[\r\n|]+/).map((part) => part.trim()).filter(Boolean);
}

const PICTURE_FORMATS: ReadonlySet<ExportFormat> = new Set(['png', 'webp', 'jpg']);

/** Why this request cannot be made as asked, for the model; null = it can. */
export function exportRequestProblem(request: ExportFileRequest): string | null {
  const { format, files, content } = request;
  const count = files.length;
  const picture = PICTURE_FORMATS.has(format) && count > 0;
  if ((request.crop || request.width) && !picture) return '"crop" and "width" are for converting one picture: set "file" to it and "format" to "png", "jpg" or "webp".';
  if (PICTURE_FORMATS.has(format) && count > 1) return `"${format}" makes one picture: convert one file per call, or use "zip" or "pdf" for several.`;
  if (format === 'zip' && count === 0) return '"zip" needs "file": the files to put in it.';
  if (format === 'mp3' && count !== 1) return '"mp3" needs "file": the one video or recording to take the sound from.';
  if (format === 'srt' && count > 1) return '"srt" takes one video at a time.';
  if (format === 'srt' && count === 0 && !content) return '"srt" needs "file" (a video with subtitles) or "content" (the subtitles you wrote, in SRT form).';
  if (format === 'qr' && count > 0) return '"qr" encodes text: put the text or link in "content", not "file".';
  if (format === 'qr' && !content) return '"qr" needs "content": the text or link to encode.';
  return null;
}

const SOURCE_TEXT: Record<ExportSourceKind, string> = {
  content: 'the content you wrote',
  reply: 'the message the user replied to',
  answer: 'the last answer in this chat',
  file: 'the file you named',
};

/** The observation for one export: the file attached, or why there is none. */
export function exportObservation(result: ExportedFile, asked: ExportFormat): { observation: string; status: 'ok' | 'error' } {
  if ('refused' in result) {
    return { observation: `ERROR: ${result.refused} No file was made; never describe one as sent.`, status: 'error' };
  }
  if ('missing' in result) {
    return result.missing === 'reply'
      ? {
        observation: 'ERROR: The message the user replied to has no text to put in a file (it is a picture, a sticker or a file). Tell the user; never describe a file as sent.',
        status: 'error',
      }
      : {
        observation: 'ERROR: This chat has no earlier answer to put in a file. Write what the file should hold in "content", or ask the user which text they mean.',
        status: 'error',
      };
  }
  const switched = result.format === 'pdf' && asked !== 'pdf'
    ? ` It was too long for one ${asked.toUpperCase()} picture, so it is a PDF — tell the user.`
    : '';
  // A made .srt is read back by name to translate it; every other file only goes out.
  const readable = result.format === 'srt' ? ` The file tools read it as "chat-media/${result.name}".` : '';
  return {
    observation: `Attached "${result.name}", made from ${SOURCE_TEXT[result.from]}.${switched}${readable} It goes out with your answer by itself — no links, no paths. In "finish", say in one short sentence what the file holds; do not repeat its text.`,
    status: 'ok',
  };
}

export interface ExportContext {
  exportFile?: ExportFile;
  /** Files this run has made; counted here. */
  exportCalls?: number;
  signal?: AbortSignal;
}

function readWidth(value: string | undefined): number | undefined | string {
  const text = (value ?? '').trim().replace(/px$/i, '');
  if (!text) return undefined;
  const width = Number(text);
  return Number.isInteger(width) && width >= 1 && width <= PICTURE_MAX_SIDE
    ? width
    : `"width" must be a whole number of pixels from 1 to ${PICTURE_MAX_SIDE}.`;
}

export async function runExportFile(
  config: Record<string, string>,
  ctx: ExportContext,
): Promise<{ observation: string; status: 'ok' | 'error' }> {
  const format = readExportFormat(config.format);
  if (!format) return { observation: 'ERROR: "format" must be "pdf", "png", "webp", "jpg", "zip", "mp3", "srt" or "qr".', status: 'error' };
  if (!ctx.exportFile) {
    return {
      observation: 'ERROR: Files cannot be sent here. Tell the user this chat cannot receive the file — never describe one as sent.',
      status: 'error',
    };
  }
  const crop = (config.crop ?? '').trim() ? readCropBox(config.crop) : undefined;
  if (typeof crop === 'string') return { observation: `ERROR: ${crop}`, status: 'error' };
  const width = readWidth(config.width);
  if (typeof width === 'string') return { observation: `ERROR: ${width}`, status: 'error' };
  const request: ExportFileRequest = {
    format,
    content: (config.content ?? '').trim(),
    title: (config.title ?? '').trim(),
    files: readExportFiles(config.file),
    track: (config.track ?? '').trim(),
    ...(crop ? { crop } : {}),
    ...(width ? { width } : {}),
  };
  const problem = exportRequestProblem(request);
  if (problem) return { observation: `ERROR: ${problem}`, status: 'error' };
  if ((ctx.exportCalls ?? 0) >= MAX_EXPORT_CALLS_PER_RUN) {
    return { observation: `ERROR: This answer already has ${MAX_EXPORT_CALLS_PER_RUN} files. Finish with them.`, status: 'error' };
  }
  ctx.exportCalls = (ctx.exportCalls ?? 0) + 1;
  try {
    return exportObservation(await ctx.exportFile(request), format);
  } catch (err) {
    if (err instanceof FlowAbortError) throw err;
    if (ctx.signal?.aborted) throw new FlowAbortError();
    const message = err instanceof Error ? err.message : String(err);
    sendLog(`⚠️ [Agent] export_file failed: ${message}`);
    return { observation: `ERROR: The file could not be made: ${message}. Tell the user it was not made.`, status: 'error' };
  }
}
