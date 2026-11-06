import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { CaptureFormat, CaptureSettings, MarkdownCaptureRequest } from '../../shared/types';
import { cardStyleFromSettings, formatCardTime, mustShowPrompt } from '../../shared/captureCard';
import { resolveCardTitle } from '../../shared/markdownTitle';
import { writeFileAtomic } from '../atomicWrite';
import { captureMarkdownDocument } from '../capture';
import { renderWithinHeightLimit } from '../captureHeightLimit';
import { chatMediaDir, pruneChatMedia } from '../chatMedia';
import { config } from '../config';
import { buildSafeFileNameFromTitle, buildSnapshotFileName, getUniquePath } from '../files';
import { sendLog } from '../helpers';

/** The text a file is made of, and what the card may show beside it. */
export interface AnswerExportSource {
  /** The answer, as Markdown. */
  markdown: string;
  /** '' = the content's own leading heading, or no title. */
  title: string;
  /** The question it answered; '' when there is none (text the model wrote, a replied-to message). */
  prompt: string;
  /** Who answered, as the user knows it; '' = not shown. */
  provider: string;
}

/**
 * The card a bot's file renders, in the user's Card style (the same one the shortcut, the export
 * dialog and a flow's capture step use): the answer as one turn, the title by the quick export's
 * rule (`resolveCardTitle`), no "Prompt"/"Content" section labels. A bubble card shows the question
 * when there is one — without it the answer is a lone reply bubble.
 */
export function buildAnswerCaptureRequest(
  source: AnswerExportSource,
  format: CaptureFormat,
  settings: CaptureSettings,
  exportedAt: string,
  locale: string,
): MarkdownCaptureRequest {
  const timestamp = formatCardTime(exportedAt, locale);
  const style = cardStyleFromSettings(settings);
  const { title, body } = resolveCardTitle(source.title, source.markdown);
  const prompt = source.prompt.trim();
  return {
    payload: {
      title,
      prompt,
      content: body,
      summary: '',
      provider: source.provider,
      timestamp,
      turns: [{ prompt, response: body, provider: source.provider, timestamp }],
    },
    options: {
      mode: 'save',
      format,
      fileName: title ? buildSafeFileNameFromTitle(title) : buildSnapshotFileName(),
      showPrompt: prompt !== '' && (mustShowPrompt(settings.cardLayout, 1) || settings.showPrompt),
      showContent: true,
      showProvider: settings.showProvider && source.provider !== '',
      showTimestamp: settings.showTimestamp,
      showTokens: false,
      width: style.width,
      margin: style.margin,
      background: style.background,
      cardTheme: style.cardTheme,
      cardLayout: settings.cardLayout,
      pixelRatio: style.pixelRatio,
      zip: false,
    },
  };
}

export interface ExportedAnswerFile {
  /** In the chat media folder: a bot sends it, and the folder's cap clears it out later. */
  path: string;
  /** What it was rendered as: a PDF when the image was past the height limit. */
  format: CaptureFormat;
}

/**
 * Renders the answer as a file in the chat media folder. Not the Downloads folder: nobody asked
 * to keep it on this computer, and the folder's 1 GB cap, factory reset and backup rules are the
 * ones a sent picture already lives by.
 */
export async function exportAnswerFile(source: AnswerExportSource, format: CaptureFormat): Promise<ExportedAnswerFile> {
  const request = buildAnswerCaptureRequest(source, format, config.captureSettings, new Date().toISOString(), config.locale);
  const result = await renderWithinHeightLimit(
    format,
    request.options.pixelRatio ?? 1,
    async (asFormat, pixelRatio) => ({
      asFormat,
      capture: await captureMarkdownDocument({ ...request, options: { ...request.options, format: asFormat, pixelRatio } }),
    }),
    '[Bot] Answer export',
  );
  const dir = chatMediaDir();
  await fs.mkdir(dir, { recursive: true });
  const file = await getUniquePath(path.join(dir, `${request.options.fileName}.${result.capture.ext}`), '');
  await writeFileAtomic(file, result.capture.buffer);
  void pruneChatMedia().catch(() => {});
  sendLog(`🖼️ [Bot] ${result.asFormat.toUpperCase()} of an answer saved: ${path.basename(file)}`);
  return { path: file, format: result.asFormat };
}
