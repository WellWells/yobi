/**
 * The raw HTML an answer may use, shared by the app renderer and the plain outputs.
 *
 * Provider answers are untrusted, so raw HTML is never handed to a DOM parser. A tag is honoured
 * only when it is written bare (`<kbd>`, `</kbd>`) with no attribute, which leaves nothing to
 * smuggle in (no `on*` handler, no `style`, no `href`). Everything else stays visible text.
 */

/** Inline tags the app renders as the element itself. */
export const INLINE_HTML_TAGS: ReadonlySet<string> = new Set(['kbd', 'sub', 'sup', 'mark', 'u', 'ins', 's']);

/** Block tags the app renders: a collapsible section. */
export const BLOCK_HTML_TAGS: ReadonlySet<string> = new Set(['details', 'summary']);

const BARE_TAG = /^<(\/?)([a-zA-Z]+)\s*>$/;
const BR_TAG = /^<br\s*\/?>$/i;
const ANY_TAG = /<!--[\s\S]*?-->|<[^<>]*>/g;
const COMMENT = /^<!--[\s\S]*?-->$/;
const ONLY_COMMENTS = /^\s*(?:<!--[\s\S]*?-->\s*)+$/;

export interface BareTag {
  name: string;
  closing: boolean;
}

/** `<kbd>` → `{ name: 'kbd', closing: false }`; anything carrying an attribute → null. */
export function parseBareTag(raw: string): BareTag | null {
  const match = BARE_TAG.exec(raw.trim());
  if (!match) return null;
  return { name: match[2].toLowerCase(), closing: match[1] === '/' };
}

export function isBreakTag(raw: string): boolean {
  return BR_TAG.test(raw.trim());
}

/** True when the HTML is nothing but comments, which a reader should never see. */
export function isOnlyHtmlComments(raw: string): boolean {
  return ONLY_COMMENTS.test(raw);
}

function isAllowedTag(tag: string): boolean {
  if (COMMENT.test(tag) || isBreakTag(tag)) return true;
  const bare = parseBareTag(tag);
  return bare !== null && (INLINE_HTML_TAGS.has(bare.name) || BLOCK_HTML_TAGS.has(bare.name));
}

/**
 * The words of an HTML fragment for an output that cannot show the element (Telegram, LINE,
 * email): allowed tags and comments drop away, `<br>` and the end of a `<summary>` become a line
 * break. Null when any other tag is present — the caller keeps showing that fragment as text.
 */
export function htmlAsPlainText(raw: string): string | null {
  const tags = raw.match(ANY_TAG) ?? [];
  if (!tags.every(isAllowedTag)) return null;
  return raw.replace(ANY_TAG, (tag) => {
    if (COMMENT.test(tag)) return '';
    if (isBreakTag(tag)) return '\n';
    return parseBareTag(tag)?.name === 'summary' && tag.startsWith('</') ? '\n' : '';
  });
}
