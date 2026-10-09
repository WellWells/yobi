import { Marked, Renderer, type Tokens } from 'marked';
import { promoteDisplayMath, promoteInlineMath } from '../../../shared/inlineMathDelimiters';
import { flattenFootnotes } from '../../../shared/markdownFootnotes';
import { htmlAsPlainText } from '../../../shared/markdownHtmlWhitelist';
import { mathTokenExtensions } from '../../markdownMathTokens';

/**
 * Renders an `email_send` body — markdown, usually an llm step's answer — as an HTML email.
 *
 * Mail clients are the constraint, not browsers:
 *  - Every style is an inline attribute. Gmail and most webmail strip `<style>` blocks.
 *  - No text colour and no solid fills anywhere. A client in dark mode either recolours the
 *    message itself or leaves it alone; a hard-coded dark text or light box breaks the second
 *    kind. Lines are a mid grey and fills are translucent, so they read on either background
 *    (and a client that cannot do rgba simply draws no fill).
 *
 * The body is untrusted: it is interpolated from feeds, web pages and model output. The app's
 * markdown policy applies — raw HTML is shown as text, `<br>` becomes a line break, and the few
 * bare tags the app renders (`<kbd>`, `<sub>`, `<details>`…) keep only their words.
 * Links keep only http(s) and mailto, images only https; anything else degrades to its text.
 * A link whose label is written as an address on another site shows the real address instead.
 */

const FONT_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const MONO_STACK = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";
const LINE = '#d0d7de';
const FILL = 'rgba(127, 127, 127, 0.12)';

const STYLE = {
  page: `max-width:720px;margin:0 auto;padding:16px;font-family:${FONT_STACK};font-size:15px;line-height:1.6;overflow-wrap:break-word;word-wrap:break-word;`,
  paragraph: 'margin:0 0 16px;',
  itemParagraph: 'margin:0 0 8px;',
  list: 'margin:0 0 16px;padding-left:24px;',
  nestedList: 'margin:4px 0 0;padding-left:24px;',
  item: 'margin:4px 0;',
  taskItem: 'margin:4px 0;list-style-type:none;',
  blockquote: `margin:0 0 16px;padding:0 0 0 12px;border-left:3px solid ${LINE};`,
  pre: `margin:0 0 16px;padding:12px 14px;background-color:${FILL};border-radius:6px;overflow-x:auto;white-space:pre;font-family:${MONO_STACK};font-size:13px;line-height:1.45;`,
  preCode: `font-family:${MONO_STACK};white-space:pre;`,
  code: `padding:1px 5px;background-color:${FILL};border-radius:4px;font-family:${MONO_STACK};font-size:0.9em;`,
  tableWrap: 'margin:0 0 16px;overflow-x:auto;',
  table: 'border-collapse:collapse;border-spacing:0;',
  cell: `padding:6px 12px;border:1px solid ${LINE};vertical-align:top;`,
  headCell: `padding:6px 12px;border:1px solid ${LINE};vertical-align:top;font-weight:600;background-color:${FILL};`,
  hr: `margin:24px 0;border:0;border-top:1px solid ${LINE};`,
  image: 'max-width:100%;height:auto;border:0;',
} as const;

const HEADING_SIZES = [24, 20, 17, 15, 14, 13] as const;

const LINK_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:']);
const IMAGE_PROTOCOLS: ReadonlySet<string> = new Set(['https:']);

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Every special character: attribute values, code, and raw HTML shown as text. */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/** Prose keeps an entity it already spells (`&amp;`, `&#169;`) as written — markdown's own rule. */
const PROSE_SPECIAL = /[<>"']|&(?!#\d{1,7};|#[xX][\da-fA-F]{1,6};|\w+;)/g;

function escapeProse(text: string): string {
  return text.replace(PROSE_SPECIAL, (char) => HTML_ESCAPES[char] ?? char);
}

/**
 * The normalized URL when its scheme is allowed, otherwise null. Relative URLs have no meaning in
 * a mail. Neither does a user name before the host: `https://bank.example@evil.example` opens
 * evil.example, so the only thing it can do in a mail is mislead.
 */
function safeUrl(raw: string, protocols: ReadonlySet<string>): string | null {
  const href = raw.trim();
  if (!href) return null;
  try {
    const url = new URL(href);
    if (url.username || url.password) return null;
    return protocols.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/** A label written as a web address, which a reader takes for where the link goes. */
const URL_LABEL = /^(?:https?:\/\/|www\.)/i;

/** `www.example.com` and `example.com` read as the same site. */
function siteOf(url: URL): string {
  return url.hostname.replace(/^www\./, '');
}

/**
 * True when the label is an address on another site than the link's own —
 * `[https://bank.example](https://evil.example)`. The mail goes out under the user's name, so
 * the label is the only thing most recipients check. A label that does not parse, or carries a
 * user name of its own, cannot be shown to match and counts as hiding the target.
 */
function labelHidesTarget(label: string, target: string): boolean {
  const text = label.trim();
  if (!URL_LABEL.test(text)) return false;
  try {
    const shown = new URL(/^www\./i.test(text) ? `http://${text}` : text);
    if (shown.username || shown.password) return true;
    return siteOf(shown) !== siteOf(new URL(target));
  } catch {
    return true;
  }
}

function preBlock(source: string): string {
  return `<pre style="${STYLE.pre}"><code style="${STYLE.preCode}">${escapeHtml(source.replace(/\n+$/, ''))}</code></pre>\n`;
}

function inlineCode(source: string): string {
  return `<code style="${STYLE.code}">${escapeHtml(source)}</code>`;
}

class EmailRenderer extends Renderer {
  private listDepth = 0;

  override paragraph({ tokens }: Tokens.Paragraph): string {
    const style = this.listDepth > 0 ? STYLE.itemParagraph : STYLE.paragraph;
    return `<p style="${style}">${this.parser.parseInline(tokens)}</p>\n`;
  }

  override heading({ tokens, depth }: Tokens.Heading): string {
    const level = Math.min(Math.max(Math.trunc(depth), 1), HEADING_SIZES.length);
    const size = HEADING_SIZES[level - 1];
    const style = `margin:24px 0 12px;font-size:${size}px;line-height:1.3;font-weight:600;`;
    return `<h${level} style="${style}">${this.parser.parseInline(tokens)}</h${level}>\n`;
  }

  // `escaped` is ignored on purpose: a highlighter extension is the only thing that sets it.
  override code({ text }: Tokens.Code): string {
    return preBlock(text);
  }

  override codespan({ text }: Tokens.Codespan): string {
    return inlineCode(text);
  }

  override blockquote({ tokens }: Tokens.Blockquote): string {
    return `<blockquote style="${STYLE.blockquote}">\n${this.parser.parse(tokens)}</blockquote>\n`;
  }

  override hr(): string {
    return `<hr style="${STYLE.hr}">\n`;
  }

  override list(token: Tokens.List): string {
    const tag = token.ordered ? 'ol' : 'ul';
    const start = token.ordered && Number.isInteger(token.start) && token.start !== 1 ? ` start="${token.start}"` : '';
    const style = this.listDepth > 0 ? STYLE.nestedList : STYLE.list;
    this.listDepth += 1;
    const items = token.items.map((item) => this.listitem(item)).join('');
    this.listDepth -= 1;
    return `<${tag}${start} style="${style}">\n${items}</${tag}>\n`;
  }

  override listitem(item: Tokens.ListItem): string {
    const style = item.task ? STYLE.taskItem : STYLE.item;
    return `<li style="${style}">${this.parser.parse(item.tokens).trim()}</li>\n`;
  }

  // marked's default is a disabled <input>, which mail clients strip — the item would lose its state.
  override checkbox({ checked }: Tokens.Checkbox): string {
    return checked ? '☑ ' : '☐ ';
  }

  override table(token: Tokens.Table): string {
    const head = token.header.map((cell) => this.tablecell(cell)).join('');
    const rows = token.rows.map((row) => `<tr>${row.map((cell) => this.tablecell(cell)).join('')}</tr>\n`).join('');
    const body = rows ? `<tbody>\n${rows}</tbody>\n` : '';
    return `<div style="${STYLE.tableWrap}"><table style="${STYLE.table}">\n<thead>\n<tr>${head}</tr>\n</thead>\n${body}</table></div>\n`;
  }

  override tablecell(cell: Tokens.TableCell): string {
    const tag = cell.header ? 'th' : 'td';
    const base = cell.header ? STYLE.headCell : STYLE.cell;
    // A browser centres <th> on its own; a column with no alignment reads left like its cells.
    const align = cell.align ?? (cell.header ? 'left' : null);
    const style = align ? `${base}text-align:${align};` : base;
    return `<${tag} style="${style}">${this.parser.parseInline(cell.tokens)}</${tag}>`;
  }

  override link({ href, title, tokens }: Tokens.Link): string {
    const label = this.parser.parseInline(tokens);
    const url = safeUrl(href, LINK_PROTOCOLS);
    if (!url) return label;
    // An address-shaped label pointing at another site is replaced by the real address.
    const shown = labelHidesTarget(this.parser.parseInline(tokens, this.parser.textRenderer), url)
      ? escapeHtml(url)
      : label;
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
    return `<a href="${escapeHtml(url)}"${titleAttr}>${shown}</a>`;
  }

  override image({ href, title, text, tokens }: Tokens.Image): string {
    const alt = tokens ? this.parser.parseInline(tokens, this.parser.textRenderer) : text;
    const src = safeUrl(href, IMAGE_PROTOCOLS);
    if (!src) return escapeHtml(alt);
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${titleAttr} style="${STYLE.image}">`;
  }

  // `<kbd>Ctrl</kbd>`, `<details>` and comments keep only their words; any other HTML stays visible text.
  override html({ text, block }: Tokens.HTML | Tokens.Tag): string {
    const shown = htmlAsPlainText(text) ?? text;
    if (!block) return escapeHtml(shown).replace(/\n/g, '<br>');
    const body = shown.trim();
    return body ? `<p style="${STYLE.paragraph}">${escapeHtml(body).replace(/\n/g, '<br>')}</p>\n` : '';
  }

  // marked trusts a text token's `escaped` flag, and sets it on text that follows an inline
  // <pre> or <script> tag; its default then writes that text out unescaped. Prose is always
  // escaped here, whatever the flag says.
  override text(token: Tokens.Text | Tokens.Escape): string {
    if (token.type === 'text' && token.tokens?.length) return this.parser.parseInline(token.tokens);
    return escapeProse(token.text);
  }
}

// Mail cannot typeset math, so a formula goes out as its TeX, set like code.
const emailMarked = new Marked({
  extensions: mathTokenExtensions({ display: preBlock, inline: inlineCode }),
});

/** A complete HTML document for the message; the caller sends the markdown itself as the plain-text part. */
export function renderEmailHtml(markdown: string): string {
  const source = promoteInlineMath(promoteDisplayMath(flattenFootnotes(markdown.replace(/\r\n?/g, '\n'))));
  const rendered = emailMarked.parse(source, {
    renderer: new EmailRenderer(),
    gfm: true,
    breaks: true,
    async: false,
  });
  const content = typeof rendered === 'string' ? rendered.trim() : '';
  return [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '</head>',
    '<body style="margin:0;padding:0;">',
    `<div style="${STYLE.page}">`,
    content,
    '</div>',
    '</body>',
    '</html>',
  ].join('\n');
}
