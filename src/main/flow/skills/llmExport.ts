import * as fs from 'node:fs/promises';
import type { CaptureFormat, MarkdownCapturePayload } from '../../../shared/types';
import { CAPTURE_WIDTHS } from '../../../shared/types';
import { cardStyleFromSettings, formatCardTime } from '../../../shared/captureCard';
import { resolveCardTitle } from '../../../shared/markdownTitle';
import { config as appConfig } from '../../config';
import { getProviderLabel } from '../../providers';
import { renderWithinHeightLimit } from '../../captureHeightLimit';
import { sendLog } from '../../helpers';
import { FlowAbortError, withAbort } from '../runtime';
import type { FlowExecutorDeps } from '../types';

/**
 * Renders an `llm` step's answer as a card in each requested format, in order, filling `files`
 * with what each format really produced (an image too tall falls back to a PDF). Returns the
 * last format's file, the step's main output.
 */
export async function exportLlmAnswer(
  config: Record<string, string>,
  deps: FlowExecutorDeps,
  answer: string,
  providerUrl: string,
  formats: readonly CaptureFormat[],
  files: Record<CaptureFormat, string>,
  signal?: AbortSignal,
): Promise<string> {
  if (!deps.captureMarkdown) {
    throw new Error('LLM export requires captureMarkdown dependency');
  }
  // Blank title = the heading the answer opens with (lifted out of the body), else none.
  const { title, body } = resolveCardTitle(config.exportTitle ?? '', answer);
  // Settings › Card style, the same as a bot export; the step's own Background, when picked,
  // replaces only the palette. `config.background` is deliberately not read: a gradient frozen
  // there would override Solid forever.
  const style = cardStyleFromSettings(appConfig.captureSettings, config.palette ?? '');
  const requestedWidth = CAPTURE_WIDTHS.find((value) => String(value) === (config.exportWidth ?? '').trim());
  const exportOptions = {
    fileName: (config.exportFileName ?? '').trim(),
    showProvider: config.exportShowProvider !== 'false',
    showTimestamp: config.exportShowTimestamp !== 'false',
    showTokens: false,
    cardTheme: style.cardTheme,
    width: requestedWidth ?? style.width,
    margin: style.margin,
    pixelRatio: style.pixelRatio,
  };
  const provider = getProviderLabel(providerUrl);
  // Printed on the card as is, so it is formatted here in local time, as a chat export reads.
  const timestamp = formatCardTime(new Date().toISOString(), appConfig.locale);
  // The card shows the answer only. The prompt is the flow's own instruction (memory blocks,
  // fenced data) and never goes onto a card, so it is not handed to the capture window at all.
  const payload: MarkdownCapturePayload = {
    title,
    prompt: '',
    content: body,
    summary: '',
    provider,
    timestamp,
    turns: [{ prompt: '', response: body, provider, timestamp }],
  };
  // Losing the already-fetched answer to the image height limit is worse than a different file type.
  const capture = deps.captureMarkdown;
  let filePath = '';
  for (const requestedFormat of formats) {
    filePath = await renderWithinHeightLimit(
      requestedFormat,
      exportOptions.pixelRatio ?? 1,
      async (format, pixelRatio) => {
        if (signal?.aborted) throw new FlowAbortError();
        // Several requested images can fall back to the same PDF; keep one actual artifact.
        if (files[format]) return files[format];
        // Stop does not cancel the capture window's render: the file it is about to write is
        // skipped (`signal`), and one written anyway in the meantime is deleted, not left behind.
        const pending = capture(payload, format, style.background, { ...exportOptions, pixelRatio, ...(signal ? { signal } : {}) });
        const generated = await withAbort(pending, signal).catch((err: unknown) => {
          if (err instanceof FlowAbortError) {
            pending.then((late) => fs.rm(late, { force: true })).catch(() => {});
          }
          throw err;
        });
        files[format] = generated;
        sendLog(`🖼️ [Flow] LLM export generated: ${generated}`);
        return generated;
      },
      '[Flow] LLM export',
    );
  }
  return filePath;
}
