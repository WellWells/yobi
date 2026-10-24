import { Marked, Renderer } from 'marked';
import { t } from '../i18n';
import { promoteDisplayMath, promoteInlineMath } from '../../shared/inlineMathDelimiters';
import { expandableQuoteBody } from '../../shared/expandableQuote';
import { flattenFootnotes } from '../../shared/markdownFootnotes';
import { htmlAsPlainText } from '../../shared/markdownHtmlWhitelist';
import { mathTokenExtensions } from '../markdownMathTokens';
import { readableTex } from '../readableTex';

export function escapeTelegramHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Telegram cannot typeset math: a formula goes out as Unicode text (`readableTex`), or, when it
// has more than that can show, as its TeX — a `$$` fence as <pre>, a `$$…$$` span as <code>.
const telegramMarked = new Marked({
  extensions: mathTokenExtensions({
    display: (tex) => {
      const text = readableTex(tex);
      return text === null ? `<pre>${escapeTelegramHtml(tex)}</pre>\n` : `${escapeTelegramHtml(text)}\n\n`;
    },
    inline: (tex) => {
      const text = readableTex(tex);
      return text === null ? `<code>${escapeTelegramHtml(tex)}</code>` : escapeTelegramHtml(text);
    },
  }),
});

/** Telegram has no heading tag; bold is the one emphasis it can show. Inner <b> is dropped so a bold heading does not nest. */
function bold(html: string): string {
  return html ? `<b>${html.replace(/<\/?b>/g, '')}</b>` : '';
}

function escapeTelegramAttribute(text: string): string {
  return escapeTelegramHtml(text).replace(/"/g, '&quot;');
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  let cut = Math.max(0, maxLength - 1);
  const lastCode = text.charCodeAt(cut - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) cut -= 1;
  return `${text.slice(0, cut).trimEnd()}…`;
}

export function splitMarkdownIntoChunks(
  text: string,
  maxChunkChars: number,
  maxChunks: number,
): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];

  const chunks: string[] = [];
  let rest = normalized;
  while (rest && chunks.length < maxChunks) {
    if (rest.length <= maxChunkChars) {
      chunks.push(rest);
      rest = '';
      break;
    }
    const window = rest.slice(0, maxChunkChars);
    let cut = window.lastIndexOf('\n\n');
    if (cut < maxChunkChars / 2) cut = window.lastIndexOf('\n');
    if (cut < maxChunkChars / 2) cut = maxChunkChars;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }

  if (rest && chunks.length > 0) {
    const last = chunks.length - 1;
    chunks[last] = truncateText(`${chunks[last]}…`, maxChunkChars);
  }
  return chunks.filter(Boolean);
}

/** A span of a plain-text message, in UTF-16 code units as Telegram counts them. */
export interface TelegramPreEntity {
  type: 'pre' | 'expandable_blockquote';
  offset: number;
  length: number;
}

const FENCE_LINE = /^`{3,}$/;

/**
 * A message sent exactly as written (an approval): plain text with no parse mode, so nothing is
 * escaped, linkified, flattened or cut. Its first fenced block — opened by a line of three or more
 * backticks, closed by the same line — becomes a `pre` entity in place of the two fence lines; its
 * first folded quote (`expandableQuote`: a `> [!EXPANDABLE]` line, then `>` lines) becomes an
 * `expandable_blockquote` holding those lines without their `>` and without the mark.
 */
export function telegramVerbatimMessage(text: string): { text: string; entities: TelegramPreEntity[] } {
  const lines = text.split('\n');
  const out: string[] = [];
  const spans: Array<{ type: TelegramPreEntity['type']; from: number; to: number }> = [];
  let fence: string | null = null;
  let openAt = 0;
  let fenceDone = false;
  let quoteFrom = -1;
  let quoteDone = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (quoteFrom >= 0) {
      if (line.startsWith('>')) {
        out.push(line.replace(/^> ?/, ''));
        continue;
      }
      spans.push({ type: 'expandable_blockquote', from: quoteFrom, to: out.length });
      quoteFrom = -1;
      quoteDone = true;
    }
    if (fence !== null) {
      if (line === fence) {
        spans.push({ type: 'pre', from: openAt, to: out.length });
        fence = null;
        fenceDone = true;
      } else {
        out.push(line);
      }
      continue;
    }
    if (!fenceDone && FENCE_LINE.test(line) && lines.indexOf(line, index + 1) > index) {
      fence = line;
      openAt = out.length;
      continue;
    }
    if (!quoteDone && line.startsWith('>') && expandableQuoteBody(line.replace(/^> ?/, '')) !== null) {
      quoteFrom = out.length;
      continue;
    }
    out.push(line);
  }
  if (quoteFrom >= 0) spans.push({ type: 'expandable_blockquote', from: quoteFrom, to: out.length });

  const starts: number[] = [];
  let position = 0;
  for (const line of out) {
    starts.push(position);
    position += line.length + 1;
  }
  const entities = spans
    .filter((span) => span.to > span.from)
    .map((span) => {
      const offset = starts[span.from];
      const end = starts[span.to - 1] + out[span.to - 1].length;
      return { type: span.type, offset, length: end - offset };
    })
    .filter((entity) => entity.length > 0);
  return { text: out.join('\n'), entities };
}

export function telegramVisibleLength(html: string): number {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:amp|lt|gt|quot);/g, ' ')
    .length;
}

export function extractResponseSection(raw: string, strings: Record<string, string>): string {
  const normalized = raw.replace(/\r\n?/g, '\n');
  const responseAliases = new Set<string>();
  const localizedResponseHeading = t(strings, 'md.response').trim();
  if (localizedResponseHeading && localizedResponseHeading !== 'md.response') {
    responseAliases.add(localizedResponseHeading);
  }
  if (responseAliases.size === 0) return normalized;

  const lines = normalized.split('\n');
  const responseIdx = lines.findIndex((line) => {
    const match = line.trim().match(/^##\s+(.+)$/);
    if (!match) return false;
    return responseAliases.has(match[1].trim());
  });
  if (responseIdx < 0) return normalized;
  return lines.slice(responseIdx + 1).join('\n').trim();
}

export function formatResponseForTelegramHtml(input: string): string {
  const normalized = input.trim().replace(/\r\n?/g, '\n');
  if (!normalized) return '';

  const renderer = new Renderer();
  const renderInline = (tokens: Parameters<typeof renderer.parser.parseInline>[0]): string =>
    renderer.parser.parseInline(tokens);
  const renderBlock = (tokens: Parameters<typeof renderer.parser.parse>[0]): string =>
    renderer.parser.parse(tokens);

  renderer.strong = ({ tokens }) => `<b>${renderInline(tokens)}</b>`;
  renderer.em = ({ tokens }) => `<i>${renderInline(tokens)}</i>`;
  renderer.codespan = ({ text }) => `<code>${escapeTelegramHtml(text)}</code>`;
  renderer.code = ({ text, lang }) => {
    const escapedCode = escapeTelegramHtml(text);
    if (lang?.trim()) {
      return `<pre><code class="language-${escapeTelegramAttribute(lang.trim())}">${escapedCode}</code></pre>\n`;
    }
    return `<pre><code>${escapedCode}</code></pre>\n`;
  };
  renderer.del = (token) => escapeTelegramHtml(token.raw);
  renderer.link = ({ href, tokens }) => {
    const safeHref = normalizeSourceUrl(href);
    const text = renderInline(tokens).trim();
    if (!safeHref) return text;
    const plainText = text.replace(/<[^>]+>/g, '').trim();
    const anchorText = !plainText || /^https?:\/\//i.test(plainText)
      ? escapeTelegramHtml(getSourceLabel(safeHref))
      : text;
    return `<a href="${escapeTelegramAttribute(safeHref)}">${anchorText}</a>`;
  };
  // A forwarded post's text folds (`expandableQuote`). Telegram quotes do not nest: a quote
  // inside the folded one (a post it shares) keeps only its words.
  let folding = false;
  renderer.blockquote = ({ tokens, text }) => {
    if (folding) return renderBlock(tokens);
    const body = expandableQuoteBody(text);
    if (body === null) return `<blockquote>${renderBlock(tokens).trim()}</blockquote>\n`;
    folding = true;
    try {
      const inner = renderBlock(telegramMarked.lexer(body, { gfm: true, breaks: true })).trim();
      return inner ? `<blockquote expandable>${inner}</blockquote>\n` : '';
    } finally {
      folding = false;
    }
  };
  renderer.paragraph = ({ tokens }) => `${renderInline(tokens)}\n\n`;
  renderer.list = ({ items }) => `${items.map((item) => renderer.listitem(item)).join('')}\n`;
  // Telegram has no checkbox: marked's default renders `<input type="checkbox">`, which is not
  // in Telegram's tag set and fails the WHOLE send with a 400.
  renderer.checkbox = ({ checked }) => (checked ? '☑ ' : '☐ ');
  renderer.listitem = (item) => {
    const rendered = renderBlock(item.tokens).trim();
    const compact = rendered.replace(/\n{2,}/g, '\n').replace(/\n/g, ' ').trim();
    // A task item already leads with its own ☐/☑; a bullet as well reads as two markers.
    return item.task ? `${compact}\n` : `• ${compact}\n`;
  };
  renderer.heading = ({ tokens }) => `${bold(renderInline(tokens).trim())}\n`;
  renderer.hr = () => '\n';
  renderer.image = ({ text, href }) => {
    const altText = escapeTelegramHtml((text || '').trim());
    const safeHref = normalizeSourceUrl(href);
    if (safeHref && altText) return `${altText} (${escapeTelegramHtml(safeHref)})`;
    if (safeHref) return escapeTelegramHtml(safeHref);
    return altText;
  };
  renderer.br = () => '\n';
  // `<kbd>Ctrl</kbd>`, `<details>` and comments keep only their words; any other HTML stays visible text.
  renderer.html = ({ text, block }) => {
    const plain = htmlAsPlainText(text);
    if (plain === null) return escapeTelegramHtml(text);
    if (!block) return escapeTelegramHtml(plain);
    return plain.trim() ? `${escapeTelegramHtml(plain.trim())}\n` : '';
  };
  renderer.text = (token) => {
    if (token.type === 'text' && token.tokens?.length) return renderInline(token.tokens);
    return escapeTelegramHtml(token.text);
  };
  renderer.table = ({ header, rows }) => {
    // Rows stay ` | ` text (Telegram has no table); only the header row is set apart.
    const lines = [header.map((cell) => bold(renderInline(cell.tokens).trim())).join(' | ')];
    for (const row of rows) {
      lines.push(row.map((cell) => renderInline(cell.tokens).trim()).join(' | '));
    }
    return `${lines.join('\n')}\n`;
  };

  // The app's own `$`/`$$` repair, so what renders as a formula there is sent as one here.
  const parsed = telegramMarked.parse(promoteInlineMath(promoteDisplayMath(flattenFootnotes(normalized))), {
    renderer,
    gfm: true,
    breaks: true,
    async: false,
  });
  if (typeof parsed !== 'string') return '';
  return escapeUnsupportedTags(linkifyRawUrlsInHtml(parsed)).replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Exactly the tags this formatter emits. Deliberately narrower than Telegram's own list:
 * anything else appearing in the output did not come from here.
 */
const SUPPORTED_TAG =
  /^<\/(?:a|b|i|code|pre|blockquote)>$|^<(?:b|i|code|pre|blockquote|blockquote expandable)>$|^<a href="[^"<>]*">$|^<code class="language-[^"<>]*">$/;

/**
 * Last line of defence before parse_mode='HTML': Telegram rejects the whole message on one unknown
 * tag, so any tag outside the whitelist is escaped into visible text instead of losing the send.
 */
export function escapeUnsupportedTags(html: string): string {
  return html.replace(/<[^<>]*>/g, (tag) => (SUPPORTED_TAG.test(tag) ? tag : escapeTelegramHtml(tag)));
}

function normalizeSourceUrl(rawHref: string | null | undefined): string {
  const href = (rawHref || '').trim();
  if (!href) return '';
  try {
    const parsed = href.startsWith('//') ? new URL(`https:${href}`) : new URL(href);
    if (!/^https?:$/i.test(parsed.protocol)) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function getSourceLabel(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return (url.hostname || 'source').replace(/^www\./, '');
  } catch {
    return 'source';
  }
}

function linkifyRawUrlsInHtml(html: string): string {
  return html.replace(/(^|[\s(>])(https?:\/\/[^\s<)]+[^\s<).,!?;:])/g, (match, prefix: string, rawUrl: string) => {
    const safeUrl = normalizeSourceUrl(rawUrl);
    if (!safeUrl) return match;
    const label = escapeTelegramHtml(getSourceLabel(safeUrl));
    return `${prefix}<a href="${escapeTelegramAttribute(safeUrl)}">${label}</a>`;
  });
}
