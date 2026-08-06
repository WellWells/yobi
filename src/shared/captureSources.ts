import type { MarkdownCaptureRequest } from './types';

/**
 * Every payload field that CaptureCard feeds through the markdown renderer.
 * Kept in one place because a field missing here is a diagram the export path
 * never pre-renders, which it can then only fall back to raw source for.
 */
export function captureMarkdownSources(request: MarkdownCaptureRequest): string[] {
  const payload = request?.payload;
  if (!payload) return [];
  const sources: (string | undefined)[] = [payload.prompt, payload.content, payload.summary];
  for (const turn of payload.turns ?? []) {
    sources.push(turn?.prompt, turn?.response);
  }
  return sources.filter((value): value is string => typeof value === 'string' && value.length > 0);
}
