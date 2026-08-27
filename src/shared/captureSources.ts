import type { MarkdownCaptureRequest } from './types';

export function captureMarkdownSources(request: MarkdownCaptureRequest): string[] {
  const payload = request?.payload;
  if (!payload) return [];
  const sources: (string | undefined)[] = [payload.prompt, payload.content, payload.summary];
  for (const turn of payload.turns ?? []) {
    sources.push(turn?.prompt, turn?.response);
  }
  return sources.filter((value): value is string => typeof value === 'string' && value.length > 0);
}
