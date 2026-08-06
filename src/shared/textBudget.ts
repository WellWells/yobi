const encoder = new TextEncoder();

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
