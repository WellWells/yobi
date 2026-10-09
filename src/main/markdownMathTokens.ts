import type { TokenizerAndRendererExtension } from 'marked';

/**
 * marked tokens that claim a formula before marked reads it as markdown.
 *
 * An output that cannot typeset math (an email, a Telegram message) has to show the TeX the
 * model wrote. Left to marked, that TeX is markdown: `\\`, `\{` and `\,` lose their backslash
 * as escapes and `a*b*c` turns into italics. These tokens take a `$$` fence and a `$$…$$` span
 * first, while backticks still reach marked's own code tokenizers. Run the source through
 * `promoteDisplayMath` / `promoteInlineMath` beforehand, so whatever the app renders as a formula
 * reaches these tokens in the `$$` form they match.
 *
 * The caller decides the markup; the TeX it is handed is the raw source and must be escaped.
 */

const DISPLAY_MATH = /^ {0,3}\$\$[ \t]*\n([\s\S]*?)\n {0,3}\$\$[ \t]*(?:\n+|$)/;
/** A later line that opens a `$$` fence. marked hands `start` the source minus its first character. */
const DISPLAY_MATH_START = /\n {0,3}\$\$[ \t]*\n/;
const INLINE_MATH = /^\$\$([^$]+?)\$\$/;

export interface MathMarkup {
  /** A `$$` fence on lines of its own. */
  display: (tex: string) => string;
  /** A `$$…$$` span inside a line. */
  inline: (tex: string) => string;
}

export function mathTokenExtensions(markup: MathMarkup): TokenizerAndRendererExtension[] {
  const displayMath: TokenizerAndRendererExtension = {
    name: 'displayMath',
    level: 'block',
    start: (src) => {
      const match = DISPLAY_MATH_START.exec(src);
      return match ? match.index + 1 : undefined;
    },
    tokenizer: (src) => {
      const match = DISPLAY_MATH.exec(src);
      return match ? { type: 'displayMath', raw: match[0], text: match[1] } : undefined;
    },
    renderer: (token) => markup.display(String(token.text)),
  };

  const inlineMath: TokenizerAndRendererExtension = {
    name: 'inlineMath',
    level: 'inline',
    start: (src) => {
      const index = src.indexOf('$$');
      return index < 0 ? undefined : index;
    },
    tokenizer: (src) => {
      const match = INLINE_MATH.exec(src);
      return match ? { type: 'inlineMath', raw: match[0], text: match[1].trim() } : undefined;
    },
    renderer: (token) => markup.inline(String(token.text)),
  };

  return [displayMath, inlineMath];
}
