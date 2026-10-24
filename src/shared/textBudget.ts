const encoder = new TextEncoder();
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * The longest start of `text` within `max` UTF-16 units that ends between two user-perceived
 * characters: never half an emoji (a lone surrogate), half a flag, or a joined sequence cut at
 * its joiner. When the first character alone is longer than `max` (stacked combining marks, a
 * long joined emoji), it is cut between code points instead, so the result is never empty.
 */
export function wholeCharsWithin(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = 0;
  for (const { index, segment } of graphemes.segment(text)) {
    if (index + segment.length > max) break;
    end = index + segment.length;
  }
  if (end > 0) return text.slice(0, end);
  let cut = '';
  for (const point of text) {
    if (cut.length + point.length > max) break;
    cut += point;
  }
  return cut.replace(/‍+$/u, '');
}

/**
 * One-line preview for a notification, log row or queue entry: whitespace collapsed, ellipsis past
 * `limit`. The ellipsis goes on top, so a cut result is `limit + 1` characters; use `clipLine`
 * where the whole line has to fit.
 */
export function compactPreview(text: string, limit: number): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > limit ? `${wholeCharsWithin(compact, limit)}…` : compact;
}

/**
 * `compactPreview` whose result, ellipsis included, is never longer than `limit`: for lines a
 * budget is counted against, such as the agent's tool catalog.
 */
export function clipLine(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${wholeCharsWithin(flat, limit - 1)}…` : flat;
}

export function utf8Len(text: string): number {
  return encoder.encode(text).length;
}

export function truncateToBytes(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  if (utf8Len(text) <= maxBytes) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (utf8Len(text.slice(0, mid)) <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo);
}

export function charsPlusBreaks(text: string): number {
  let breaks = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) breaks++;
  }
  return text.length + breaks;
}

export function truncateToCharsPlusBreaks(text: string, max: number): string {
  if (max <= 0) return '';
  if (charsPlusBreaks(text) <= max) return text;
  let cost = 0;
  let end = 0;
  for (let i = 0; i < text.length; i++) {
    cost += text.charCodeAt(i) === 10 ? 2 : 1;
    if (cost > max) break;
    end = i + 1;
  }
  const last = end > 0 ? text.charCodeAt(end - 1) : 0;
  if (last >= 0xd8_00 && last <= 0xdb_ff) end--;
  return text.slice(0, end);
}
