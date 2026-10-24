import { Marked, Renderer, type Token, type TokenizerExtension } from 'marked';
import { promoteDisplayMath, promoteInlineMath } from '../../shared/inlineMathDelimiters';
import { flattenFootnotes } from '../../shared/markdownFootnotes';
import { htmlAsPlainText } from '../../shared/markdownHtmlWhitelist';
import { mathTokenExtensions } from '../markdownMathTokens';
import { readableTex } from '../readableTex';
import { LINE_TEXT_MAX } from '../../shared/botMessageLimits';
import { unfoldExpandableQuotes } from '../../shared/expandableQuote';

const LINE_TEXT_LIMIT = LINE_TEXT_MAX;
const LINE_REPLY_MAX = 4_800;

/** A table header written in CJK takes a full-width colon before its value. */
const CJK_LABEL = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const PUNCTUATION = /\p{P}/u;
const LAST_ASCII = 0x7f;

/**
 * `**…**` (or `***…***`) on one line, with no space just inside the markers and no `*` between
 * them. A code span counts as one piece, so the `**` of a `**kwargs` inside backticks never
 * closes the pair.
 */
const LOOSE_STRONG = /^(\*{2,3})(?=[^\s*])((?:`[^`\n]*`|[^*`\n])+?)(?<=[^\s*])\1/;

/** A CJK letter, or non-ASCII punctuation such as full-width colons, corner brackets and parentheses. */
function isCjkSide(char: string): boolean {
  if (CJK_LABEL.test(char)) return true;
  return PUNCTUATION.test(char) && (char.codePointAt(0) ?? 0) > LAST_ASCII;
}

/**
 * Bold that CommonMark leaves as literal asterisks because punctuation sits just inside its
 * markers, such as a bold CJK label ending in a full-width colon or bold around corner-bracket
 * quotes. Chinese answers write it all the time, and a LINE user would read the `**` as typed.
 * Claimed only where the pair meets CJK text, so an ASCII line such as `2**(n-1) + 2**(n+1)`
 * keeps CommonMark's reading. Its token is a plain `strong`, which the LINE renderer reduces to
 * its words.
 */
const cjkStrong: TokenizerExtension = {
  name: 'cjkStrong',
  level: 'inline',
  start: (src) => {
    const index = src.indexOf('**');
    return index < 0 ? undefined : index;
  },
  tokenizer(src) {
    const match = LOOSE_STRONG.exec(src);
    if (!match) return undefined;
    const [raw, , text] = match;
    const edges = [text.charAt(0), text.charAt(text.length - 1), src.charAt(raw.length)];
    if (!edges.some(isCjkSide)) return undefined;
    return { type: 'strong', raw, text, tokens: this.lexer.inlineTokens(text) };
  },
};

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

// LINE cannot typeset math either: a formula goes out as Unicode text (`readableTex`), or as
// the TeX the model wrote when it has more than that can show. Its own instance, because
// `marked.use()` would register the tokens for the whole process — the loose bold reading is
// for LINE only; Telegram and email keep CommonMark's.
const lineMarked = new Marked({
  extensions: [
    ...mathTokenExtensions({
      display: (tex) => `${readableTex(tex) ?? tex}\n\n`,
      inline: (tex) => readableTex(tex) ?? `$${tex}$`,
    }),
    cjkStrong,
  ],
});

function tableCell(header: string, value: string): string {
  if (!value) return '';
  if (!header) return value;
  return CJK_LABEL.test(header) ? `${header}：${value}` : `${header}: ${value}`;
}

function indentContinuation(text: string, marker: string): string {
  const [first = '', ...rest] = text.split('\n');
  return [`${marker}${first}`, ...rest.map((line) => (line ? `  ${line}` : line))].join('\n');
}

/**
 * Markdown as LINE shows it: a LINE text message is plain text, so `###`, `**` and `|---|`
 * would arrive literally. Headings become their own line, emphasis keeps only its words (bold
 * against CJK punctuation included, see `cjkStrong`), a list
 * keeps its bullets and numbers, a link is its words then its address (LINE makes a bare address
 * tappable), and each table row becomes one line that carries its own column labels — LINE has
 * no monospace to line columns up in.
 *
 * Nothing is HTML-escaped: the result is never parsed as HTML, so marked's default `&amp;` would
 * reach the user as typed.
 */
export function markdownToLineText(markdown: string): string {
  const source = (markdown ?? '').replace(/\r\n?/g, '\n');
  const renderer = new Renderer();
  const inline = (tokens: Token[]): string => renderer.parser.parseInline(tokens);
  const block = (tokens: Token[]): string => renderer.parser.parse(tokens);

  renderer.strong = ({ tokens }) => inline(tokens);
  renderer.em = ({ tokens }) => inline(tokens);
  // `~` is far more often a range ("1~3") than strikethrough, as in the Telegram formatter.
  renderer.del = ({ raw }) => raw;
  renderer.codespan = ({ text }) => text;
  renderer.text = (token) => ('tokens' in token && token.tokens?.length ? inline(token.tokens) : token.text);
  renderer.link =({ href, tokens, autolink, text }) => {
    if (autolink) return text;
    const label = inline(tokens).trim();
    return !label || label === href ? href : `${label} ${href}`;
  };
  renderer.image = ({ href, text }) => (text.trim() ? `${text.trim()} ${href}` : href);
  renderer.br = () => '\n';
  // `<br>`, `<kbd>Ctrl</kbd>`, `<details>` and comments keep only their words; any other HTML as written.
  renderer.html = ({ text, block }) => {
    const plain = htmlAsPlainText(text);
    if (plain === null) return text;
    if (!block) return plain;
    return plain.trim() ? `${plain.trim()}\n\n` : '';
  };
  // The box is drawn by the list item, which knows whether it is a task.
  renderer.checkbox = () => '';

  renderer.heading = ({ tokens }) => `${inline(tokens).trim()}\n\n`;
  renderer.paragraph = ({ tokens }) => `${inline(tokens)}\n\n`;
  renderer.code = ({ text }) => `${text}\n\n`;
  renderer.blockquote = ({ tokens }) => `${block(tokens).trim()}\n\n`;
  renderer.hr = () => '\n';
  renderer.list = ({ items, ordered, start }) => {
    const first = typeof start === 'number' ? start : 1;
    const lines = items.map((item, index) => {
      // One token at a time, so a nested list starts its own line instead of joining the item's text.
      const body = item.tokens
        .map((token) => block([token]).trim())
        .filter(Boolean)
        .join('\n');
      const marker = item.task ? (item.checked ? '☑ ' : '☐ ') : ordered ? `${first + index}. ` : '• ';
      return indentContinuation(body, marker);
    });
    return `${lines.join('\n')}\n\n`;
  };
  renderer.table = ({ header, rows }) => {
    const labels = header.map((cell) => inline(cell.tokens).trim());
    const lines = rows.length > 0
      ? rows.map((row) => row
        .map((cell, index) => tableCell(labels[index] ?? '', inline(cell.tokens).trim()))
        .filter(Boolean)
        .join(' · '))
      : [labels.filter(Boolean).join(' · ')];
    return `${lines.filter(Boolean).join('\n')}\n\n`;
  };

  // The app's own `$`/`$$` repair, so what renders as a formula there arrives as one here.
  const parsed = lineMarked.parse(promoteInlineMath(promoteDisplayMath(flattenFootnotes(source))), {
    renderer,
    gfm: true,
    breaks: true,
    async: false,
  });
  const plain = typeof parsed === 'string' ? parsed.replace(/\n{3,}/g, '\n\n').trim() : '';
  // Never trade a non-empty answer for an empty send.
  return plain || source.trim();
}

/** A message for LINE: Markdown flattened to plain text, then held to LINE's length limit. */
export function formatLineText(text: string): string {
  return truncateLineText(markdownToLineText(text));
}

/**
 * A message that must arrive exactly as written (a shell approval): no Markdown flattening, no
 * cut. Null when LINE could not carry it whole — the caller must then not send it at all.
 */
export function verbatimLineText(text: string): string | null {
  // LINE cannot fold, so an approval's folded arguments are shown as plain lines.
  const shown = unfoldExpandableQuotes(text);
  return shown.length <= LINE_TEXT_LIMIT ? shown : null;
}

export function formatLineReply(text: string, emptyFallback: string): string {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return emptyFallback;
  return formatLineText(trimmed);
}
