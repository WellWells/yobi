import { Marked, Renderer, type Token } from 'marked';
import { promoteDisplayMath, promoteInlineMath } from '../../shared/inlineMathDelimiters';
import { flattenFootnotes } from '../../shared/markdownFootnotes';
import { htmlAsPlainText } from '../../shared/markdownHtmlWhitelist';
import { unfoldExpandableQuotes } from '../../shared/expandableQuote';
import { mathTokenExtensions } from '../markdownMathTokens';
import { readableTex } from '../readableTex';

/**
 * How one chat app writes the few things its messages render: Discord takes Markdown much like
 * the model's, Slack its own `mrkdwn`. Neither draws tables or typesets math, so those are turned
 * into text the same way for both (`renderChatMarkdown`).
 */
export interface ChatDialect {
  bold: (text: string) => string;
  italic: (text: string) => string;
  strike: (text: string) => string;
  /** Inline code; the text is as written. */
  code: (text: string) => string;
  link: (label: string, href: string) => string;
  /** Text the dialect would read as its own markup, made literal. */
  escape: (text: string) => string;
  /** What code (a block's body) needs so the app shows it as written; absent = nothing. */
  escapeCode?: (text: string) => string;
}

const CJK_LABEL = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** A fenced block whose body the app shows as written. */
function codeBlock(text: string, lang: string, dialect: ChatDialect): string {
  const body = (dialect.escapeCode?.(text) ?? text).replace(/```/g, '`​``');
  return `\`\`\`${lang}\n${body}\n\`\`\`\n\n`;
}

const dialectMarked = new WeakMap<ChatDialect, Marked>();

/**
 * A formula goes out as Unicode text (`readableTex`) escaped as any text is — Slack reads a raw
 * `<…>` as a link, Discord `_…_` as italics — or, when it has more than text can show, as code
 * holding the TeX the model wrote (as Telegram's <code>/<pre>). One instance per dialect, so the
 * math tokens stay out of the global `marked`.
 */
function chatMarked(dialect: ChatDialect): Marked {
  const cached = dialectMarked.get(dialect);
  if (cached) return cached;
  const instance = new Marked({
    extensions: mathTokenExtensions({
      display: (tex) => {
        const text = readableTex(tex);
        return text === null ? codeBlock(tex.trim(), '', dialect) : `${dialect.escape(text)}\n\n`;
      },
      inline: (tex) => {
        const text = readableTex(tex);
        return text === null ? dialect.code(tex) : dialect.escape(text);
      },
    }),
  });
  dialectMarked.set(dialect, instance);
  return instance;
}

function tableCell(header: string, value: string): string {
  if (!value) return '';
  if (!header) return value;
  return CJK_LABEL.test(header) ? `${header}：${value}` : `${header}: ${value}`;
}

function indentContinuation(text: string, marker: string): string {
  const [first = '', ...rest] = text.split('\n');
  return [`${marker}${first}`, ...rest.map((line) => (line ? `  ${line}` : line))].join('\n');
}

function quoted(text: string): string {
  return text.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n');
}

/**
 * Markdown as a chat app shows it: emphasis, code and links in the app's own markup, a heading as
 * a bold line, lists with their bullets and numbers, each table row one line carrying its column
 * labels, a formula as readable text. Nothing is HTML-escaped: the result is never parsed as HTML.
 */
export function renderChatMarkdown(markdown: string, dialect: ChatDialect): string {
  const source = unfoldExpandableQuotes((markdown ?? '').replace(/\r\n?/g, '\n'));
  const renderer = new Renderer();
  const inline = (tokens: Token[]): string => renderer.parser.parseInline(tokens);
  const block = (tokens: Token[]): string => renderer.parser.parse(tokens);

  renderer.strong = ({ tokens }) => dialect.bold(inline(tokens));
  renderer.em = ({ tokens }) => dialect.italic(inline(tokens));
  // `~` is far more often a range ("1~3") than strikethrough, as in the Telegram formatter.
  renderer.del = ({ raw }) => dialect.escape(raw);
  renderer.codespan = ({ text }) => dialect.code(text);
  renderer.text = (token) => ('tokens' in token && token.tokens?.length ? inline(token.tokens) : dialect.escape(token.text));
  renderer.link = ({ href, tokens, autolink }) => {
    if (autolink) return href;
    const label = inline(tokens).trim();
    return !label || label === href ? href : dialect.link(label, href);
  };
  renderer.image = ({ href, text }) => (text.trim() ? dialect.link(text.trim(), href) : href);
  renderer.br = () => '\n';
  renderer.html = ({ text, block: isBlock }) => {
    const plain = htmlAsPlainText(text);
    if (plain === null) return dialect.escape(text);
    if (!isBlock) return dialect.escape(plain);
    return plain.trim() ? `${dialect.escape(plain.trim())}\n\n` : '';
  };
  renderer.checkbox = () => '';

  renderer.heading = ({ tokens }) => `${dialect.bold(inline(tokens).trim())}\n\n`;
  renderer.paragraph = ({ tokens }) => `${inline(tokens)}\n\n`;
  renderer.code = ({ text, lang }) => codeBlock(text, lang ?? '', dialect);
  renderer.blockquote = ({ tokens }) => `${quoted(block(tokens).trim())}\n\n`;
  renderer.hr = () => '\n';
  renderer.list = ({ items, ordered, start }) => {
    const first = typeof start === 'number' ? start : 1;
    const lines = items.map((item, index) => {
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

  const parsed = chatMarked(dialect).parse(promoteInlineMath(promoteDisplayMath(flattenFootnotes(source))), {
    renderer,
    gfm: true,
    breaks: true,
    async: false,
  });
  const text = typeof parsed === 'string' ? parsed.replace(/\n{3,}/g, '\n\n').trim() : '';
  // Never trade a non-empty answer for an empty send.
  return text || source.trim();
}

const FENCE_LINE = /^```/;

/** The longest piece of `text` within `max` that does not end inside a surrogate pair. */
function hardCut(text: string, max: number): number {
  const code = text.charCodeAt(max - 1);
  return code >= 0xd800 && code <= 0xdbff ? max - 1 : max;
}

/**
 * A message split into pieces of at most `max` characters: at a blank line where possible, else
 * at a line break, else at a space, and only then mid-word. A piece that ends inside a code block
 * closes the fence and the next one opens it again, so no piece shows the rest as code.
 */
export function splitChatMessage(text: string, max: number): string[] {
  const pieces: string[] = [];
  let rest = text.trim();
  let reopen = '';
  // Room for a fence closed at the end of a piece and one opened at the start of the next.
  const budget = Math.max(max - 8, 16);
  while (rest) {
    const candidate = `${reopen}${rest}`;
    if (candidate.length <= max) {
      pieces.push(candidate);
      break;
    }
    const room = budget - reopen.length;
    const window = rest.slice(0, room);
    let cut = Math.max(window.lastIndexOf('\n\n'), -1);
    if (cut < room / 2) cut = window.lastIndexOf('\n');
    if (cut < room / 2) cut = window.lastIndexOf(' ');
    if (cut < room / 4) cut = hardCut(rest, room);
    const head = rest.slice(0, cut).trimEnd();
    rest = rest.slice(cut).replace(/^\s+/, '');
    const opened = `${reopen}${head}`;
    const fences = opened.split('\n').filter((line) => FENCE_LINE.test(line.trim()));
    const insideFence = fences.length % 2 === 1;
    pieces.push(insideFence ? `${opened}\n\`\`\`` : opened);
    reopen = insideFence ? `${fences[fences.length - 1]!.trim()}\n` : '';
  }
  return pieces.filter((piece) => piece.trim());
}
