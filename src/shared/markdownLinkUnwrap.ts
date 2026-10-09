const WHOLE_MARKDOWN_LINK = /^\[[^\]]+\]\(([^)]+)\)$/;
const WHOLE_ANGLE_AUTOLINK = /^<(https?:\/\/[^>\s]+)>$/i;
/**
 * Only the opening bracket survived: a linkifier that swallows the JSON's closing `"}}` into the
 * URL leaves `"[https://x/y"}}](…)`, which still parses. A real URL never starts with `[`.
 */
const TRUNCATED_LINK_LABEL = /^\[(https?:\/\/[^\]\s]+)\]?$/i;

/**
 * Undo a browser-UI model linkifying a bare URL (`[example.com](https://example.com)`). Only for
 * fields whose value IS a URL: on prose it would turn the user's own `[label](url)` into a bare URL.
 */
export function unwrapMarkdownLink(value: string): string {
  const trimmed = value.trim();
  const link = trimmed.match(WHOLE_MARKDOWN_LINK);
  if (link) return link[1].trim();
  const angle = trimmed.match(WHOLE_ANGLE_AUTOLINK);
  if (angle) return angle[1].trim();
  const truncated = trimmed.match(TRUNCATED_LINK_LABEL);
  if (truncated) return truncated[1].trim();
  return value;
}
