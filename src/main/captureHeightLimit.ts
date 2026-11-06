import type { CaptureFormat } from '../shared/types';
import { sendLog } from './helpers';

const HEIGHT_LIMIT_MARKER = 'height exceeds limits';

export function isHeightLimitError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '');
  return message.toLowerCase().includes(HEIGHT_LIMIT_MARKER);
}

/**
 * Renders a card without losing it to the PNG/WebP height limit, which a long answer at the card
 * style's scale and width reaches with no change on the caller's side: retry at 1x first (same
 * format), then as a PDF, which has no height limit. Other errors are thrown as they come.
 * `label` names the caller in the log ("[Flow] LLM export").
 */
export async function renderWithinHeightLimit<T>(
  format: CaptureFormat,
  pixelRatio: number,
  render: (format: CaptureFormat, pixelRatio: number) => Promise<T>,
  label: string,
): Promise<T> {
  try {
    return await render(format, pixelRatio);
  } catch (err) {
    if (format === 'pdf' || !isHeightLimitError(err)) throw err;
  }
  if (pixelRatio > 1) {
    sendLog(`⚠️ ${label}: ${format.toUpperCase()} at ${pixelRatio}x exceeds the image height limit — retrying at 1x`);
    try {
      return await render(format, 1);
    } catch (err) {
      if (!isHeightLimitError(err)) throw err;
    }
  }
  sendLog(`⚠️ ${label}: ${format.toUpperCase()} exceeds the image height limit — re-rendering as PDF`);
  return render('pdf', pixelRatio);
}
