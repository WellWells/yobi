const LINE_TEXT_LIMIT = 5_000;
const LINE_REPLY_MAX = 4_800;

function sliceWithoutSplittingSurrogates(text: string, max: number): string {
  if (text.length <= max) return text;
  const lastCode = text.charCodeAt(max - 1);
  const isHighSurrogate = lastCode >= 0xd800 && lastCode <= 0xdbff;
  return text.slice(0, isHighSurrogate ? max - 1 : max);
}

export function truncateLineText(text: string): string {
  if (text.length <= LINE_TEXT_LIMIT) return text;
  return `${sliceWithoutSplittingSurrogates(text, LINE_REPLY_MAX)}…`;
}

export function formatLineReply(text: string, emptyFallback: string): string {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return emptyFallback;
  return truncateLineText(trimmed);
}
