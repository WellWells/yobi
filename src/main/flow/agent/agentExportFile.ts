import type { CaptureFormat } from '../../../shared/types';
import { sendLog } from '../../helpers';
import { FlowAbortError } from '../runtime';

/*
 * A bot answers with text alone; a file is made only when someone asks for one.
 * "Turn it into a PDF" makes the file of the answer it means, in the Card
 * style from Settings, sent with the run's answer. The caller renders and keeps the file; this
 * module only words it.
 */

export const EXPORT_FILE_TOOL = 'export_file';

/** Where the file's text came from, for the observation. */
export type ExportSourceKind = 'content' | 'reply' | 'answer';

export type ExportedFile =
  | {
    /** The file's name, as the user receives it. */
    name: string;
    /** What it was rendered as: a PDF when the asked-for image was past the height limit. */
    format: CaptureFormat;
    from: ExportSourceKind;
  }
  /** No text to make it from: the replied-to message has none, or the chat has no earlier answer. */
  | { missing: 'reply' | 'answer' };

export interface ExportFileRequest {
  format: CaptureFormat;
  /** Markdown the model wrote for the file; '' = the replied-to message, else the chat's last answer. */
  content: string;
  /** '' = the content's own leading heading, or none. */
  title: string;
}

export type ExportFile = (request: ExportFileRequest) => Promise<ExportedFile>;

/** A file or two and a redo; a run that keeps exporting is not converging. */
export const MAX_EXPORT_CALLS_PER_RUN = 3;

/**
 * What the catalog lists for a run whose answer can carry a file: a tier-1 brief, the full
 * `EXPORT_FILE_LINE` from `tool_help`. The brief keeps what a first call needs: that only this
 * tool's file reaches the user, and that leaving "content" out means the answer already given.
 */
export const EXPORT_FILE_BRIEF = '- "export_file": Send the user a PDF, PNG or WebP FILE of an answer when they ask for one; omit "content" for the message they replied to, else the last answer. config: "format" ("pdf", "png" or "webp"; REQUIRED). [+opts]';

export const EXPORT_FILE_LINE = '- "export_file": Turn an answer into a FILE the user receives when they ask to convert, export or download it (a PDF, or a PNG/WebP picture of it), drawn in their card style. You cannot attach files yourself: only the file this tool makes reaches the user, sent with your answer. config keys: "format" ("pdf", "png" or "webp"; REQUIRED), "content" (Markdown for the file — omit it to use the message the user replied to, else the last answer in this chat; write it only for something new, such as a table they asked for), "title" (omit to use the content\'s own heading) → returns: the file attached.';

const FORMATS: Readonly<Record<string, CaptureFormat>> = {
  pdf: 'pdf',
  png: 'png',
  webp: 'webp',
  // Asked for "a picture" or a JPEG: the card is a PNG, the closest file this tool makes.
  jpg: 'png',
  jpeg: 'png',
  image: 'png',
};

export function readExportFormat(value: string | undefined): CaptureFormat | null {
  return FORMATS[(value ?? '').trim().toLowerCase().replace(/^\./, '')] ?? null;
}

const SOURCE_TEXT: Record<ExportSourceKind, string> = {
  content: 'the content you wrote',
  reply: 'the message the user replied to',
  answer: 'the last answer in this chat',
};

/** The observation for one export: the file attached, or why there is none. */
export function exportObservation(result: ExportedFile, asked: CaptureFormat): { observation: string; status: 'ok' | 'error' } {
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
  const switched = result.format !== asked
    ? ` It was too long for one ${asked.toUpperCase()} picture, so it is a PDF — tell the user.`
    : '';
  return {
    observation: `Attached "${result.name}", made from ${SOURCE_TEXT[result.from]}.${switched} It goes out with your answer by itself — no links, no paths. In "finish", say in one short sentence what the file holds; do not repeat its text.`,
    status: 'ok',
  };
}

export interface ExportContext {
  exportFile?: ExportFile;
  /** Files this run has made; counted here. */
  exportCalls?: number;
  signal?: AbortSignal;
}

export async function runExportFile(
  config: Record<string, string>,
  ctx: ExportContext,
): Promise<{ observation: string; status: 'ok' | 'error' }> {
  const format = readExportFormat(config.format);
  if (!format) return { observation: 'ERROR: "format" must be "pdf", "png" or "webp".', status: 'error' };
  if (!ctx.exportFile) {
    return {
      observation: 'ERROR: Files cannot be sent here. Tell the user this chat cannot receive the file — never describe one as sent.',
      status: 'error',
    };
  }
  if ((ctx.exportCalls ?? 0) >= MAX_EXPORT_CALLS_PER_RUN) {
    return { observation: `ERROR: This answer already has ${MAX_EXPORT_CALLS_PER_RUN} files. Finish with them.`, status: 'error' };
  }
  ctx.exportCalls = (ctx.exportCalls ?? 0) + 1;
  try {
    const result = await ctx.exportFile({ format, content: (config.content ?? '').trim(), title: (config.title ?? '').trim() });
    return exportObservation(result, format);
  } catch (err) {
    if (err instanceof FlowAbortError) throw err;
    if (ctx.signal?.aborted) throw new FlowAbortError();
    const message = err instanceof Error ? err.message : String(err);
    sendLog(`⚠️ [Agent] export_file failed: ${message}`);
    return { observation: `ERROR: The file could not be made: ${message}. Tell the user it was not made.`, status: 'error' };
  }
}
