/** A table header written in CJK takes a full-width colon before its value. */
const CJK_LABEL = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/**
 * One table cell as plain text for a chat that has no tables (LINE, Telegram): its column's
 * header as a label, then the value. An empty value is nothing; an empty header is the value alone.
 */
export function labelledCell(header: string, value: string): string {
  if (!value) return '';
  if (!header) return value;
  return CJK_LABEL.test(header) ? `${header}：${value}` : `${header}: ${value}`;
}
